import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export type ThresholdDirection = 'lower_is_worse' | 'higher_is_worse';

export interface EvalGateThresholdRow {
  id: string;
  metric: string;
  fail_at: number;
  warn_at: number;
  direction: ThresholdDirection;
  description: string;
  updated_by: string | null;
  updated_at: string;
}

export class EvalGateThresholdsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * Return all threshold rows.
   */
  async list(): Promise<EvalGateThresholdRow[]> {
    if (isDemoMode()) return [];

    const { data, error } = await this.client
      .from('eval_gate_thresholds')
      .select('*')
      .order('metric', { ascending: true });

    if (error) {
      throw new RepositoryError('list eval gate thresholds', error.message, error.code);
    }

    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
  }

  /**
   * Return thresholds for a specific set of metrics.
   */
  async getByMetrics(metrics: string[]): Promise<EvalGateThresholdRow[]> {
    if (isDemoMode()) return [];

    if (metrics.length === 0) return [];

    const { data, error } = await this.client
      .from('eval_gate_thresholds')
      .select('*')
      .in('metric', metrics);

    if (error) {
      throw new RepositoryError('get eval gate thresholds by metrics', error.message, error.code);
    }

    return (data ?? []).map((row) => this.toRow(row as Record<string, unknown>));
  }

  private toRow(row: Record<string, unknown>): EvalGateThresholdRow {
    return {
      id: String(row.id ?? ''),
      metric: String(row.metric ?? ''),
      fail_at: Number(row.fail_at ?? 0),
      warn_at: Number(row.warn_at ?? 0),
      direction: (row.direction as ThresholdDirection) ?? 'lower_is_worse',
      description: String(row.description ?? ''),
      updated_by: (row.updated_by as string | null) ?? null,
      updated_at: String(row.updated_at ?? ''),
    };
  }
}
