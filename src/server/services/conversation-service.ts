import type { Conversation, Message, Customer } from '@/lib/types';
import { logger } from '@/lib/logger';
import {
  ConversationRepository,
  type ConversationFilters,
  type ConversationUpdate,
  type NewMessage,
  type MessageHistoryItem,
} from '@/server/repositories/conversation-repository';
import { CustomerRepository } from '@/server/repositories/customer-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export interface ConversationListItem extends Omit<Conversation, 'last_message'> {
  last_message?: string | null;
  last_message_image: string | null;
}

export interface UpdateConversationInput {
  action?: string;
  status?: string;
  title?: string;
  priority?: string;
  unread_count?: number;
  summary?: string | null;
}

export interface Participant {
  id: string;
  name: string;
  role: string;
}

export class ConversationService {
  constructor(
    private readonly conversations = new ConversationRepository(),
    private readonly customers = new CustomerRepository(),
  ) {}

  async listConversations(filters: ConversationFilters): Promise<{ conversations: ConversationListItem[]; total: number; statusCounts: Record<string, number> }> {
    try {
      // 并行查询列表、总数和状态统计
      const [conversations, total, statusCounts] = await Promise.all([
        this.conversations.list(filters),
        this.conversations.count(filters),
        this.conversations.getStatusCounts(),
      ]);

      if (conversations.length === 0) return { conversations: [], total, statusCounts };

      const lastMessages = await this.conversations.listLastMessages(
        conversations.map((conversation) => conversation.id),
      );

      const lastMessageByConversation = new Map<string, { content: string; image_url?: string | null }>();
      for (const message of lastMessages) {
        if (!lastMessageByConversation.has(message.conversation_id)) {
          lastMessageByConversation.set(message.conversation_id, {
            content: message.content,
            image_url: message.image_url,
          });
        }
      }

      const items = conversations.map((conversation) => ({
        ...conversation,
        last_message: lastMessageByConversation.get(conversation.id)?.content ?? null,
        last_message_image: lastMessageByConversation.get(conversation.id)?.image_url ?? null,
      }));

      return { conversations: items, total, statusCounts };
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch conversations', 'DB_QUERY_ERROR');
    }
  }

  async createConversation(input: Partial<{ title: string; source: string; priority: string }>): Promise<Conversation> {
    try {
      return await this.conversations.create({
        title: input.title || 'New conversation',
        source: input.source || 'web',
        priority: (input.priority || 'normal') as 'normal' | 'urgent',
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to create conversation', 'DB_INSERT_ERROR');
    }
  }

  async getConversationDetail(
    conversationId: string,
    messageLimit: number,
    messagePage: number = 1,
    messageOffset: number = 0,
    messageOrder: 'asc' | 'desc' = 'asc',
  ): Promise<{ conversation: Conversation & { customer?: Customer | null }; messages: Message[]; total_messages: number }> {
    try {
      const conversation = await this.conversations.findById(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      const offset = messageOffset > 0 ? messageOffset : (messagePage - 1) * messageLimit;
      const messages = await this.conversations.listMessages(conversationId, messageLimit, offset, messageOrder);
      const totalMessages = await this.conversations.countMessages(conversationId);
      // 客户关联查询为非关键操作，失败时降级为 null
      let customer: Customer | null = null;
      try {
        customer = await this.customers.findByConversationId(conversationId);
      } catch (custErr) {
        logger.agent.warn('Failed to fetch linked customer', { error: custErr, conversationId });
      }
      return { conversation: { ...conversation, customer }, messages, total_messages: totalMessages };
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch conversation detail', 'DB_QUERY_ERROR');
    }
  }

  async updateConversation(conversationId: string, input: UpdateConversationInput): Promise<void> {
    try {
      const existing = await this.conversations.findById(conversationId);
      if (!existing) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      const updateData: ConversationUpdate = { updated_at: new Date().toISOString() };
      if (input.action === 'reset_unread') {
        updateData.unread_count = 0;
      } else {
        if (input.status) updateData.status = input.status;
        if (input.title) updateData.title = input.title;
        if (input.priority) updateData.priority = input.priority;
        if (input.unread_count !== undefined) updateData.unread_count = input.unread_count;
        if (input.summary !== undefined) updateData.summary = input.summary;
      }

      await this.conversations.update(conversationId, updateData);
    } catch (error) {
      throw toServiceError(error, 'Failed to update conversation', 'DB_UPDATE_ERROR');
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const existing = await this.conversations.findById(conversationId);
      if (!existing) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      await this.conversations.deleteMessages(conversationId);
      await this.conversations.delete(conversationId);
    } catch (error) {
      throw toServiceError(error, 'Failed to delete conversation', 'DB_DELETE_ERROR');
    }
  }

  /**
   * Get basic conversation info including platform_connection_id
   */
  async getConversationBasic(conversationId: string): Promise<{ id: string; platform_connection_id?: string | null } | null> {
    try {
      const conversation = await this.conversations.findById(conversationId);
      if (!conversation) return null;
      return {
        id: conversation.id,
        platform_connection_id: (conversation as { platform_connection_id?: string | null }).platform_connection_id,
      };
    } catch {
      return null;
    }
  }

  async ensureCanReceiveAiMessage(conversationId: string): Promise<{ status: string }> {
    try {
      const conversation = await this.conversations.findStatus(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      return { status: conversation.status };
    } catch (error) {
      throw toServiceError(error, 'Failed to validate conversation', 'DB_QUERY_ERROR');
    }
  }

  async getSessionInfo(conversationId: string): Promise<{ id: string; status: string; message_count: number; updated_at: string } | null> {
    try {
      return await this.conversations.findSessionInfo(conversationId);
    } catch (error) {
      // Non-critical: return null to skip timeout/turns checks
      logger.agent.warn('Failed to get session info', { error, conversationId });
      return null;
    }
  }

  async insertMessage(message: NewMessage): Promise<void> {
    try {
      await this.conversations.insertMessage(message);
    } catch (error) {
      throw toServiceError(error, 'Failed to save message', 'DB_INSERT_ERROR');
    }
  }

  async updateMessageCountAfterUserMessage(conversationId: string, userMessage: string): Promise<void> {
    try {
      const incremented = await this.conversations.incrementMessageCount(conversationId);
      if (incremented) return;

      const messageCount = await this.conversations.countMessages(conversationId);
      const updateData: ConversationUpdate = {
        message_count: messageCount,
        updated_at: new Date().toISOString(),
      };

      if (messageCount <= 2) {
        updateData.title = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
      }

      await this.conversations.update(conversationId, updateData);
    } catch (error) {
      throw toServiceError(error, 'Failed to update conversation message count', 'DB_UPDATE_ERROR');
    }
  }

  /**
   * Increment message count by 1 (used after assistant message insert).
   * Non-critical — failure is caught and ignored.
   */
  async incrementMessageCount(conversationId: string): Promise<void> {
    try {
      await this.conversations.incrementMessageCount(conversationId);
    } catch {
      // Non-critical — count will self-heal on next user message via updateMessageCountAfterUserMessage
    }
  }

  async listMessageHistory(conversationId: string, limit: number): Promise<MessageHistoryItem[]> {
    try {
      return await this.conversations.listMessageHistory(conversationId, limit);
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch message history', 'DB_QUERY_ERROR');
    }
  }

  async countMessages(conversationId: string): Promise<number> {
    try {
      return await this.conversations.countMessages(conversationId);
    } catch (error) {
      throw toServiceError(error, 'Failed to count messages', 'DB_QUERY_ERROR');
    }
  }

  async getSummary(conversationId: string): Promise<string | null> {
    try {
      return await this.conversations.findSummary(conversationId);
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch conversation summary', 'DB_QUERY_ERROR');
    }
  }

  async updateSummary(conversationId: string, summary: string): Promise<void> {
    try {
      await this.conversations.update(conversationId, {
        summary,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to update conversation summary', 'DB_UPDATE_ERROR');
    }
  }

  async markHandoff(conversationId: string, reason: string): Promise<void> {
    try {
      await this.conversations.update(conversationId, {
        status: 'handoff',
        handoff_reason: reason,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to mark conversation handoff', 'DB_UPDATE_ERROR');
    }
  }

  async rateConversation(
    conversationId: string,
    rating: number | undefined,
    comment?: string,
  ): Promise<Conversation> {
    // Handle rating=0 explicitly: 0 is treated as invalid (not falsy)
    if (!rating || rating < 0 || rating > 5) {
      throw new ServiceError('Rating must be an integer from 1 to 5', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.conversations.updateAndReturn(conversationId, {
        rating,
        rating_comment: comment || null,
        status: 'ended',
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to update conversation rating');
    }
  }

  async addInternalNote(
    conversationId: string,
    content: string | undefined,
    mentions: string[] = [],
  ): Promise<Message> {
    if (!content || typeof content !== 'string') {
      throw new ServiceError('Internal note content is required', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const conversation = await this.conversations.findCollaboration(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      const message = await this.conversations.insertMessageAndReturn({
        conversation_id: conversationId,
        role: 'internal_note',
        content,
        message_type: 'internal_note',
        mentions,
      });

      if (mentions.length > 0) {
        const existingParticipants = conversation.participant_ids || [];
        const updatedParticipants = [...new Set([...existingParticipants, ...mentions])];
        await this.conversations.update(conversationId, {
          participant_ids: updatedParticipants,
          is_collaborative: true,
          updated_at: new Date().toISOString(),
        });
      }

      return message;
    } catch (error) {
      throw toServiceError(error, 'Failed to add internal note');
    }
  }

  async getParticipants(conversationId: string): Promise<{
    participants: Participant[];
    is_collaborative: boolean;
  }> {
    try {
      const conversation = await this.conversations.findCollaboration(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      const participantIds = conversation.participant_ids || [];
      const participants = await this.conversations.listParticipants(participantIds);

      return {
        participants,
        is_collaborative: Boolean(conversation.is_collaborative),
      };
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch conversation participants');
    }
  }

  async addParticipant(conversationId: string, userId: string | undefined): Promise<string[]> {
    if (!userId) {
      throw new ServiceError('User id is required', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const conversation = await this.conversations.findCollaboration(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      const existingParticipants = conversation.participant_ids || [];
      if (existingParticipants.includes(userId)) {
        throw new ServiceError('User is already a participant', {
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }

      const updatedParticipants = [...existingParticipants, userId];
      await this.conversations.update(conversationId, {
        participant_ids: updatedParticipants,
        is_collaborative: true,
        updated_at: new Date().toISOString(),
      });

      return updatedParticipants;
    } catch (error) {
      throw toServiceError(error, 'Failed to add conversation participant');
    }
  }

  async removeParticipant(conversationId: string, userId: string | null): Promise<string[]> {
    if (!userId) {
      throw new ServiceError('User id is required', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const conversation = await this.conversations.findCollaboration(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }

      const updatedParticipants = (conversation.participant_ids || []).filter((id) => id !== userId);
      await this.conversations.update(conversationId, {
        participant_ids: updatedParticipants,
        is_collaborative: updatedParticipants.length > 0,
        updated_at: new Date().toISOString(),
      });

      return updatedParticipants;
    } catch (error) {
      throw toServiceError(error, 'Failed to remove conversation participant');
    }
  }
}
