import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export type RegressionRunKind = 'ci' | 'continuous' | 'manual';
export type RegressionRunStatus = 'pass' | 'warn' | 'fail';

/** A single metric result stored in the metrics JSONB column. */
export interface MetricResult {
  value: number;
  ci_lower: number;
  ci_upper: number;
  threshold: number;
}

export interface EvalRegressionRunRow {
  id: string;
  dataset_version_id: string;
  run_kind: RegressionRunKind;
  status: RegressionRunStatus;
  metrics: Record<string, MetricResult>;
  started_at: string;
  finished_at: string;
  triggered_by: string | null;
}

export class EvalRegressionRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * Persist a completed regression run.
   */
  async create(input: Omit<EvalRegressionRunRow, 'id'>): Promise<EvalRegressionRunRow> {
    if (isDemoMode()) {
      return {
        id: 'demo-regression-' + Date.now(),
        ...input,
      };
    }

    if (!['pass', 'warn', 'fail'].includes(input.status)) {
      throw new Error(`Invalid status: ${input.status}. Must be 'pass', 'warn', or 'fail'.`);
    }
    if (!['ci', 'continuous', 'manual'].includes(input.run_kind)) {
      throw new Error(`Invalid run_kind: ${input.run_kind}. Must be 'ci', 'continuous', or 'manual'.`);
    }

    const { data, error } = await this.client
      .from('eval_regression_runs')
      .insert({
        dataset_version_id: input.dataset_version_id,
        run_kind: input.run_kind,
        status: input.status,
        metrics: input.metrics,
        started_at: input.started_at,
        finished_at: input.finished_at,
        triggered_by: input.triggered_by,
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create eval regression run', error.message, error.code);
    }

    return this.toRow(data as Record<string, unknown>);
  }

  /**
   * List regression runs, ordered by started_at descending.
   * @param kind Filter by run_kind (optional)
   * @param limit Maximum rows to return
   */
  async list(kind?: RegressionRunKind, limit = 20): Promise<EvalRegressionRunRow[]> {
    if (isDemoMode()) return [];

    let query = this.client
      .from('eval_regression_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (kind) {
      query = query.eq('run_kind', kind);
    }

    const { data, error } = await query;

    if (error) {
      throw new RepositoryError('list eval regression runs', error.message, error.code);
    }

    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
  }

  /**
   * Get the most recent regression run for a given kind.
   */
  async latest(kind: RegressionRunKind): Promise<EvalRegressionRunRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('eval_regression_runs')
      .select('*')
      .eq('run_kind', kind)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('get latest eval regression run', error.message, error.code);
    }

    return data ? this.toRow(data as Record<string, unknown>) : null;
  }

  private toRow(row: Record<string, unknown>): EvalRegressionRunRow {
    const metricsRaw = row.metrics;
    const metrics: Record<string, MetricResult> = {};
    if (metricsRaw && typeof metricsRaw === 'object') {
      for (const [k, v] of Object.entries(metricsRaw as Record<string, unknown>)) {
        if (v && typeof v === 'object') {
          const m = v as Record<string, unknown>;
          metrics[k] = {
            value: Number(m.value ?? 0),
            ci_lower: Number(m.ci_lower ?? 0),
            ci_upper: Number(m.ci_upper ?? 1),
            threshold: Number(m.threshold ?? 0),
          };
        }
      }
    }

    return {
      id: String(row.id ?? ''),
      dataset_version_id: String(row.dataset_version_id ?? ''),
      run_kind: (row.run_kind as RegressionRunKind) ?? 'ci',
      status: (row.status as RegressionRunStatus) ?? 'pass',
      metrics,
      started_at: String(row.started_at ?? ''),
      finished_at: String(row.finished_at ?? ''),
      triggered_by: (row.triggered_by as string | null) ?? null,
    };
  }
}
