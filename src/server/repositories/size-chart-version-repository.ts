import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { sizeChartVersions } from '@/storage/database/shared/schema';

export interface SizeChartVersion {
  id: string;
  size_chart_id: string;
  version_number: number;
  name: string;
  chart_type: string;
  category: string | null;
  sku: string | null;
  size_columns: Array<{ key: string; label: string }>;
  size_rows: Array<Record<string, string>>;
  recommend_params: unknown | null;
  recommend_rules: string | null;
  description: string | null;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export class SizeChartVersionRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async createVersion(params: {
    size_chart_id: string;
    version_number: number;
    name: string;
    chart_type: string;
    category?: string;
    sku?: string;
    size_columns: Array<{ key: string; label: string }>;
    size_rows: Array<Record<string, string>>;
    recommend_params: unknown;
    recommend_rules?: string;
    description?: string;
    change_summary?: string;
    created_by?: string;
  }) {
    const { data, error } = await this.client.from('size_chart_versions').insert({
      size_chart_id: params.size_chart_id,
      version_number: params.version_number,
      name: params.name,
      chart_type: params.chart_type,
      category: params.category || null,
      sku: params.sku || null,
      size_columns: params.size_columns,
      size_rows: params.size_rows,
      recommend_params: params.recommend_params,
      recommend_rules: params.recommend_rules || null,
      description: params.description || null,
      change_summary: params.change_summary || null,
      created_by: params.created_by || null,
    }).select().single();

    if (error) throw error;
    return data as SizeChartVersion;
  }

  async getVersions(sizeChartId: string): Promise<SizeChartVersion[]> {
    const { data, error } = await this.client
      .from('size_chart_versions')
      .select('*')
      .eq('size_chart_id', sizeChartId)
      .order('version_number', { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data || []) as SizeChartVersion[];
  }

  async getVersionById(versionId: string): Promise<SizeChartVersion | null> {
    const { data, error } = await this.client
      .from('size_chart_versions')
      .select('*')
      .eq('id', versionId)
      .limit(1);

    if (error) throw error;
    return (data?.[0] as SizeChartVersion) || null;
  }

  async getLatestVersionNumber(sizeChartId: string): Promise<number> {
    const { data, error } = await this.client
      .from('size_chart_versions')
      .select('version_number')
      .eq('size_chart_id', sizeChartId)
      .order('version_number', { ascending: false })
      .limit(1);

    if (error || !data?.length) return 0;
    return (data[0] as { version_number: number }).version_number;
  }
}
