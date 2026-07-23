import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { RepositoryError } from './repository-error';

export interface EvalContinuousThresholdRow {
  id: string;
  metric: string;
  lower_threshold: number;
  upper_threshold: number;
  threshold_type: 'ci_lower' | 'ci_upper';
  created_at: string;
  updated_at: string;
}

export class EvalContinuousThresholdsRepository {
  private client = getSupabaseClient();

  async list(): Promise<EvalContinuousThresholdRow[]> {
    if (isDemoMode()) return [];
    const { data, error } = await this.client
      .from('eval_continuous_gate_thresholds')
      .select('*')
      .order('metric', { ascending: true });
    if (error) return [];
    return (data ?? []) as EvalContinuousThresholdRow[];
  }

  async getByMetrics(metrics: string[]): Promise<EvalContinuousThresholdRow[]> {
    if (isDemoMode()) return [];
    const { data, error } = await this.client
      .from('eval_continuous_gate_thresholds')
      .select('*')
      .in('metric', metrics)
      .order('metric', { ascending: true });
    if (error) return [];
    return (data ?? []) as EvalContinuousThresholdRow[];
  }
}
