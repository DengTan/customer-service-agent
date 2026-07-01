import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { TicketRow } from './types';
import { toTicketRow } from './types';
import { escapeLikePattern } from '@/lib/api-utils';
import { TICKET } from '@/lib/constants';

export interface TicketFilters {
  status?: string;
  priority?: string;
  category?: string;
  search?: string;
  assignee_id?: string;
  sort_by?: string;
  sort_order?: string;
  page?: number;
  page_size?: number;
}

export interface CreateTicketInput {
  title: string;
  description?: string | null;
  category?: string;
  priority?: string;
  conversation_id?: string | null;
  creator_id?: string | null;
  assignee_id?: string | null;
  parent_ticket_id?: string | null;
}

export interface CreateTicketFromConversationInput extends CreateTicketInput {
  conversation_id: string;
}

export interface UpdateTicketInput {
  id: string;
  status?: string;
  assignee_id?: string | null;
  operator_id?: string | null;
  parent_ticket_id?: string | null;
}

export interface StatusCounts {
  open: number;
  in_progress: number;
  pending_customer: number;
  resolved: number;
  closed: number;
}

export interface TicketDetail {
  ticket: unknown;
  comments: unknown[];
  status_log: unknown[];
  custom_field_values?: unknown[];
}

export interface CreateCommentInput {
  ticket_id: string;
  content: string;
  is_internal?: boolean;
  author_id?: string | null;
}

export interface CommentWithAuthor {
  comment: unknown;
  author_name: string | null;
  author_avatar: string | null;
}

export class TicketRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: TicketFilters = {}): Promise<{ tickets: Record<string, unknown>[]; status_counts: StatusCounts; total_count: number }> {
    if (isDemoMode()) {
      const demoTickets: Record<string, unknown>[] = [
        { id: 'demo-tk-1', ticket_number: 'TK-20260610-001', title: '商品质量问题需退货', description: '收到的商品有破损，需要退货处理', category: 'refund', priority: 'high', status: 'open', assignee_id: 'demo-user-2', creator_id: 'demo-user-1', conversation_id: 'demo-conv-1', created_at: '2026-06-10T08:00:00Z', updated_at: null, resolved_at: null, closed_at: null, assignee_name: '李小红', creator_name: '张经理', comment_count: 2 },
        { id: 'demo-tk-2', ticket_number: 'TK-20260609-002', title: '物流延迟催单', description: '订单已超过预计送达时间3天', category: 'logistics', priority: 'medium', status: 'in_progress', assignee_id: 'demo-user-3', creator_id: 'demo-user-1', conversation_id: null, created_at: '2026-06-09T14:00:00Z', updated_at: null, resolved_at: null, closed_at: null, assignee_name: '王大明', creator_name: '张经理', comment_count: 1 },
        { id: 'demo-tk-3', ticket_number: 'TK-20260608-003', title: '退款金额不符', description: '实际退款金额与申请金额不一致', category: 'refund', priority: 'urgent', status: 'pending_customer', assignee_id: null, creator_id: 'demo-user-2', conversation_id: null, created_at: '2026-06-08T10:00:00Z', updated_at: null, resolved_at: null, closed_at: null, assignee_name: null, creator_name: '李小红', comment_count: 3 },
      ];
      const status_counts = { open: 1, in_progress: 1, pending_customer: 1, resolved: 0, closed: 0 };
      let filtered = demoTickets;
      if (filters.status) filtered = filtered.filter(t => (t as Record<string, unknown>).status === filters.status);
      if (filters.priority) filtered = filtered.filter(t => (t as Record<string, unknown>).priority === filters.priority);
      return { tickets: filtered, status_counts, total_count: filtered.length };
    }
    // Determine sort column and direction
    const sortColumn = filters.sort_by || 'created_at';
    const sortAscending = filters.sort_order === 'asc';
    const page = filters.page || 1;
    const pageSize = filters.page_size || TICKET.PAGE_SIZE;

    let query = this.client
      .from('tickets')
      .select('*, assignee:users!tickets_assignee_id_fkey(id, name), creator:users!tickets_creator_id_fkey(id, name)', { count: 'exact' })
      .order(sortColumn, { ascending: sortAscending })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.priority) query = query.eq('priority', filters.priority);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.assignee_id) query = query.eq('assignee_id', filters.assignee_id);
    if (filters.search) {
      // Escape special characters to prevent SQL injection in LIKE patterns
      const escaped = escapeLikePattern(filters.search);
      query = query.or(`ticket_number.ilike.%${escaped}%,title.ilike.%${escaped}%`);
    }

    const { data: tickets, error, count } = await query;

    if (error) {
      throw new RepositoryError('list tickets', error.message, error.code);
    }

    const totalCount = count || 0;

    // Batch fetch comment counts for all tickets (fixes N+1 query)
    const ticketIds = (tickets || []).map((t) => t.id);
    const commentCounts: Record<string, number> = {};

    if (ticketIds.length > 0) {
      const { data: commentsData, error: commentsError } = await this.client
        .from('ticket_comments')
        .select('ticket_id', { count: 'exact' })
        .in('ticket_id', ticketIds);

      if (!commentsError && commentsData) {
        // Count comments per ticket
        for (const item of commentsData) {
          const tid = (item as Record<string, unknown>).ticket_id as string;
          commentCounts[tid] = (commentCounts[tid] || 0) + 1;
        }
      }
    }

    const ticketsWithCounts: Record<string, unknown>[] = (tickets || []).map((ticket) => ({
      ...toTicketRow(ticket),
      assignee_name: ticket.assignee?.name || null,
      creator_name: ticket.creator?.name || null,
      comment_count: commentCounts[ticket.id] || 0,
    }));

    const statusCounts: StatusCounts = {
      open: 0,
      in_progress: 0,
      pending_customer: 0,
      resolved: 0,
      closed: 0,
    };
    for (const t of ticketsWithCounts) {
      const status = (t as Record<string, unknown>).status as keyof StatusCounts;
      if (status in statusCounts) {
        statusCounts[status]++;
      }
    }

    return { tickets: ticketsWithCounts, status_counts: statusCounts, total_count: totalCount };
  }

  async generateTicketNumber(): Promise<string> {
    if (isDemoMode()) return `TK-${Date.now()}`;
    const { data, error } = await this.client.rpc('nextval', { seq_name: 'ticket_number_seq' });
    if (error) {
      throw new RepositoryError('generate ticket number', error.message, error.code);
    }
    const seqNum = data as number | null;
    if (!seqNum) {
      // Fallback: use timestamp prefixed ticket number
      return `TK-FALLBACK-${Date.now()}`;
    }
    return `TK-${seqNum}`;
  }

  async create(input: CreateTicketInput): Promise<unknown> {
    if (isDemoMode()) return { id: 'demo-tk-new', ticket_number: `TK-${Date.now()}`, title: input.title, description: input.description, category: input.category ?? 'other', priority: input.priority ?? 'medium', status: 'open', assignee_id: input.assignee_id ?? null, creator_id: input.creator_id ?? null, conversation_id: input.conversation_id ?? null, created_at: new Date().toISOString() };
    const ticketNumber = await this.generateTicketNumber();

    const { data, error } = await this.client
      .from('tickets')
      .insert({
        ticket_number: ticketNumber,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? 'other',
        priority: input.priority ?? 'medium',
        status: 'open',
        conversation_id: input.conversation_id ?? null,
        creator_id: input.creator_id ?? null,
        assignee_id: input.assignee_id ?? null,
        parent_ticket_id: input.parent_ticket_id ?? null,
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create ticket', error.message, error.code);
    }

    return data;
  }

  async logStatusChange(ticketId: string, fromStatus: string | null, toStatus: string, operatorId: string | null): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('ticket_status_log').insert({
      ticket_id: ticketId,
      from_status: fromStatus,
      to_status: toStatus,
      operator_id: operatorId,
    });

    if (error) {
      throw new RepositoryError('log status change', error.message, error.code);
    }
  }

  async findById(id: string): Promise<unknown | null> {
    if (isDemoMode()) return { id, ticket_number: 'TK-DEMO', title: '演示工单', status: 'open', priority: 'high' };
    const { data, error } = await this.client
      .from('tickets')
      .select('*, assignee:users!tickets_assignee_id_fkey(id, name), creator:users!tickets_creator_id_fkey(id, name)')
      .eq('id', id)
      .single();

    if (error) {
      throw new RepositoryError('find ticket by id', error.message, error.code);
    }

    return data;
  }

  async findByConversationId(conversationId: string): Promise<unknown[] | null> {
    if (isDemoMode()) return [];
    const { data, error } = await this.client
      .from('tickets')
      .select('id, ticket_number')
      .eq('conversation_id', conversationId)
      .not('status', 'eq', 'closed')
      .limit(1);

    if (error) {
      throw new RepositoryError('find ticket by conversation id', error.message, error.code);
    }

    return data;
  }

  async findConversationById(conversationId: string): Promise<unknown | null> {
    if (isDemoMode()) return { id: conversationId, title: '演示对话', summary: '这是一个演示对话' };
    const { data, error } = await this.client
      .from('conversations')
      .select('id, title, summary')
      .eq('id', conversationId)
      .single();

    if (error) {
      throw new RepositoryError('find conversation by id', error.message, error.code);
    }

    return data;
  }

  async update(input: UpdateTicketInput): Promise<unknown> {
    if (isDemoMode()) return { id: input.id, status: input.status, assignee_id: input.assignee_id };
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (input.status !== undefined) {
      updateData.status = input.status;
      if (input.status === 'resolved') {
        updateData.resolved_at = new Date().toISOString();
      }
      if (input.status === 'closed') {
        updateData.closed_at = new Date().toISOString();
      }
    }

    if (input.assignee_id !== undefined) {
      updateData.assignee_id = input.assignee_id;
    }

    if (input.parent_ticket_id !== undefined) {
      updateData.parent_ticket_id = input.parent_ticket_id;
    }

    const { data, error } = await this.client
      .from('tickets')
      .update(updateData)
      .eq('id', input.id)
      .select('*, assignee:users!tickets_assignee_id_fkey(id, name), creator:users!tickets_creator_id_fkey(id, name)')
      .single();

    if (error) {
      throw new RepositoryError('update ticket', error.message, error.code);
    }

    return data;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('tickets').delete().eq('id', id);

    if (error) {
      throw new RepositoryError('delete ticket', error.message, error.code);
    }
  }

  async getDetail(id: string): Promise<TicketDetail> {
    if (isDemoMode()) {
      return {
        ticket: { id, ticket_number: 'TK-DEMO-001', title: '商品质量问题需退货', description: '收到的商品有破损', category: 'refund', priority: 'high', status: 'open', assignee_name: '李小红', creator_name: '张经理' },
        comments: [{ id: 'demo-cmt-1', content: '已联系客户确认问题', author_name: '李小红', is_internal: true, created_at: '2026-06-10T09:00:00Z' }],
        status_log: [
          { id: 'demo-log-1', from_status: null, to_status: 'open', operator_name: '张经理', created_at: '2026-06-10T08:00:00Z' },
          { id: 'demo-log-2', from_status: 'open', to_status: 'in_progress', operator_name: '李小红', created_at: '2026-06-10T08:30:00Z' },
        ],
      };
    }
    // Fetch all three in parallel instead of sequentially
    const [ticketResult, commentsResult, statusLogResult] = await Promise.all([
      this.client
        .from('tickets')
        .select('*, assignee:users!tickets_assignee_id_fkey(id, name), creator:users!tickets_creator_id_fkey(id, name)')
        .eq('id', id)
        .single(),
      this.client
        .from('ticket_comments')
        .select('*, author:users(id, name, avatar)')
        .eq('ticket_id', id)
        .order('created_at', { ascending: true }),
      this.client
        .from('ticket_status_log')
        .select('*, operator:users(id, name)')
        .eq('ticket_id', id)
        .order('created_at', { ascending: true }),
    ]);

    const { data: ticket, error } = ticketResult;

    if (error || !ticket) {
      throw new RepositoryError('get ticket detail', error?.message ?? 'ticket not found', error?.code);
    }

    const { data: comments } = commentsResult;
    const { data: statusLog } = statusLogResult;

    const enrichedComments = (comments || []).map((c: Record<string, unknown>) => ({
      ...c,
      author_name: (c.author as Record<string, unknown>)?.name || null,
      author_avatar: (c.author as Record<string, unknown>)?.avatar || null,
    }));

    const enrichedStatusLog = (statusLog || []).map((s: Record<string, unknown>) => ({
      ...s,
      operator_name: (s.operator as Record<string, unknown>)?.name || null,
    }));

    return {
      ticket: {
        ...ticket,
        assignee_name: ticket.assignee?.name || null,
        creator_name: ticket.creator?.name || null,
      },
      comments: enrichedComments,
      status_log: enrichedStatusLog,
    };
  }

  async listComments(ticketId: string): Promise<CommentWithAuthor[]> {
    if (isDemoMode()) return [{ comment: { id: 'demo-cmt-1', content: '已联系客户确认问题', is_internal: true }, author_name: '李小红', author_avatar: null }];
    const { data: comments, error } = await this.client
      .from('ticket_comments')
      .select('*, author:users(id, name, avatar)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new RepositoryError('list ticket comments', error.message, error.code);
    }

    return (comments || []).map((c: Record<string, unknown>) => {
      const authorObj = c.author as Record<string, unknown> | null;
      return {
        comment: c,
        author_name: authorObj?.name ? String(authorObj.name) : null,
        author_avatar: authorObj?.avatar ? String(authorObj.avatar) : null,
      };
    });
  }

  async addComment(input: CreateCommentInput): Promise<CommentWithAuthor> {
    if (isDemoMode()) return { comment: { id: 'demo-cmt-new', content: input.content, is_internal: input.is_internal ?? false }, author_name: '演示用户', author_avatar: null };
    const { data: comment, error } = await this.client
      .from('ticket_comments')
      .insert({
        ticket_id: input.ticket_id,
        author_id: input.author_id || null,
        content: input.content.trim(),
        is_internal: input.is_internal ?? false,
      })
      .select('*, author:users(id, name, avatar)')
      .single();

    if (error) {
      throw new RepositoryError('add ticket comment', error.message, error.code);
    }

    await this.client
      .from('tickets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', input.ticket_id);

    return {
      comment,
      author_name: (comment.author as Record<string, unknown> | null)?.name ? String((comment.author as Record<string, unknown>).name) : null,
      author_avatar: (comment.author as Record<string, unknown> | null)?.avatar ? String((comment.author as Record<string, unknown>).avatar) : null,
    };
  }

  async ticketExists(id: string): Promise<boolean> {
    if (isDemoMode()) return id.startsWith('demo-');
    const { data } = await this.client
      .from('tickets')
      .select('id')
      .eq('id', id)
      .single();

    return !!data;
  }

  /**
   * Find tickets that are open, unassigned, and older than the given milliseconds.
   */
  async findUnassignedOlderThan(ms: number): Promise<unknown[]> {
    if (isDemoMode()) return [];
    const cutoff = new Date(Date.now() - ms).toISOString();
    const { data, error } = await this.client
      .from('tickets')
      .select('id, ticket_number, title, conversation_id, created_at')
      .eq('status', 'open')
      .is('assignee_id', null)
      .lt('created_at', cutoff);

    if (error) {
      throw new RepositoryError('find unassigned tickets', error.message, error.code);
    }

    return data ?? [];
  }

  /**
   * Batch update multiple tickets at once.
   * Returns the count of updated tickets.
   */
  async batchUpdate(ids: string[], updates: {
    status?: string;
    assignee_id?: string | null;
    priority?: string;
    category?: string;
  }): Promise<number> {
    if (isDemoMode()) return ids.length;

    // Use transactional stored procedure
    const { data, error } = await this.client.rpc('batch_update_tickets', {
      p_ids: ids,
      p_status: updates.status ?? null,
      p_priority: updates.priority ?? null,
      p_category: updates.category ?? null,
      p_assignee_id: updates.assignee_id ?? null,
    });

    if (error) {
      if (error.code === 'PGRST204') {
        // Function not found - fall back to regular update
        const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (updates.status !== undefined) {
          updateData.status = updates.status;
          if (updates.status === 'resolved') updateData.resolved_at = new Date().toISOString();
          if (updates.status === 'closed') updateData.closed_at = new Date().toISOString();
        }
        if (updates.assignee_id !== undefined) updateData.assignee_id = updates.assignee_id;
        if (updates.priority !== undefined) updateData.priority = updates.priority;
        if (updates.category !== undefined) updateData.category = updates.category;

        const result = await this.client
          .from('tickets')
          .update(updateData)
          .in('id', ids)
          .select('id');

        if (result.error) {
          throw new RepositoryError('batch update tickets', result.error.message, result.error.code);
        }
        return result.data?.length ?? 0;
      }
      throw new RepositoryError('batch update tickets', error.message, error.code);
    }

    return (data as { updated_count: number })?.updated_count ?? 0;
  }
}
