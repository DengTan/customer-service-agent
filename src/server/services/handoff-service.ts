import { AgentQueueRepository } from '@/server/repositories/agent-queue-repository';
import { AgentService } from './agent-service';
import { AgentAssignmentService } from './agent-assignment-service';
import { AlertService } from './alert-service';
import { ConversationService } from './conversation-service';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

export interface RequestHandoffInput {
  conversationId: string;
  reason?: string;
  priority?: 'urgent' | 'normal';
}

export class HandoffService {
  constructor(
    private readonly conversations = new ConversationService(),
    private readonly queue = new AgentQueueRepository(),
    private readonly alerts = new AlertService(),
    private readonly agentService = new AgentService(),
    private readonly assignmentService = new AgentAssignmentService(),
  ) {}

  async requestHandoff(input: RequestHandoffInput): Promise<{ summary: string | null }> {
    const reason = input.reason || 'User requested human support';

    try {
      const currentConversation = await this.queue.findHandoffConversationContext(input.conversationId);

      await this.conversations.markHandoff(input.conversationId, reason);
      await this.conversations.insertMessage({
        conversation_id: input.conversationId,
        role: 'system',
        content: 'Connecting you to a human agent. Please wait a moment.',
      });

      await this.alerts.createAlert({
        conversation_id: input.conversationId,
        type: 'handoff_request',
        severity: 'info',
        message: `Conversation requested human handoff: ${reason}`,
        metadata: { reason },
      });

      const [defaultSkillGroupId, customerName, shopId] = await Promise.all([
        this.queue.findDefaultSkillGroupId(),
        this.queue.findCustomerNameForConversation(input.conversationId),
        this.queue.findShopIdForConversation(input.conversationId),
      ]);

      const queueId = await this.queue.enqueue({
        conversation_id: input.conversationId,
        customer_name:
          customerName || currentConversation?.title || `Customer ${input.conversationId.substring(0, 4)}`,
        priority: input.priority || 'normal',
        skill_group_id: defaultSkillGroupId,
        status: 'queued',
        reason,
        summary: currentConversation?.summary ?? null,
        source_platform: currentConversation?.source ?? null,
      });

      // Try to auto-assign using the new assignment engine first
      let assigned = false;
      if (queueId) {
        try {
          const result = await this.assignmentService.assignConversation({
            skillGroupId: defaultSkillGroupId,
            shopId: shopId ?? undefined,
            platform: currentConversation?.source ?? undefined,
          });

          if (result.success && result.agentId) {
            await this.agentService.acceptQueueItem(queueId, result.agentId);
            assigned = true;
            logger.agent.info('Handoff: assigned via new engine', {
              queueId,
              agentId: result.agentId,
              strategy: result.strategy,
            });
          }
        } catch (err) {
          logger.agent.warn('Handoff: new assignment engine failed, fallback to legacy', { error: err });
        }
      }

      // Fallback: use legacy auto-assign if new engine didn't assign
      if (!assigned && queueId) {
        try {
          await this.agentService.autoAssign(queueId);
        } catch {
          // Auto-assign failure is non-critical; item stays in queue for manual pickup
        }
      }

      return { summary: currentConversation?.summary ?? null };
    } catch (error) {
      throw toServiceError(error, 'Failed to request human handoff');
    }
  }
}
