import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export type KnowledgeGapStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';

export interface KnowledgeGapSignal {
  id: string;
  question_hash: string;
  sample_question: string;
  question_category: string | null;
  frequency: number;
  first_seen_at: string;
  last_seen_at: string;
  last_top_score: number | null;
  triggers_handoff: boolean;
  source_conversation_ids: string[];
  status: KnowledgeGapStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  linked_knowledge_item_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeGapStats {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  dismissed: number;
  top_concerns: { question_hash: string; sample_question: string; frequency: number }[];
}

export interface RecordGapParams {
  questionHash: string;
  sampleQuestion: string;
  category?: string | null;
  topScore: number | null;
  triggeredHandoff: boolean;
  conversationId: string;
}

const MAX_CONVERSATION_REFS = 20;

export class KnowledgeGapRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * Record a gap signal. Uses atomic insert-or-update pattern with proper
   * concurrency handling. New records insert with frequency=1; existing records
   * increment frequency and merge conversation IDs.
   */
  async recordSignal(params: RecordGapParams): Promise<KnowledgeGapSignal> {
    if (isDemoMode()) {
      return this.toRow({
        id: 'demo-' + params.questionHash.slice(0, 8),
        question_hash: params.questionHash,
        sample_question: params.sampleQuestion,
        question_category: params.category ?? null,
        frequency: 1,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        last_top_score: params.topScore,
        triggers_handoff: params.triggeredHandoff,
        source_conversation_ids: [params.conversationId],
        status: 'open' as const,
        resolved_by: null,
        resolved_at: null,
        linked_knowledge_item_id: null,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const now = new Date().toISOString();

    // Step 1: Try to insert a new row
    const { error: insertErr } = await this.client
      .from('knowledge_gap_signals')
      .insert({
        question_hash: params.questionHash,
        sample_question: params.sampleQuestion,
        question_category: params.category ?? null,
        frequency: 1,
        first_seen_at: now,
        last_seen_at: now,
        last_top_score: params.topScore,
        triggers_handoff: params.triggeredHandoff,
        source_conversation_ids: [params.conversationId],
        status: 'open',
      });

    if (!insertErr) {
      // Insert succeeded — fetch and return the new row
      const { data, error } = await this.client
        .from('knowledge_gap_signals')
        .select('*')
        .eq('question_hash', params.questionHash)
        .single();
      if (error) throw new RepositoryError('fetch inserted gap signal', error.message, error.code);
      return this.toRow(data as Record<string, unknown>);
    }

    // Insert failed — check if it's a unique constraint violation
    if (insertErr.code !== '23505') {
      throw new RepositoryError('insert gap signal', insertErr.message, insertErr.code);
    }

    // Step 2: Unique constraint conflict — update existing row
    // Read current values first to build the merged update
    const { data: existing, error: readErr } = await this.client
      .from('knowledge_gap_signals')
      .select('source_conversation_ids, frequency, status, triggers_handoff')
      .eq('question_hash', params.questionHash)
      .maybeSingle();
    if (readErr) throw new RepositoryError('read gap signal for update', readErr.message, readErr.code);
    if (!existing) {
      throw new RepositoryError('gap signal not found after conflict', 'P0001', 'not_found');
    }

    const row = existing as {
      source_conversation_ids: string[];
      frequency: number;
      status: string;
      triggers_handoff: boolean;
      last_top_score: number | null;
    };

    const mergedConvs = Array.from(
      new Set([...(row.source_conversation_ids || []), params.conversationId]),
    ).slice(-MAX_CONVERSATION_REFS);
    const wasResolved = row.status === 'resolved' || row.status === 'dismissed';
    const updates: Record<string, unknown> = {
      frequency: (row.frequency ?? 0) + 1,
      last_seen_at: now,
      last_top_score: params.topScore ?? row.last_top_score ?? null,
      triggers_handoff: row.triggers_handoff || params.triggeredHandoff,
      source_conversation_ids: mergedConvs,
      updated_at: now,
    };
    // Reopen if previously resolved/dismissed
    if (wasResolved) {
      updates.status = 'open';
      updates.resolved_at = null;
      updates.resolved_by = null;
    }

    const { data: updated, error: updateErr } = await this.client
      .from('knowledge_gap_signals')
      .update(updates)
      .eq('question_hash', params.questionHash)
      .select('*')
      .single();
    if (updateErr) throw new RepositoryError('update gap signal frequency', updateErr.message, updateErr.code);
    return this.toRow(updated as Record<string, unknown>);
  }

  async list(params: {
    status?: KnowledgeGapStatus | KnowledgeGapStatus[];
    minFrequency?: number;
    limit?: number;
    offset?: number;
    search?: string;
    orderBy?: 'frequency' | 'last_seen_at' | 'created_at';
  }): Promise<KnowledgeGapSignal[]> {
    if (isDemoMode()) return [];
    const { status, minFrequency, limit = 50, offset = 0, search, orderBy = 'frequency' } = params;

    let query = this.client.from('knowledge_gap_signals').select('*');
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      query = query.in('status', statuses);
    }
    if (minFrequency !== undefined) {
      query = query.gte('frequency', minFrequency);
    }
    if (search) {
      query = query.or(`sample_question.ilike.%${search}%,question_category.ilike.%${search}%`);
    }
    if (orderBy === 'frequency') query = query.order('frequency', { ascending: false });
    else if (orderBy === 'last_seen_at') query = query.order('last_seen_at', { ascending: false });
    else query = query.order('created_at', { ascending: false });

    query = query.range(offset, offset + Math.min(limit, 200) - 1);

    const { data, error } = await query;
    if (error) throw new RepositoryError('list gap signals', error.message, error.code);
    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
  }

  async count(params: {
    status?: KnowledgeGapStatus | KnowledgeGapStatus[];
    minFrequency?: number;
    search?: string;
  }): Promise<number> {
    if (isDemoMode()) return 0;
    const { status, minFrequency, search } = params;

    let query = this.client.from('knowledge_gap_signals').select('id', { count: 'exact', head: true });
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      query = query.in('status', statuses);
    }
    if (minFrequency !== undefined) {
      query = query.gte('frequency', minFrequency);
    }
    if (search) {
      query = query.or(`sample_question.ilike.%${search}%,question_category.ilike.%${search}%`);
    }

    const { count, error } = await query;
    if (error) throw new RepositoryError('count gap signals', error.message, error.code);
    return count ?? 0;
  }

  async getById(id: string): Promise<KnowledgeGapSignal | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('knowledge_gap_signals')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new RepositoryError('get gap signal', error.message, error.code);
    return data ? this.toRow(data as Record<string, unknown>) : null;
  }

  async updateStatus(
    id: string,
    status: KnowledgeGapStatus,
    options?: {
      resolvedBy?: string;
      linkedKnowledgeItemId?: string;
      notes?: string;
    },
  ): Promise<KnowledgeGapSignal> {
    if (isDemoMode()) {
      const existing = await this.getById(id);
      if (!existing) throw new RepositoryError('update gap status', 'not found');
      return { ...existing, status, ...options } as KnowledgeGapSignal;
    }

    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'resolved') {
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = options?.resolvedBy ?? null;
    } else if (status === 'open' || status === 'in_progress') {
      updates.resolved_at = null;
      updates.resolved_by = null;
    }
    if (options?.linkedKnowledgeItemId !== undefined) {
      updates.linked_knowledge_item_id = options.linkedKnowledgeItemId;
    }
    if (options?.notes !== undefined) {
      updates.notes = options.notes;
    }

    const { data, error } = await this.client
      .from('knowledge_gap_signals')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new RepositoryError('update gap status', error.message, error.code);
    return this.toRow(data as Record<string, unknown>);
  }

  async getStats(): Promise<KnowledgeGapStats> {
    if (isDemoMode()) {
      return { total: 0, open: 0, in_progress: 0, resolved: 0, dismissed: 0, top_concerns: [] };
    }

    // Use database-level aggregation for better performance
    // Count all records using a simple select with head: true
    const { count: totalCount, error: statusErr } = await this.client
      .from('knowledge_gap_signals')
      .select('*', { count: 'exact', head: true });

    if (statusErr) throw new RepositoryError('get gap stats', statusErr.message, statusErr.code);

    // Get status breakdown via RPC or individual queries
    const { data: openData } = await this.client
      .from('knowledge_gap_signals')
      .select('frequency, sample_question, question_hash')
      .eq('status', 'open')
      .order('frequency', { ascending: false })
      .limit(5);

    const stats: KnowledgeGapStats = {
      total: totalCount ?? 0,
      open: 0,
      in_progress: 0,
      resolved: 0,
      dismissed: 0,
      top_concerns: [],
    };

    // Count by status using individual queries (more efficient than loading all data)
    const statusGroups = ['open', 'in_progress', 'resolved', 'dismissed'] as const;
    await Promise.all(statusGroups.map(async (status) => {
      const { count } = await this.client
        .from('knowledge_gap_signals')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      stats[status] = count ?? 0;
    }));

    // Top concerns from open gaps
    const openRows = (openData ?? []) as Array<{
      frequency: number;
      sample_question: string;
      question_hash: string;
    }>;
    stats.top_concerns = openRows.map((r) => ({
      question_hash: r.question_hash,
      sample_question: r.sample_question,
      frequency: r.frequency,
    }));

    return stats;
  }

  /**
   * Find a gap by its normalized question hash (useful for re-resolution checks).
   */
  async findByHash(questionHash: string): Promise<KnowledgeGapSignal | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('knowledge_gap_signals')
      .select('*')
      .eq('question_hash', questionHash)
      .maybeSingle();
    if (error) throw new RepositoryError('find gap by hash', error.message, error.code);
    return data ? this.toRow(data as Record<string, unknown>) : null;
  }

  private toRow(row: Record<string, unknown>): KnowledgeGapSignal {
    return {
      id: String(row.id ?? ''),
      question_hash: String(row.question_hash ?? ''),
      sample_question: String(row.sample_question ?? ''),
      question_category: (row.question_category as string | null) ?? null,
      frequency: Number(row.frequency ?? 0),
      first_seen_at: String(row.first_seen_at ?? ''),
      last_seen_at: String(row.last_seen_at ?? ''),
      last_top_score: (row.last_top_score as number | null) ?? null,
      triggers_handoff: Boolean(row.triggers_handoff),
      source_conversation_ids: Array.isArray(row.source_conversation_ids)
        ? (row.source_conversation_ids as string[])
        : [],
      status: (row.status as KnowledgeGapStatus) ?? 'open',
      resolved_by: (row.resolved_by as string | null) ?? null,
      resolved_at: (row.resolved_at as string | null) ?? null,
      linked_knowledge_item_id: (row.linked_knowledge_item_id as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    };
  }
}
