import { logger } from '@/lib/logger';
import { AgentRepository, type AgentQueueFilters, type AgentQueueItem, type AgentQueueRow } from '@/server/repositories/agent-repository';
import { AgentAssignmentService } from './agent-assignment-service';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import type { AgentPerformance } from '@/lib/types';

const VALID_STATUSES = ['online', 'away', 'offline'] as const;
type AgentStatus = (typeof VALID_STATUSES)[number];

export class AgentService {
  constructor(
    private readonly repo = new AgentRepository(),
    private readonly assignmentService = new AgentAssignmentService()
  ) {}

  async listQueue(filters: AgentQueueFilters = {}): Promise<{ items: AgentQueueItem[]; total: number }> {
    try {
      return await this.repo.listQueue(filters);
    } catch (error) {
      throw toServiceError(error, '获取排队列表失败', 'DB_ERROR');
    }
  }

  async acceptQueueItem(queueId: string, agentId: string): Promise<{ item: AgentQueueRow }> {
    try {
      const queueItem = await this.repo.findQueueItem(queueId, 'queued');
      if (!queueItem) {
        throw new ServiceError('排队项不存在或已被接单', { status: 404, code: 'NOT_FOUND' });
      }

      const item = await this.repo.assignQueueItem(queueId, agentId);

      await Promise.all([
        this.repo.upsertSession(agentId, 'online', queueItem.conversation_id),
        this.repo.updateConversationStatus(queueItem.conversation_id, 'handoff'),
        this.repo.updateConversationAssignedAgent(queueItem.conversation_id, agentId),
      ]);

      // Sync stats: increment active_conversations
      await this.assignmentService.onAgentAccept(agentId);

      return { item };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '接单失败', 'DB_ERROR');
    }
  }

  async resolveQueueItem(queueId: string): Promise<{ item: AgentQueueRow }> {
    try {
      const item = await this.repo.resolveQueueItem(queueId);

      if (item.conversation_id) {
        await this.repo.updateConversationStatus(item.conversation_id, 'ended');
      }
      if (item.assigned_agent_id) {
        await this.repo.clearAgentCurrentConversation(item.assigned_agent_id);
        // Sync stats: decrement active_conversations, increment completed
        await this.assignmentService.onAgentResolve(item.assigned_agent_id);
      }

      return { item };
    } catch (error) {
      throw toServiceError(error, '完成排队项失败', 'DB_ERROR');
    }
  }

  async transferQueueItem(queueId: string, targetAgentId: string): Promise<{ item: AgentQueueRow }> {
    try {
      const item = await this.repo.transferQueueItem(queueId, targetAgentId);
      const sourceAgentId = item.assigned_agent_id;

      await Promise.all([
        this.repo.upsertSession(targetAgentId, 'online', item.conversation_id),
        this.repo.updateConversationAssignedAgent(item.conversation_id, targetAgentId),
      ]);

      // Sync stats: decrement source, increment target
      if (sourceAgentId) {
        await this.assignmentService.onAgentTransfer(sourceAgentId, targetAgentId);
      }

      return { item };
    } catch (error) {
      throw toServiceError(error, '转接失败', 'DB_ERROR');
    }
  }

  async updateStatus(userId: string, status: string): Promise<{ session: unknown }> {
    if (!VALID_STATUSES.includes(status as AgentStatus)) {
      throw new ServiceError('无效的状态值', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const session = await this.repo.upsertSession(userId, status);
      return { session };
    } catch (error) {
      throw toServiceError(error, '更新坐席状态失败', 'DB_ERROR');
    }
  }

  async getPerformance(agentId?: string): Promise<{ performance: AgentPerformance }> {
    try {
      const [activeCount, queuedCount, { count: resolvedCount, items: resolvedItems }] =
        await Promise.all([
          this.repo.countByStatus('assigned'),
          this.repo.countByStatus('queued'),
          this.repo.countResolvedToday(agentId),
        ]);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const avgResponseSeconds = this.calcAvgResponseTime(resolvedItems);
      const avgDurationSeconds = this.calcAvgDuration(resolvedItems);
      const satisfactionAvg = await this.calcSatisfactionAvg(todayISO, agentId);

      const performance: AgentPerformance = {
        total_resolved: resolvedCount,
        avg_response_time_seconds: avgResponseSeconds,
        avg_duration_seconds: avgDurationSeconds,
        satisfaction_avg: Math.round(satisfactionAvg * 10) / 10,
        active_conversations: activeCount,
        queued_count: queuedCount,
      };

      return { performance };
    } catch (error) {
      throw toServiceError(error, '获取坐席绩效失败', 'DB_ERROR');
    }
  }

  private calcAvgResponseTime(items: AgentQueueRow[]): number {
    const responseTimes = items
      .filter((item) => item.assigned_at)
      .map((item) => {
        const created = new Date(item.created_at).getTime();
        const assigned = new Date(item.assigned_at!).getTime();
        return (assigned - created) / 1000;
      })
      .filter((t) => t > 0);

    if (responseTimes.length === 0) return 0;
    return Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
  }

  private calcAvgDuration(items: AgentQueueRow[]): number {
    const durations = items
      .filter((item) => item.resolved_at && item.assigned_at)
      .map((item) => {
        const assigned = new Date(item.assigned_at!).getTime();
        const resolved = new Date(item.resolved_at!).getTime();
        return (resolved - assigned) / 1000;
      })
      .filter((d) => d > 0);

    if (durations.length === 0) return 0;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }

  private async calcSatisfactionAvg(sinceIso: string, agentId?: string): Promise<number> {
    const ratedConversations = await this.repo.listRatedConversationsUpdatedSince(sinceIso, agentId);
    if (!ratedConversations || ratedConversations.length === 0) return 0;
    const sum = ratedConversations.reduce((acc, c) => acc + (c.rating ?? 0), 0);
    return sum / ratedConversations.length;
  }

  /**
   * Auto-assign a queued item to the best available agent based on schedule and skill group.
   * Returns the assigned queue item, or null if no agent available.
   */
  async autoAssign(queueId: string): Promise<{ item: AgentQueueRow } | null> {
    try {
      const queueItem = await this.repo.findQueueItem(queueId, 'queued');
      if (!queueItem) return null;

      const bestAgentId = await this.repo.findBestAvailableAgent(queueItem.skill_group_id);
      if (!bestAgentId) return null;

      return await this.acceptQueueItem(queueId, bestAgentId);
    } catch (error) {
      logger.agent.error('autoAssign failed', { error, queueId });
      return null;
    }
  }
}
