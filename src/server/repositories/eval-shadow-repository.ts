import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface EvalShadowRunRow {
  id: string;
  conversation_id: string;
  message_id: string;
  bot_id: string;
  shop_id: string | null;
  cohort: 'treatment' | 'control';
  dataset_version_id: string | null;
  baseline_config_hash: string;
  candidate_config_hash: string;
  baseline_decision: string;
  candidate_decision: string;
  baseline_citations: unknown[];
  candidate_citations: unknown[];
  baseline_answer: string;
  candidate_answer: string;
  baseline_confidence: number;
  candidate_confidence: number;
  first_token_latency_ms_baseline: number;
  first_token_latency_ms_candidate: number;
  agreement_decision: boolean;
  agreement_citations: number;
  agreement_answer: number;
  created_at: string;
}

export interface ShadowComparatorRow {
  bot_id: string;
  shop_id: string | null;
  n: number;
  baseline_metrics: {
    answer_correct: number;
    cite_precision: number;
    recall_at_10: number;
    false_handoff_rate: number;
  };
  candidate_metrics: {
    answer_correct: number;
    cite_precision: number;
    recall_at_10: number;
    false_handoff_rate: number;
  };
  delta: {
    answer_correct: number;
    cite_precision: number;
    recall_at_10: number;
    false_handoff_rate: number;
  };
}

export class EvalShadowRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async insert(
    input: Omit<EvalShadowRunRow, 'id' | 'created_at'>,
  ): Promise<string> {
    if (isDemoMode()) {
      return 'demo-shadow-' + Date.now();
    }

    const { data, error } = await this.client
      .from('eval_shadow_runs')
      .insert({
        conversation_id: input.conversation_id,
        message_id: input.message_id,
        bot_id: input.bot_id,
        shop_id: input.shop_id,
        cohort: input.cohort,
        dataset_version_id: input.dataset_version_id,
        baseline_config_hash: input.baseline_config_hash,
        candidate_config_hash: input.candidate_config_hash,
        baseline_decision: input.baseline_decision,
        candidate_decision: input.candidate_decision,
        baseline_citations: input.baseline_citations,
        candidate_citations: input.candidate_citations,
        baseline_answer: input.baseline_answer,
        candidate_answer: input.candidate_answer,
        baseline_confidence: input.baseline_confidence,
        candidate_confidence: input.candidate_confidence,
        first_token_latency_ms_baseline: input.first_token_latency_ms_baseline,
        first_token_latency_ms_candidate: input.first_token_latency_ms_candidate,
        agreement_decision: input.agreement_decision,
        agreement_citations: input.agreement_citations,
        agreement_answer: input.agreement_answer,
      })
      .select('id')
      .single();

    if (error) {
      throw new RepositoryError('insert eval shadow run', error.message, error.code);
    }

    return String((data as Record<string, unknown>).id);
  }

  async getRuns(args: {
    botId?: string;
    shopId?: string;
    cohort?: 'treatment' | 'control';
    limit?: number;
    offset?: number;
    sinceDays?: number;
  }): Promise<{ rows: EvalShadowRunRow[]; total: number }> {
    if (isDemoMode()) {
      return { rows: [], total: 0 };
    }

    const { botId, shopId, cohort, limit = 50, offset = 0, sinceDays } = args;

    let query = this.client
      .from('eval_shadow_runs')
      .select('*', { count: 'exact', head: false });

    if (botId) {
      query = query.eq('bot_id', botId);
    }
    if (shopId !== undefined) {
      query = query.eq('shop_id', shopId);
    }
    if (cohort) {
      query = query.eq('cohort', cohort);
    }
    if (sinceDays !== undefined && sinceDays > 0) {
      const since = new Date();
      since.setDate(since.getDate() - sinceDays);
      query = query.gte('created_at', since.toISOString());
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new RepositoryError('get eval shadow runs', error.message, error.code);
    }

    const rows: EvalShadowRunRow[] = (data ?? []).map((row) =>
      this.toRow(row as Record<string, unknown>),
    );

    return { rows, total: count ?? 0 };
  }

  async getComparator(args: {
    botId: string;
    shopId: string | null;
    windowDays?: number;
    minN?: number;
  }): Promise<ShadowComparatorRow | null> {
    if (isDemoMode()) {
      return null;
    }

    const { botId, shopId, windowDays, minN = 10 } = args;

    const since = new Date();
    since.setDate(since.getDate() - (windowDays ?? 30));

    const { data, error } = await this.client
      .from('eval_shadow_runs')
      .select(
        `
        cohort,
        agreement_decision,
        agreement_citations,
        agreement_answer,
        baseline_decision,
        candidate_decision
        `,
      )
      .eq('bot_id', botId)
      .or(`shop_id.eq.${shopId ?? ''},shop_id.is.null`)
      .gte('created_at', since.toISOString());

    if (error) {
      throw new RepositoryError('get shadow comparator', error.message, error.code);
    }

    if (!data || data.length === 0) return null;

    // Compute per-cohort aggregates
    const baselineRows = (data as Record<string, unknown>[]).filter(
      (r) => r.cohort === 'control',
    );
    const candidateRows = (data as Record<string, unknown>[]).filter(
      (r) => r.cohort === 'treatment',
    );

    if (baselineRows.length < minN || candidateRows.length < minN) {
      return null;
    }

    const baselineMetrics = this.computeMetrics(baselineRows);
    const candidateMetrics = this.computeMetrics(candidateRows);

    return {
      bot_id: botId,
      shop_id: shopId,
      n: Math.min(baselineRows.length, candidateRows.length), // paired comparison: use smaller cohort size
      baseline_metrics: baselineMetrics,
      candidate_metrics: candidateMetrics,
      delta: {
        answer_correct:
          candidateMetrics.answer_correct - baselineMetrics.answer_correct,
        cite_precision:
          candidateMetrics.cite_precision - baselineMetrics.cite_precision,
        recall_at_10:
          candidateMetrics.recall_at_10 - baselineMetrics.recall_at_10,
        false_handoff_rate:
          candidateMetrics.false_handoff_rate - baselineMetrics.false_handoff_rate,
      },
    };
  }

  private computeMetrics(
    rows: Record<string, unknown>[],
  ): ShadowComparatorRow['baseline_metrics'] {
    const n = rows.length;
    if (n === 0) {
      return { answer_correct: 0, cite_precision: 0, recall_at_10: 0, false_handoff_rate: 0 };
    }

    const sumAgreementDecision = rows.reduce(
      (acc, r) => acc + (r.agreement_decision ? 1 : 0),
      0,
    );
    const sumAgreementCitations = rows.reduce(
      (acc, r) => acc + Number(r.agreement_citations ?? 0),
      0,
    );
    const sumAgreementAnswer = rows.reduce(
      (acc, r) => acc + Number(r.agreement_answer ?? 0),
      0,
    );

    // false_handoff_rate: ratio of runs where decision was 'skip' (no retrieval, no handoff)
    const sumFalseHandoff = rows.reduce(
      (acc, r) => acc + ((r.baseline_decision ?? r.candidate_decision ?? '') === 'skip' ? 1 : 0),
      0,
    );

    return {
      // answer_correct proxy: agreement on decision × answer similarity
      answer_correct: (sumAgreementDecision / n) * (sumAgreementAnswer / n),
      // cite_precision proxy: average Jaccard similarity of citations
      cite_precision: sumAgreementCitations / n,
      // recall_at_10 proxy: answer similarity (proxy for recall given no gold labels here)
      recall_at_10: sumAgreementAnswer / n,
      // false_handoff_rate: fraction of runs where both pipelines decided 'skip'
      false_handoff_rate: sumFalseHandoff / n,
    };
  }

  private toRow(row: Record<string, unknown>): EvalShadowRunRow {
    return {
      id: String(row.id ?? ''),
      conversation_id: String(row.conversation_id ?? ''),
      message_id: String(row.message_id ?? ''),
      bot_id: String(row.bot_id ?? ''),
      shop_id: (row.shop_id as string | null) ?? null,
      cohort: (row.cohort as EvalShadowRunRow['cohort']) ?? 'control',
      dataset_version_id: (row.dataset_version_id as string | null) ?? null,
      baseline_config_hash: String(row.baseline_config_hash ?? ''),
      candidate_config_hash: String(row.candidate_config_hash ?? ''),
      baseline_decision: String(row.baseline_decision ?? ''),
      candidate_decision: String(row.candidate_decision ?? ''),
      baseline_citations: Array.isArray(row.baseline_citations)
        ? row.baseline_citations
        : [],
      candidate_citations: Array.isArray(row.candidate_citations)
        ? row.candidate_citations
        : [],
      baseline_answer: String(row.baseline_answer ?? ''),
      candidate_answer: String(row.candidate_answer ?? ''),
      baseline_confidence: Number(row.baseline_confidence ?? 0),
      candidate_confidence: Number(row.candidate_confidence ?? 0),
      first_token_latency_ms_baseline: Number(
        row.first_token_latency_ms_baseline ?? 0,
      ),
      first_token_latency_ms_candidate: Number(
        row.first_token_latency_ms_candidate ?? 0,
      ),
      agreement_decision: Boolean(row.agreement_decision ?? false),
      agreement_citations: Number(row.agreement_citations ?? 0),
      agreement_answer: Number(row.agreement_answer ?? 0),
      created_at: String(row.created_at ?? ''),
    };
  }
}
