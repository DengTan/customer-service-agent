import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

/**
 * Retrieval trace row — one row per assistant message produced by the LLM stream.
 * Persisted alongside `messages` so operators can audit / reproduce / regress-test
 * every citation the assistant emitted.
 */
export interface RetrievalTraceRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  decision_action: string;
  decision_reason_code: string;
  effective_query: string;
  effective_query_digest: string;
  rerank_backend: string;
  rerank_degraded: boolean;
  hybrid_search: boolean;
  candidate_count: number;
  accepted_count: number;
  citation_count: number;
  min_score: number;
  model_version: string | null;
  execution_time_ms: number;
  degradation_reasons: string[];
  synthetic_v1_backfill: boolean;
  bot_id: string | null;
  trace_started_at: string;
  trace_completed_at: string;
  created_at: string;
}

export interface InsertRetrievalTraceParams {
  conversation_id: string;
  message_id?: string | null;
  decision_action: string;
  decision_reason_code: string;
  effective_query: string;
  effective_query_digest: string;
  rerank_backend?: string;
  rerank_degraded?: boolean;
  hybrid_search?: boolean;
  candidate_count?: number;
  accepted_count?: number;
  citation_count?: number;
  min_score?: number;
  model_version?: string | null;
  execution_time_ms?: number;
  degradation_reasons?: string[];
  synthetic_v1_backfill?: boolean;
  bot_id?: string | null;
  trace_started_at: string;
}

/**
 * Thin wrapper around the `retrieval_traces` table.
 * The service layer above owns build/read logic; this repository only does
 * typed insert / select with consistent error wrapping.
 */
export class RetrievalTraceRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * Insert a single trace row.
   * Returns the inserted row id (caller usually does not need it — fire-and-forget).
   * Throws RepositoryError on failure (caller is responsible for swallowing).
   */
  async insert(params: InsertRetrievalTraceParams): Promise<string> {
    if (isDemoMode()) {
      return 'demo-' + Date.now().toString(36);
    }

    const row = {
      conversation_id: params.conversation_id,
      message_id: params.message_id ?? null,
      decision_action: params.decision_action,
      decision_reason_code: params.decision_reason_code,
      effective_query: params.effective_query,
      effective_query_digest: params.effective_query_digest,
      rerank_backend: params.rerank_backend ?? 'none',
      rerank_degraded: params.rerank_degraded ?? false,
      hybrid_search: params.hybrid_search ?? false,
      candidate_count: params.candidate_count ?? 0,
      accepted_count: params.accepted_count ?? 0,
      citation_count: params.citation_count ?? 0,
      min_score: params.min_score ?? 0,
      model_version: params.model_version ?? null,
      execution_time_ms: params.execution_time_ms ?? 0,
      degradation_reasons: params.degradation_reasons ?? [],
      synthetic_v1_backfill: params.synthetic_v1_backfill ?? false,
      bot_id: params.bot_id ?? null,
      trace_started_at: params.trace_started_at,
    };

    const { data, error } = await this.client
      .from('retrieval_traces')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      throw new RepositoryError('insert retrieval trace', error.message, error.code);
    }
    return (data as { id: string }).id;
  }

  async getByMessageId(messageId: string): Promise<RetrievalTraceRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('retrieval_traces')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('get retrieval trace by message id', error.message, error.code);
    }
    return data ? this.toRow(data as Record<string, unknown>) : null;
  }

  async getByConversationId(
    conversationId: string,
    opts: { limit: number; beforeMs?: number },
  ): Promise<RetrievalTraceRow[]> {
    if (isDemoMode()) return [];

    const limit = Math.min(opts.limit, 500);
    let query = this.client
      .from('retrieval_traces')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts.beforeMs !== undefined) {
      const iso = new Date(opts.beforeMs).toISOString();
      query = query.lt('created_at', iso);
    }

    const { data, error } = await query;
    if (error) {
      throw new RepositoryError('list retrieval traces by conversation', error.message, error.code);
    }
    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
  }

  async listRecent(opts: { limit: number; rerankBackend?: string }): Promise<RetrievalTraceRow[]> {
    if (isDemoMode()) return [];

    const limit = Math.min(opts.limit, 500);
    let query = this.client
      .from('retrieval_traces')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (opts.rerankBackend) {
      query = query.eq('rerank_backend', opts.rerankBackend);
    }

    const { data, error } = await query;
    if (error) {
      throw new RepositoryError('list recent retrieval traces', error.message, error.code);
    }
    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
  }

  private toRow(row: Record<string, unknown>): RetrievalTraceRow {
    return {
      id: row.id as string,
      conversation_id: row.conversation_id as string,
      message_id: (row.message_id as string | null) ?? null,
      decision_action: row.decision_action as string,
      decision_reason_code: row.decision_reason_code as string,
      effective_query: row.effective_query as string,
      effective_query_digest: row.effective_query_digest as string,
      rerank_backend: (row.rerank_backend as string) ?? 'none',
      rerank_degraded: (row.rerank_degraded as boolean) ?? false,
      hybrid_search: (row.hybrid_search as boolean) ?? false,
      candidate_count: (row.candidate_count as number) ?? 0,
      accepted_count: (row.accepted_count as number) ?? 0,
      citation_count: (row.citation_count as number) ?? 0,
      min_score: (row.min_score as number) ?? 0,
      model_version: (row.model_version as string | null) ?? null,
      execution_time_ms: (row.execution_time_ms as number) ?? 0,
      degradation_reasons: (row.degradation_reasons as string[]) ?? [],
      synthetic_v1_backfill: (row.synthetic_v1_backfill as boolean) ?? false,
      bot_id: (row.bot_id as string | null) ?? null,
      trace_started_at: row.trace_started_at as string,
      trace_completed_at: row.trace_completed_at as string,
      created_at: row.created_at as string,
    };
  }
}