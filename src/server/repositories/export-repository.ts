import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { escapeLikePattern } from '@/lib/api-utils';

export interface ConversationExportRow {
  id: string;
  title: string;
  status: string;
  rating: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface ConversationExportFilters {
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  search?: string | null;
  cursor?: string | null; // For cursor-based pagination (pass last row's created_at value)
}

export interface ConversationExportResult {
  rows: ConversationExportRow[];
}

export interface AnalyticsStats {
  total_conversations: number;
  active_conversations: number;
  completed_conversations: number;
  total_messages: number;
  avg_rating: string;
  total_alerts: number;
  queued_items: number;
}

export class ExportRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  async listConversations(filters: ConversationExportFilters): Promise<ConversationExportRow[]> {
    if (isDemoMode()) {
      return [
        { id: 'demo-conv-1', title: '退货咨询', status: 'completed', rating: 4, created_at: '2026-06-10T08:00:00Z', updated_at: '2026-06-10T09:00:00Z' },
        { id: 'demo-conv-2', title: '物流查询', status: 'active', rating: null, created_at: '2026-06-09T14:00:00Z', updated_at: null },
        { id: 'demo-conv-3', title: '支付问题', status: 'completed', rating: 5, created_at: '2026-06-08T10:00:00Z', updated_at: '2026-06-08T11:00:00Z' },
      ];
    }
    let query = this.client
      .from('conversations')
      .select('id, title, status, rating, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (filters.cursor) {
      query = query.lt('created_at', filters.cursor);
    }
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.start_date) query = query.gte('created_at', filters.start_date);
    if (filters.end_date) query = query.lte('created_at', filters.end_date);
    if (filters.search) query = query.ilike('title', `%${escapeLikePattern(filters.search)}%`);

    const { data, error } = await query;

    if (error) throw new RepositoryError('list conversations for export', error.message, error.code);
    return (data ?? []) as ConversationExportRow[];
  }

  async getAnalyticsStats(): Promise<AnalyticsStats> {
    if (isDemoMode()) {
      return {
        total_conversations: 0,
        active_conversations: 0,
        completed_conversations: 0,
        total_messages: 0,
        avg_rating: '0',
        total_alerts: 0,
        queued_items: 0,
      };
    }
    const { data: conversations, error: convError } = await this.client
      .from('conversations')
      .select('status, rating, created_at');

    if (convError) throw new RepositoryError('get analytics conversation stats', convError.message, convError.code);

    const total = conversations?.length || 0;
    const active =
      conversations?.filter((c: Record<string, unknown>) => c.status === 'active').length || 0;
    const completed =
      conversations?.filter((c: Record<string, unknown>) => c.status === 'completed').length || 0;
    const ratings =
      conversations
        ?.filter((c: Record<string, unknown>) => c.rating != null)
        .map((c: Record<string, unknown>) => Number(c.rating)) || [];
    const avgRating =
      ratings.length > 0 ? (ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(2) : '0';

    const [{ count: messageCount }, { count: alertCount }, { count: queuedCount }] = await Promise.all([
      this.client.from('messages').select('*', { count: 'exact', head: true }),
      this.client.from('alerts').select('*', { count: 'exact', head: true }),
      this.client
        .from('agent_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'queued'),
    ]);

    return {
      total_conversations: total,
      active_conversations: active,
      completed_conversations: completed,
      total_messages: messageCount || 0,
      avg_rating: avgRating,
      total_alerts: alertCount || 0,
      queued_items: queuedCount || 0,
    };
  }
}
