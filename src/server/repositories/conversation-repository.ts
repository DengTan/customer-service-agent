import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { Conversation, Message } from '@/lib/types';
import { RepositoryError } from './repository-error';
import type { MessageRow } from './types';
import { toMessageRow } from './types';
import { escapeLikePattern, trimDemoArray } from '@/lib/api-utils';
import { DEMO_CONVERSATIONS, DEMO_MESSAGES } from './demo-data/demo-conversations';
import { getLogger } from '@/lib/logger';

const logger = getLogger('ConversationRepository');

const CONVERSATION_LIST_SELECT =
  'id, title, status, rating, message_count, source, priority, unread_count, platform_connection_id, external_user_id, summary, created_at, updated_at';

const MESSAGE_DETAIL_SELECT =
  'id, role, content, sources, confidence, confidence_breakdown, tool_calls, tool_results, message_type, rich_content, image_url, created_at';

export interface ConversationFilters {
  status?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  has_rating?: boolean | null;
  source?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface CreateConversationInput {
  title: string;
  source: string;
  priority?: 'urgent' | 'normal';
}

export interface ConversationUpdate {
  status?: string;
  title?: string;
  priority?: string;
  unread_count?: number;
  message_count?: number;
  rating?: number;
  rating_comment?: string | null;
  participant_ids?: string[];
  is_collaborative?: boolean;
  summary?: string | null;
  handoff_reason?: string;
  updated_at?: string;
}

export interface NewMessage {
  conversation_id: string;
  role: Message['role'];
  content: string;
  image_url?: string | null;
  confidence?: number | null;
  confidence_breakdown?: unknown;
  sources?: unknown;
  tool_calls?: unknown;
  tool_results?: unknown;
  message_type?: Message['message_type'];
  rich_content?: unknown;
  mentions?: string[];
}

export interface MessageHistoryItem {
  role: string;
  content: string;
  image_url?: string | null;
}

export interface LastMessageItem {
  conversation_id: string;
  content: string;
  image_url?: string | null;
  created_at: string;
}

export interface ConversationCollaboration {
  id: string;
  status?: string;
  participant_ids: string[] | null;
  is_collaborative?: boolean;
}

export interface ParticipantUser {
  id: string;
  name: string;
  role: string;
}

export class ConversationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: ConversationFilters = {}): Promise<Conversation[]> {
    // Try demo mode first
    if (isDemoMode()) {
      try {
        let result = DEMO_CONVERSATIONS;
        if (filters.status && filters.status !== 'all') {
          result = result.filter(c => c.status === filters.status);
        }
        if (filters.search) {
          const search = filters.search.toLowerCase();
          result = result.filter(c => c.title.toLowerCase().includes(search));
        }
        if (filters.has_rating === true) {
          result = result.filter(c => c.rating !== null && c.rating !== undefined);
        } else if (filters.has_rating === false) {
          result = result.filter(c => c.rating === null || c.rating === undefined);
        }
        if (filters.source) {
          result = result.filter(c => c.source === filters.source);
        }
        if (filters.start_date) {
          result = result.filter(c => c.created_at >= filters.start_date!);
        }
        if (filters.end_date) {
          const endDate = new Date(filters.end_date);
          endDate.setDate(endDate.getDate() + 1);
          result = result.filter(c => c.created_at < endDate.toISOString().split('T')[0]);
        }
        // Apply pagination
        const offset = filters.offset ?? 0;
        const limit = filters.limit ?? 50;
        return result.slice(offset, offset + limit);
      } catch (err) {
        logger.error('Demo mode error, falling back to empty array', { error: err });
        return [];
      }
    }
    
    try {
      let query = this.client
        .from('conversations')
        .select(CONVERSATION_LIST_SELECT)
        .order('created_at', { ascending: false })
        .range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1);

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.search) {
        const escaped = escapeLikePattern(filters.search);
        query = query.ilike('title', `%${escaped}%`);
      }

      if (filters.has_rating === true) {
        query = query.not('rating', 'is', null);
      } else if (filters.has_rating === false) {
        query = query.is('rating', null);
      }

      if (filters.source) {
        query = query.eq('source', filters.source);
      }

      if (filters.start_date) {
        query = query.gte('created_at', filters.start_date);
      }

      if (filters.end_date) {
        // Add one day to include the entire end date
        const endDate = new Date(filters.end_date);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt('created_at', endDate.toISOString().split('T')[0]);
      }

      const { data, error } = await query;
      if (error) throw new RepositoryError('list conversations', error.message, error.code);

      return (data ?? []) as Conversation[];
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'list', error: String(err) });
      return [];
    }
  }

  async count(filters: ConversationFilters = {}): Promise<number> {
    if (isDemoMode()) {
      try {
        let result = DEMO_CONVERSATIONS;
        if (filters.status && filters.status !== 'all') {
          result = result.filter(c => c.status === filters.status);
        }
        if (filters.search) {
          const search = filters.search.toLowerCase();
          result = result.filter(c => c.title.toLowerCase().includes(search));
        }
        if (filters.has_rating === true) {
          result = result.filter(c => c.rating !== null && c.rating !== undefined);
        } else if (filters.has_rating === false) {
          result = result.filter(c => c.rating === null || c.rating === undefined);
        }
        if (filters.source) {
          result = result.filter(c => c.source === filters.source);
        }
        if (filters.start_date) {
          result = result.filter(c => c.created_at >= filters.start_date!);
        }
        if (filters.end_date) {
          const endDate = new Date(filters.end_date);
          endDate.setDate(endDate.getDate() + 1);
          result = result.filter(c => c.created_at < endDate.toISOString().split('T')[0]);
        }
        return result.length;
      } catch {
        return 0;
      }
    }

    try {
      let query = this.client
        .from('conversations')
        .select('id', { count: 'exact', head: true });

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.search) {
        const escaped = escapeLikePattern(filters.search);
        query = query.ilike('title', `%${escaped}%`);
      }

      if (filters.has_rating === true) {
        query = query.not('rating', 'is', null);
      } else if (filters.has_rating === false) {
        query = query.is('rating', null);
      }

      if (filters.source) {
        query = query.eq('source', filters.source);
      }

      if (filters.start_date) {
        query = query.gte('created_at', filters.start_date);
      }

      if (filters.end_date) {
        const endDate = new Date(filters.end_date);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt('created_at', endDate.toISOString().split('T')[0]);
      }

      const { count, error } = await query;
      if (error) throw new RepositoryError('count conversations', error.message, error.code);

      return count ?? 0;
    } catch (err) {
      logger.error('Count query failed', { error: err });
      return 0;
    }
  }

  async listLastMessages(conversationIds: string[]): Promise<LastMessageItem[]> {
    if (conversationIds.length === 0) return [];

    if (isDemoMode()) {
      return [];
    }
    
    try {
      const { data, error } = await this.client
        .from('messages')
        .select('conversation_id, content, image_url, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false });

      if (error) throw new RepositoryError('list last messages', error.message, error.code);
      return (data ?? []) as LastMessageItem[];
    } catch (err) {
      logger.error('Failed to list last messages', { error: err });
      return [];
    }
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    if (isDemoMode()) {
      const newConv: Conversation = {
        id: `demo-conv-${Date.now()}`,
        title: input.title,
        status: 'active',
        message_count: 0,
        source: input.source,
        priority: input.priority,
        rating: null,
        unread_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      DEMO_CONVERSATIONS.unshift(newConv);
      trimDemoArray(DEMO_CONVERSATIONS);
      return newConv;
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .insert({ ...input, status: 'active' })
        .select()
        .single();

      if (error) throw new RepositoryError('create conversation', error.message, error.code);
      return data as Conversation;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'create', error: String(err) });
      throw new RepositoryError('create conversation', String(err), 'DB_ERROR');
    }
  }

  async findById(id: string): Promise<Conversation | null> {
    if (isDemoMode()) {
      return DEMO_CONVERSATIONS.find(c => c.id === id) || null;
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new RepositoryError('find conversation', error.message, error.code);
      return (data as Conversation | null) ?? null;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'findById', error: String(err) });
      return null;
    }
  }

  /**
   * 通过 Gorgias 工单 ID 查找对话
   */
  async findByGorgiasTicketId(gorgiasTicketId: number): Promise<Conversation | null> {
    if (isDemoMode()) {
      return DEMO_CONVERSATIONS.find(c => 
        c.metadata && (c.metadata as Record<string, unknown>).gorgias_ticket_id === gorgiasTicketId
      ) || null;
    }
    
    try {
      // Use ->> (text) operator and string comparison to match both number and string storage.
      // gorgias_ticket_id is now stored as string, but older records may still have number type.
      const ticketIdStr = String(gorgiasTicketId);
      // Use .limit(1) instead of .maybeSingle() to avoid PGRST116 error
      // when duplicate conversations exist for the same gorgias_ticket_id.
      // Pick the one with the most messages (most likely the "real" one).
      const { data, error } = await this.client
        .from('conversations')
        .select('*')
        .eq('metadata->>gorgias_ticket_id', ticketIdStr)
        .order('message_count', { ascending: false, nullsFirst: false })
        .limit(1);

      if (error) throw new RepositoryError('find conversation by gorgias ticket id', error.message, error.code);
      return (data?.[0] as Conversation | null) ?? null;
    } catch (err) {
      logger.error('findByGorgiasTicketId failed', { context: { gorgiasTicketId, error: String(err) } });
      return null;
    }
  }

  /**
   * 通过 Gorgias 消息 ID 查找消息
   */
  async findByGorgiasMessageId(gorgiasMessageId: number): Promise<Message | null> {
    if (isDemoMode()) {
      return null;
    }
    
    try {
      // Use ->> (text) operator and string comparison for consistent matching
      const msgIdStr = String(gorgiasMessageId);
      const { data, error } = await this.client
        .from('messages')
        .select('*')
        .eq('metadata->>gorgias_message_id', msgIdStr)
        .maybeSingle();

      if (error) throw new RepositoryError('find message by gorgias message id', error.message, error.code);
      return (data as Message | null) ?? null;
    } catch (err) {
      logger.error('findByGorgiasMessageId failed', { context: { gorgiasMessageId, error: String(err) } });
      return null;
    }
  }

  async findStatus(id: string): Promise<{ id: string; status: string } | null> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === id);
      return conv ? { id: conv.id, status: conv.status } : null;
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new RepositoryError('find conversation status', error.message, error.code);
      return data as { id: string; status: string } | null;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'findStatus', error: String(err) });
      return null;
    }
  }

  /**
   * Get session-related fields for timeout and max-turns checks.
   * Returns message_count, created_at, and updated_at without fetching the full conversation.
   */
  async findSessionInfo(id: string): Promise<{ id: string; status: string; message_count: number; updated_at: string; created_at: string } | null> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === id);
      return conv ? { id: conv.id, status: conv.status, message_count: conv.message_count, updated_at: conv.updated_at, created_at: conv.created_at } : null;
    }

    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('id, status, message_count, updated_at, created_at')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new RepositoryError('find session info', error.message, error.code);
      return data as { id: string; status: string; message_count: number; updated_at: string; created_at: string } | null;
    } catch (err) {
      logger.error('Database query failed in findSessionInfo', { error: err });
      return null;
    }
  }

  /**
   * Get the timestamp of the first assistant message in a conversation.
   * Used for first-response-timeout quality checks.
   */
  async findFirstAssistantReplyAt(conversationId: string): Promise<string | null> {
    if (isDemoMode()) return null;

    try {
      const { data, error } = await this.client
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw new RepositoryError('find first assistant reply', error.message, error.code);
      return data ? (data.created_at as string) : null;
    } catch (err) {
      logger.error('Database query failed in findFirstAssistantReplyAt', { error: err });
      return null;
    }
  }

  async findSummary(id: string): Promise<string | null> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === id);
      return conv?.summary || null;
    }
    
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('summary')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new RepositoryError('find conversation summary', error.message, error.code);
      return ((data as { summary?: string | null } | null)?.summary) ?? null;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'findSummary', error: String(err) });
      return null;
    }
  }

  async listMessages(conversationId: string, limit: number, offset: number = 0, order: 'asc' | 'desc' = 'asc'): Promise<Message[]> {
    if (isDemoMode()) {
      return DEMO_MESSAGES.filter(m => m.conversation_id === conversationId).slice(offset, offset + limit);
    }
    
    try {
      const { data, error } = await this.client
        .from('messages')
        .select(MESSAGE_DETAIL_SELECT)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: order === 'asc' })
        .range(offset, offset + limit - 1);

      if (error) throw new RepositoryError('list conversation messages', error.message, error.code);
      return (data ?? []) as Message[];
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'listMessages', error: String(err) });
      return [];
    }
  }

  async listMessageHistory(conversationId: string, limit: number): Promise<MessageHistoryItem[]> {
    if (isDemoMode()) {
      return DEMO_MESSAGES
        .filter(m => m.conversation_id === conversationId)
        .map(m => ({ role: m.role, content: m.content, image_url: m.image_url }))
        .slice(0, limit);
    }
    
    const { data, error } = await this.client
      .from('messages')
      .select('role, content, image_url')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw new RepositoryError('list message history', error.message, error.code);
    return (data ?? []) as MessageHistoryItem[];
  }

  async insertMessage(message: NewMessage): Promise<void> {
    if (isDemoMode()) return;
    try {
      // Remove fields that don't exist in the database schema
      const { mentions: _mentions, ...dbMessage } = message;
      const { error } = await this.client.from('messages').insert(dbMessage);
      if (error) throw new RepositoryError('insert message', error.message, error.code);
    } catch (err) {
      logger.error('Database query failed in insertMessage, skipping', { error: err });
    }
  }

  async insertMessageAndReturn(
    message: NewMessage,
    select = 'id, role, content, created_at',
  ): Promise<Message> {
    if (isDemoMode()) {
      return {
        id: `demo-msg-${Date.now()}`,
        conversation_id: message.conversation_id,
        role: message.role,
        content: message.content,
        image_url: message.image_url,
        message_type: message.message_type || 'text',
        sources: null,
        confidence_breakdown: message.confidence_breakdown as import('@/lib/types').ConfidenceBreakdown | null ?? null,
        created_at: new Date().toISOString(),
      };
    }
    try {
      // Remove fields that don't exist in the database schema
      const { mentions: _mentions, ...dbMessage } = message;
      // Safely serialize confidence_breakdown to prevent JSON.stringify errors
      if (dbMessage.confidence_breakdown != null) {
        try {
          dbMessage.confidence_breakdown = JSON.parse(JSON.stringify(dbMessage.confidence_breakdown));
        } catch {
          dbMessage.confidence_breakdown = null;
        }
      }
      const { data, error } = await this.client.from('messages').insert(dbMessage).select(select).single();
      if (error) throw new RepositoryError('insert message and return', error.message, error.code);
      return toMessageRow(data) as Message;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'insertMessageAndReturn', error: String(err) });
      throw new RepositoryError('insert message and return', String(err), 'DB_ERROR');
    }
  }

  async update(id: string, updateData: ConversationUpdate): Promise<void> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === id);
      if (conv) Object.assign(conv, updateData);
      return;
    }
    try {
      const { error } = await this.client.from('conversations').update(updateData).eq('id', id);
      if (error) throw new RepositoryError('update conversation', error.message, error.code);
    } catch (err) {
      logger.error('Database query failed in update, skipping', { error: err });
    }
  }

  async updateAndReturn(id: string, updateData: ConversationUpdate): Promise<Conversation> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === id);
      if (conv) Object.assign(conv, updateData);
      return conv as Conversation;
    }
    try {
      const { data, error } = await this.client
        .from('conversations')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new RepositoryError('update conversation and return', error.message, error.code);
      return data as Conversation;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'updateAndReturn', error: String(err) });
      throw new RepositoryError('update conversation and return', String(err), 'DB_ERROR');
    }
  }

  async findCollaboration(conversationId: string): Promise<ConversationCollaboration | null> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === conversationId);
      return conv ? { id: conv.id, status: conv.status, participant_ids: null, is_collaborative: false } : null;
    }
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('id, status, participant_ids, is_collaborative')
        .eq('id', conversationId)
        .maybeSingle();

      if (error) throw new RepositoryError('find conversation collaboration', error.message, error.code);
      return data as ConversationCollaboration | null;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'findCollaboration', error: String(err) });
      return null;
    }
  }

  async listParticipants(userIds: string[]): Promise<ParticipantUser[]> {
    if (userIds.length === 0) return [];
    if (isDemoMode()) return [];

    try {
      const { data, error } = await this.client
        .from('users')
        .select('id, name, role')
        .in('id', userIds);

      if (error) throw new RepositoryError('list participants', error.message, error.code);
      return (data ?? []) as ParticipantUser[];
    } catch (err) {
      logger.error('Database query failed in listParticipants, returning empty', { error: err });
      return [];
    }
  }

  async deleteMessages(conversationId: string): Promise<void> {
    if (isDemoMode()) return;
    try {
      const { error } = await this.client.from('messages').delete().eq('conversation_id', conversationId);
      if (error) throw new RepositoryError('delete conversation messages', error.message, error.code);
    } catch (err) {
      logger.error('Database query failed in deleteMessages, skipping', { error: err });
    }
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      const idx = DEMO_CONVERSATIONS.findIndex(c => c.id === id);
      if (idx !== -1) DEMO_CONVERSATIONS.splice(idx, 1);
      return;
    }
    try {
      const { error } = await this.client.from('conversations').delete().eq('id', id);
      if (error) throw new RepositoryError('delete conversation', error.message, error.code);
    } catch (err) {
      logger.error('Database query failed in delete, skipping', { error: err });
    }
  }

  async incrementMessageCount(conversationId: string): Promise<boolean> {
    if (isDemoMode()) {
      const conv = DEMO_CONVERSATIONS.find(c => c.id === conversationId);
      if (conv) conv.message_count = (conv.message_count || 0) + 1;
      return true;
    }
    try {
      const { error } = await this.client.rpc('increment_message_count', { conv_id: conversationId });
      return !error;
    } catch (err) {
      logger.error('Database query failed in incrementMessageCount, skipping', { error: err });
      return false;
    }
  }

  async countMessages(conversationId: string): Promise<number> {
    if (isDemoMode()) {
      return DEMO_MESSAGES.filter(m => m.conversation_id === conversationId).length;
    }
    try {
      const { count, error } = await this.client
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId);

      if (error) throw new RepositoryError('count messages', error.message, error.code);
      return count ?? 0;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'countMessages', error: String(err) });
      return 0;
    }
  }

  /**
   * Count messages with `role='user'` for a conversation.
   *
   * Used by the messages route to enforce `max_turns` against actual user
   * turns only — assistant / system / agent / internal_note messages are not
   * counted toward the limit.
   *
   * Demo mode applies the same rule against `DEMO_MESSAGES` so behaviour is
   * identical in offline development.
   */
  async countUserMessages(conversationId: string): Promise<number> {
    if (isDemoMode()) {
      return DEMO_MESSAGES.filter(
        m => m.conversation_id === conversationId && m.role === 'user',
      ).length;
    }
    try {
      const { count, error } = await this.client
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('role', 'user');

      if (error) throw new RepositoryError('count user messages', error.message, error.code);
      return count ?? 0;
    } catch (err) {
      logger.error('[ConversationRepository] Database query failed', { operation: 'countUserMessages', error: String(err) });
      return 0;
    }
  }

  /**
   * Find conversations that have not received an AI reply for a given threshold.
   * Returns conversations where the last message is from the user and older than thresholdMinutes.
   */
  async findUnhandledConversations(thresholdMinutes: number): Promise<Array<{ id: string; title: string }>> {
    if (isDemoMode()) return [];
    const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();
    // Find active conversations whose last message is from user and updated before cutoff
    const { data, error } = await this.client
      .from('conversations')
      .select('id, title')
      .eq('status', 'active')
      .lt('updated_at', cutoff);

    if (error) {
      logger.error('findUnhandledConversations error', { error: error.message });
      return [];
    }

    const conversations = (data ?? []) as Array<{ id: string; title: string }>;
    if (conversations.length === 0) return [];

    // Batch query: get all messages for these conversations at once
    const conversationIds = conversations.map(c => c.id);
    const { data: allMessages, error: msgError } = await this.client
      .from('messages')
      .select('conversation_id, role, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false });

    if (msgError) {
      logger.error('findUnhandledConversations messages query error', { error: msgError.message });
      return [];
    }

    // Build a map of conversation_id -> last message
    const lastMessageMap = new Map<string, { role: string }>();
    if (Array.isArray(allMessages)) {
      for (const msg of allMessages) {
        const convId = (msg as Record<string, unknown>).conversation_id as string;
        if (!lastMessageMap.has(convId)) {
          lastMessageMap.set(convId, { role: (msg as Record<string, unknown>).role as string });
        }
      }
    }

    // Filter: only include conversations where the last message is from the user
    const result: Array<{ id: string; title: string }> = [];
    for (const conv of conversations) {
      const lastMsg = lastMessageMap.get(conv.id);
      if (lastMsg && lastMsg.role === 'user') {
        result.push(conv);
      }
    }
    return result;
  }

  /**
   * Count conversations currently in 'active' status (being handled by AI).
   */
  async countActiveConversations(): Promise<number> {
    if (isDemoMode()) return 0;
    const { count, error } = await this.client
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');

    if (error) {
      logger.error('countActiveConversations error', { error: error.message });
      return 0;
    }
    return count ?? 0;
  }

  /**
   * Get status-level counts for StatsBar (not affected by pagination/search).
   */
  async getStatusCounts(): Promise<Record<string, number>> {
    if (isDemoMode()) {
      const counts: Record<string, number> = {};
      for (const c of DEMO_CONVERSATIONS) {
        counts[c.status] = (counts[c.status] || 0) + 1;
      }
      counts.total = DEMO_CONVERSATIONS.length;
      return counts;
    }

    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('status');
      if (error) throw new RepositoryError('getStatusCounts', error.message, error.code);

      const counts: Record<string, number> = { total: 0 };
      for (const row of data ?? []) {
        counts[row.status] = (counts[row.status] || 0) + 1;
        counts.total++;
      }
      return counts;
    } catch (err) {
      logger.error('getStatusCounts failed', { error: err });
      return {};
    }
  }
}
