import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export type CalibrationStatus = 'frozen' | 'canary' | 'active' | 'archived';

export interface EvalCalibrationSettingsRow {
  id: string;
  dataset_version_id: string;
  bot_id: string;
  shop_id: string | null;
  min_score: number;
  rerank_backend: string;
  claim_verifier_threshold: number;
  confidence_gate: number;
  answer_correct: number;
  cite_precision: number;
  recall_at_10: number;
  false_handoff_rate: number;
  composite: number;
  fold_gap: number;
  status: CalibrationStatus;
  is_canary: boolean;
  canary_pct: number;
  fold_detail: unknown[];
  created_by: string | null;
  created_at: string;
  promoted_at: string | null;
}

export class EvalCalibrationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(
    input: Omit<EvalCalibrationSettingsRow, 'id' | 'created_at'>,
  ): Promise<EvalCalibrationSettingsRow> {
    if (isDemoMode()) {
      return this.toRow({
        id: 'demo-calibration-' + Date.now(),
        ...input,
        created_at: new Date().toISOString(),
      } as Record<string, unknown>);
    }

    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .insert({
        dataset_version_id: input.dataset_version_id,
        bot_id: input.bot_id,
        shop_id: input.shop_id,
        min_score: input.min_score,
        rerank_backend: input.rerank_backend,
        claim_verifier_threshold: input.claim_verifier_threshold,
        confidence_gate: input.confidence_gate,
        answer_correct: input.answer_correct,
        cite_precision: input.cite_precision,
        recall_at_10: input.recall_at_10,
        false_handoff_rate: input.false_handoff_rate,
        composite: input.composite,
        fold_gap: input.fold_gap,
        status: input.status,
        is_canary: input.is_canary,
        canary_pct: input.canary_pct,
        fold_detail: input.fold_detail,
        created_by: input.created_by,
        promoted_at: input.promoted_at,
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create eval calibration', error.message, error.code);
    }

    return this.toRow(data as Record<string, unknown>);
  }

  async getById(id: string): Promise<EvalCalibrationSettingsRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('get eval calibration by id', error.message, error.code);
    }

    return data ? this.toRow(data as Record<string, unknown>) : null;
  }

  /**
   * Returns the most recent 'active' calibration for the slice,
   * or the most recent 'canary' when isCanary=true.
   * shop_id NULL means "all shops" (per-bot default).
   */
  async getActiveForSlice(
    botId: string,
    shopId: string | null,
  ): Promise<EvalCalibrationSettingsRow | null> {
    if (isDemoMode()) return null;

    // Match: same bot, same shop (including NULL = all-shops)
    // Explicit NULL handling: match shop_id OR any NULL shop rows (all-shops default)
    // when shopId is null, this returns both exact-match rows AND all-shops rows
    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .select('*')
      .eq('bot_id', botId)
      .or(`shop_id.eq.${shopId ?? ''},shop_id.is.null`)
      .in('status', ['active', 'canary'])
      .order('created_at', { ascending: false });

    if (error) {
      throw new RepositoryError('get active eval calibration', error.message, error.code);
    }

    if (!data || data.length === 0) return null;

    // Prefer 'active'; fall back to 'canary'
    const active = data.find(
      (r) => (r as Record<string, unknown>).status === 'active',
    );
    if (active) return this.toRow(active as Record<string, unknown>);

    return this.toRow(data[0] as Record<string, unknown>);
  }

  async listBySlice(
    botId: string,
    shopId: string | null,
  ): Promise<EvalCalibrationSettingsRow[]> {
    if (isDemoMode()) return [];

    // Match: same bot, same shop (including NULL = all-shops)
    // Explicit NULL handling: match shop_id OR any NULL shop rows (all-shops default)
    // when shopId is null, this returns both exact-match rows AND all-shops rows
    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .select('*')
      .eq('bot_id', botId)
      .or(`shop_id.eq.${shopId ?? ''},shop_id.is.null`)
      .neq('status', 'archived')
      .order('created_at', { ascending: false });

    if (error) {
      throw new RepositoryError('list eval calibrations by slice', error.message, error.code);
    }

    return (data ?? []).map((r) => this.toRow(r as Record<string, unknown>));
  }

  /**
   * Returns the most recent active calibration config for a bot+shop slice.
   * P4 Phase 3: used by the shadow runner to load the candidate calibration config.
   */
  async findActiveCalibrations(
    botId: string,
    shopId: string | null,
  ): Promise<Array<{
    min_score: number;
    rerank_backend: string;
    claim_verifier_threshold: number;
    confidence_gate: number;
  }>> {
    if (isDemoMode()) return [];

    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .select('min_score, rerank_backend, claim_verifier_threshold, confidence_gate')
      .eq('bot_id', botId)
      .eq('status', 'active')
      .order('promoted_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return [];
    return data as Array<{
      min_score: number;
      rerank_backend: string;
      claim_verifier_threshold: number;
      confidence_gate: number;
    }>;
  }

  async updateStatus(
    id: string,
    status: CalibrationStatus,
  ): Promise<EvalCalibrationSettingsRow> {
    if (isDemoMode()) {
      return this.toRow({ id, status } as Record<string, unknown>);
    }

    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('update eval calibration status', error.message, error.code);
    }

    if (!data) {
      throw new Error(`No row found for id: ${id}`);
    }

    return this.toRow(data as Record<string, unknown>);
  }

  async promote(id: string, promotedBy: string): Promise<EvalCalibrationSettingsRow> {
    if (isDemoMode()) {
      return this.toRow({
        id,
        status: 'canary',
        is_canary: true,
        promoted_at: new Date().toISOString(),
        created_by: promotedBy,
      } as Record<string, unknown>);
    }

    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .update({ status: 'canary', is_canary: true, promoted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('promote eval calibration', error.message, error.code);
    }

    return this.toRow(data as Record<string, unknown>);
  }

  async archive(id: string): Promise<EvalCalibrationSettingsRow> {
    if (isDemoMode()) {
      return this.toRow({ id, status: 'archived', is_canary: false } as Record<string, unknown>);
    }

    const { data, error } = await this.client
      .from('eval_calibration_settings')
      .update({ status: 'archived', is_canary: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('archive eval calibration', error.message, error.code);
    }

    return this.toRow(data as Record<string, unknown>);
  }

  private toRow(row: Record<string, unknown>): EvalCalibrationSettingsRow {
    return {
      id: String(row.id ?? ''),
      dataset_version_id: String(row.dataset_version_id ?? ''),
      bot_id: String(row.bot_id ?? ''),
      shop_id: (row.shop_id as string | null) ?? null,
      min_score: Number(row.min_score ?? 0),
      rerank_backend: String(row.rerank_backend ?? ''),
      claim_verifier_threshold: Number(row.claim_verifier_threshold ?? 0),
      confidence_gate: Number(row.confidence_gate ?? 0),
      answer_correct: Number(row.answer_correct ?? 0),
      cite_precision: Number(row.cite_precision ?? 0),
      recall_at_10: Number(row.recall_at_10 ?? 0),
      false_handoff_rate: Number(row.false_handoff_rate ?? 0),
      composite: Number(row.composite ?? 0),
      fold_gap: Number(row.fold_gap ?? 0),
      status: (row.status as CalibrationStatus) ?? 'frozen',
      is_canary: Boolean(row.is_canary),
      canary_pct: Number(row.canary_pct ?? 0),
      fold_detail: Array.isArray(row.fold_detail) ? row.fold_detail : [],
      created_by: (row.created_by as string | null) ?? null,
      created_at: String(row.created_at ?? ''),
      promoted_at: (row.promoted_at as string | null) ?? null,
    };
  }
}
