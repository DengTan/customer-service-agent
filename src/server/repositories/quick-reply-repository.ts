import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { escapeLikePattern } from '@/lib/api-utils';

export interface QuickReplyFilters {
  category?: string | null;
  search?: string | null;
  scope?: string | null;
}

export interface QuickReplyRow {
  id: string;
  title: string;
  content: string;
  category: string;
  variables: unknown[];
  scope: string;
  creator_id: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface CreateQuickReplyInput {
  title: string;
  content: string;
  category?: string;
  variables?: unknown[];
  scope?: string;
  creator_id?: string;
}

export interface UpdateQuickReplyInput {
  id: string;
  title?: string;
  content?: string;
  category?: string;
  variables?: unknown[];
  scope?: string;
}

export class QuickReplyRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: QuickReplyFilters = {}): Promise<QuickReplyRow[]> {
    if (isDemoMode()) {
      const demoReplies: QuickReplyRow[] = [
        { id: 'demo-qr-1', title: '欢迎语', content: '您好！欢迎咨询，我是智能客服助手，请问有什么可以帮您的？', category: '问候', variables: [], scope: 'ai', creator_id: null, usage_count: 156, created_at: '2026-01-01T00:00:00Z', updated_at: null },
        { id: 'demo-qr-2', title: '物流查询', content: '请您提供订单号，我帮您查询物流信息。', category: '物流', variables: [], scope: 'ai', creator_id: null, usage_count: 89, created_at: '2026-01-01T00:00:00Z', updated_at: null },
        { id: 'demo-qr-3', title: '退款说明', content: '退款将在1-3个工作日内原路退回，请您耐心等待。', category: '售后', variables: [], scope: 'ai', creator_id: null, usage_count: 67, created_at: '2026-02-01T00:00:00Z', updated_at: null },
        { id: 'demo-qr-4', title: '转人工', content: '好的，我为您转接人工客服，请稍等。', category: '转接', variables: [], scope: 'ai', creator_id: null, usage_count: 45, created_at: '2026-02-01T00:00:00Z', updated_at: null },
        { id: 'demo-qr-5', title: '问题确认', content: '您好，请问您的问题是关于订单、物流还是售后呢？', category: '售前', variables: [], scope: 'agent', creator_id: null, usage_count: 120, created_at: '2026-02-15T00:00:00Z', updated_at: null },
        { id: 'demo-qr-6', title: '升级处理', content: '您的问题我已记录，正在为您升级处理，稍后会有专人联系您。', category: '售后', variables: [], scope: 'agent', creator_id: null, usage_count: 58, created_at: '2026-02-20T00:00:00Z', updated_at: null },
      ];
      // Filter by scope if specified
      if (filters.scope) {
        return demoReplies.filter(r => r.scope === filters.scope);
      }
      return demoReplies;
    }
    let query = this.client
      .from('quick_replies')
      .select('*')
      .order('usage_count', { ascending: false })
      .order('created_at', { ascending: false });

    if (filters.category) query = query.eq('category', filters.category);
    if (filters.scope) query = query.eq('scope', filters.scope);
    if (filters.search) {
      const escapedSearch = escapeLikePattern(filters.search);
      query = query.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`);
    }

    const { data, error } = await query;
    if (error) throw new RepositoryError('list quick replies', error.message, error.code);
    return data ?? [];
  }

  async create(input: CreateQuickReplyInput): Promise<unknown> {
    if (isDemoMode()) return { id: 'demo-qr-new', title: input.title, content: input.content, category: input.category || '通用', variables: input.variables || [], scope: input.scope || 'global', usage_count: 0 };
    const { data, error } = await this.client
      .from('quick_replies')
      .insert({
        title: input.title,
        content: input.content,
        category: input.category || '通用',
        variables: input.variables || [],
        scope: input.scope || 'global',
        creator_id: input.creator_id,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create quick reply', error.message, error.code);
    return data;
  }

  async update(input: UpdateQuickReplyInput): Promise<unknown> {
    if (isDemoMode()) return { id: input.id, title: input.title, content: input.content, category: input.category, variables: input.variables, scope: input.scope };
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.content !== undefined) updates.content = input.content;
    if (input.category !== undefined) updates.category = input.category;
    if (input.variables !== undefined) updates.variables = input.variables;
    if (input.scope !== undefined) updates.scope = input.scope;

    const { data, error } = await this.client
      .from('quick_replies')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update quick reply', error.message, error.code);
    return data;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('quick_replies').delete().eq('id', id);
    if (error) throw new RepositoryError('delete quick reply', error.message, error.code);
  }
}
