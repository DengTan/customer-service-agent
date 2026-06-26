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
   * Record a gap signal. If a row with the same question_hash already exists, increment
   * frequency and update last_seen_at; otherwise insert a new row.
   */
  async recordSignal(params: RecordGapParams): Promise<KnowledgeGapSignal> {
    if (isDemoMode()) {
      // Demo mode: just no-op
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

    // Use a Postgres function via RPC if available; otherwise fetch-then-upsert pattern.
    // Supabase JS doesn't support INSERT ... ON CONFLICT DO UPDATE with RETURNING directly,
    // but upsert() does. We use upsert + select.
    const now = new Date().toISOString();

    // First, try to read the existing row
    const { data: existing, error: readErr } = await this.client
      .from('knowledge_gap_signals')
      .select('*')
      .eq('question_hash', params.questionHash)
      .maybeSingle();
    if (readErr) throw new RepositoryError('read gap signal', readErr.message, readErr.code);

    if (existing) {
      const row = existing as KnowledgeGapSignal;
      const mergedConvs = Array.from(
        new Set([...(row.source_conversation_ids || []), params.conversationId]),
      ).slice(-MAX_CONVERSATION_REFS);
      const updates = {
        frequency: row.frequency + 1,
        last_seen_at: now,
        last_top_score: params.topScore ?? row.last_top_score,
        triggers_handoff: row.triggers_handoff || params.triggeredHandoff,
        source_conversation_ids: mergedConvs,
        updated_at: now,
        // If a previously-resolved gap reappears, reopen it
        ...(row.status === 'resolved' || row.status === 'dismissed'
          ? { status: 'open', resolved_at: null, resolved_by: null }
          : {}),
      };
      const { data, error } = await this.client
        .from('knowledge_gap_signals')
        .update(updates)
        .eq('id', row.id)
        .select('*')
        .single();
      if (error) throw new RepositoryError('update gap signal', error.message, error.code);
      return this.toRow(data as Record<string, unknown>);
    }

    // No existing row — insert
    const { data, error } = await this.client
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
      })
      .select('*')
      .single();
    if (error) throw new RepositoryError('insert gap signal', error.message, error.code);
    return this.toRow(data as Record<string, unknown>);
  }

  async list(params: {
    status?: KnowledgeGapStatus | KnowledgeGapStatus[];
    minFrequency?: number;
    limit?: number;
    orderBy?: 'frequency' | 'last_seen_at' | 'created_at';
  }): Promise<KnowledgeGapSignal[]> {
    if (isDemoMode()) return [];
    const { status, minFrequency, limit = 50, orderBy = 'frequency' } = params;

    let query = this.client.from('knowledge_gap_signals').select('*');
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      query = query.in('status', statuses);
    }
    if (minFrequency !== undefined) {
      query = query.gte('frequency', minFrequency);
    }
    if (orderBy === 'frequency') query = query.order('frequency', { ascending: false });
    else if (orderBy === 'last_seen_at') query = query.order('last_seen_at', { ascending: false });
    else query = query.order('created_at', { ascending: false });

    query = query.limit(Math.min(limit, 200));

    const { data, error } = await query;
    if (error) throw new RepositoryError('list gap signals', error.message, error.code);
    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
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
    const { data, error } = await this.client
      .from('knowledge_gap_signals')
      .select('status, frequency, sample_question, question_hash');
    if (error) throw new RepositoryError('get gap stats', error.message, error.code);
    const stats: KnowledgeGapStats = {
      total: 0,
      open: 0,
      in_progress: 0,
      resolved: 0,
      dismissed: 0,
      top_concerns: [],
    };
    const all = (data ?? []) as Array<{
      status: KnowledgeGapStatus;
      frequency: number;
      sample_question: string;
      question_hash: string;
    }>;
    for (const row of all) {
      stats.total += 1;
      if (row.status === 'open') stats.open += 1;
      else if (row.status === 'in_progress') stats.in_progress += 1;
      else if (row.status === 'resolved') stats.resolved += 1;
      else if (row.status === 'dismissed') stats.dismissed += 1;
    }
    stats.top_concerns = all
      .filter((r) => r.status === 'open')
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5)
      .map((r) => ({
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
