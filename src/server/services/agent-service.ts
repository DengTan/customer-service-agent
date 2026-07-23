import { logger } from '@/lib/logger';
import { AgentRepository, type AgentQueueFilters, type AgentQueueItem, type AgentQueueRow, type AgentSessionRow } from '@/server/repositories/agent-repository';
import { AgentAssignmentService } from './agent-assignment-service';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import type { AgentPerformance } from '@/lib/types';
import {
  idempotent,
  SKIPPED,
  createIdempotencyKey,
  type IdempotencyStore,
} from '@/lib/idempotency';
import {
  agentStateMachine,
  AGENT_STATES,
  findAgentEvent,
  type AgentState,
} from '@/lib/agent-state-machine';
import { tryTransition } from '@/lib/state-machine';
import { createBoundedCache, type BoundedCache } from '@/lib/bounded-cache';

const VALID_STATUSES = AGENT_STATES;
type AgentStatus = AgentState;

export class AgentService {
  // Sprint 4 (T-8 / MG-2): per-agent + per-day performance cache. Key shape
  // is `${agentId ?? 'global'}:${YYYY-MM-DD}` so a new day bucket
  // auto-invalidates without extra logic.
  private readonly performanceCache: BoundedCache<string, AgentPerformance> = createBoundedCache<string, AgentPerformance>({
    maxSize: 1000,
    ttlMs: 5 * 60 * 1000,
  });

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

  async getStatus(userId: string): Promise<{ status: AgentState; session: AgentSessionRow | null }> {
    const existing = await this.repo.findSessionByUserId(userId);
    if (!existing) {
      return { status: 'offline', session: null };
    }
    return {
      status: (existing.status as AgentState) || 'offline',
      session: existing,
    };
  }

  async updateStatus(userId: string, status: string): Promise<{ session: AgentSessionRow | null }> {
    if (!VALID_STATUSES.includes(status as AgentStatus)) {
      throw new ServiceError('无效的状态值', { status: 400, code: 'VALIDATION_ERROR' });
    }

    const target = status as AgentStatus;

    try {
      // The current presence row may not exist (e.g. brand-new agent). Treat
      // absence as 'offline' so the state machine has a concrete `from` to
      // match against.
      const existing = await this.repo.findSessionByUserId(userId);

      let current: AgentState;
      if (existing) {
        // The DB column is `text`, so we must narrow it before letting the
        // state machine see it. A historical dirty value (e.g. an older
        // "paused" status left by a stale row) is treated as corruption:
        // surface INVALID_STATE so the caller can clean it up rather than
        // pretend the edge is legal.
        if (!VALID_STATUSES.includes(existing.status as AgentStatus)) {
          logger.warn('Corrupt agent session row', { userId, status: existing.status });
          throw new ServiceError('当前坐席状态值无效', {
            status: 409,
            code: 'INVALID_STATE',
          });
        }
        current = existing.status as AgentState;
      } else {
        current = 'offline';
      }

      // Single source of truth: the state machine. Look up which event
      // drives `(current → target)`; self-loops resolve to the explicit
      // `'noop'` event instead of a service-level short-circuit, so the
      // machine owns the semantics end-to-end.
      const event = findAgentEvent(current, target);
      if (!event) {
        // Should be unreachable: TRANSITION_TABLE is exhaustive over
        // `AgentState × AgentState` (including self-loops), and any
        // missing pair would have been caught by the invariant test.
        // Kept as a guard against future schema drift.
        logger.warn('Non-legal agent status transition', { userId, current, target });
        throw new ServiceError('非法的状态转换', {
          status: 400,
          code: 'INVALID_TRANSITION',
        });
      }

      const result = await tryTransition(agentStateMachine, current, { type: event });
      if (!result) {
        // The machine and our edge table are in sync, but a guard rejection
        // (or an unknown-transition we did not anticipate) still bubbles up
        // here. Surface as 400 INVALID_TRANSITION so the workspace UI can
        // show a sensible message instead of a generic 500.
        logger.warn('Agent state machine rejected transition', {
          userId,
          current,
          target,
          event,
        });
        throw new ServiceError('非法的状态转换', {
          status: 400,
          code: 'INVALID_TRANSITION',
        });
      }

      // Self-loops land here too: the machine "applied" a noop edge
      // (transition.to === current === target). We skip the write so we
      // don't bump `updated_at` for a no-op presence toggle.
      if (current === target) {
        return { session: existing ?? null };
      }

      const session = await this.repo.upsertSession(userId, target);
      // Sprint 4 (T-8 / MG-2): an agent flipping their state invalidates
      // the performance cache so the next poll reflects the new state.
      // `invalidatePerformance()` (no arg) clears both the per-agent bucket
      // and the global bucket in one call — no need to invoke twice.
      this.invalidatePerformance(userId);
      return { session };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      logger.error('updateStatus unexpected failure', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw toServiceError(error, '更新坐席状态失败', 'DB_ERROR');
    }
  }

  async getPerformance(agentId?: string): Promise<{ performance: AgentPerformance }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bucket = today.toISOString().slice(0, 10);
    const cacheKey = `perf:${agentId ?? 'global'}:${bucket}`;

    // Sprint 4 (T-8 / MG-2): cache the result for 5 minutes to avoid
    // re-running the cross-table aggregates on every poll.
    const cached = this.performanceCache.get(cacheKey);
    if (cached) {
      return { performance: cached };
    }

    try {
      const [activeCount, queuedCount, { count: resolvedCount, items: resolvedItems }] =
        await Promise.all([
          this.repo.countByStatus('assigned'),
          this.repo.countByStatus('queued'),
          this.repo.countResolvedToday(agentId),
        ]);

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

      this.performanceCache.set(cacheKey, performance);
      return { performance };
    } catch (error) {
      throw toServiceError(error, '获取坐席绩效失败', 'DB_ERROR');
    }
  }

  /**
   * Sprint 4 (T-8 / MG-2): drop the cached performance entry for an agent
   * (or both buckets if no id is passed). Callers should invoke this when
   * the underlying state changes — e.g. when an agent goes offline, accepts
   * a new conversation, or resolves one.
   */
  invalidatePerformance(agentId?: string): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bucket = today.toISOString().slice(0, 10);
    this.performanceCache.invalidate(`perf:${agentId ?? 'global'}:${bucket}`);
    // Also drop the legacy key without `:bucket` just in case older runs
    // populated the cache.
    if (agentId) this.performanceCache.invalidate(`perf:${agentId}`);
    this.performanceCache.invalidate('perf:global');
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
   *
   * Sprint 4 (T-5 / MG-1): wrap the assignment side-effect in Sprint 1's
   * `idempotent()` so two concurrent `autoAssign(queueId)` calls — typically
   * triggered by parallel webhook events on the same conversation — collapse
   * to a single DB update. The second caller receives `{ duplicate: true,
   * item: <current state of queue item> }`.
   */
  async autoAssign(queueId: string, idempotencyStore?: IdempotencyStore): Promise<{ item: AgentQueueRow } | null> {
    const idempotencyKey = createIdempotencyKey('assign_conversation', queueId);
    const windowMs = 30_000;

    try {
      const result = await idempotent(
        {
          key: idempotencyKey,
          windowMs,
          scope: idempotencyStore ? 'persistent' : 'memory',
          persistentStore: idempotencyStore,
          rollbackOnError: true,
        },
        async () => {
          const queueItem = await this.repo.findQueueItem(queueId, 'queued');
          if (!queueItem) return null;

          const bestAgentId = await this.repo.findBestAvailableAgent(queueItem.skill_group_id);
          if (!bestAgentId) return null;

          return await this.acceptQueueItem(queueId, bestAgentId);
        },
      );

      if (result.value === SKIPPED) {
        // Lost the race OR within the 30s window — surface the current state.
        const current = await this.repo.findQueueItem(queueId);
        if (!current) return null;
        return { item: current };
      }
      return result.value;
    } catch (error) {
      logger.agent.error('autoAssign failed', { error, queueId });
      return null;
    }
  }
}
