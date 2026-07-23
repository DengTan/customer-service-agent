/**
 * P3 Phase 4 — Size Chart Evidence Service.
 *
 * Extracts evidence metadata from size chart search results and computes stable
 * content hashes for citation stability.
 */
import type { NormalizedSizeChart } from '@/server/repositories/size-chart-repository';
import { logger } from '@/lib/logger';

export interface SizeChartEvidence {
  size_chart_id: string;
  name: string;
  category: string | null;
  chart_type: string | null;
  product_id: string | null;
  sku: string | null;
  content_hash: string | null;
  doc_ids: string[];
  hit_count: number;
  context_hash: string | null; // stable hash for citation
}

export interface SearchSizeChartsResult {
  items: SizeChartEvidence[];
  total: number;
}

/**
 * Simple non-crypto hash for stable context hashing.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `size_${Math.abs(hash).toString(36)}`;
}

export class SizeChartEvidenceService {
  /**
   * Extract evidence from a size chart result.
   */
  extractEvidence(chart: NormalizedSizeChart): SizeChartEvidence {
    const contextSource = [
      chart.id,
      chart.name,
      chart.category,
      chart.chart_type,
      chart.product_id ?? '',
      chart.sku ?? '',
    ].join('|');

    return {
      size_chart_id: chart.id,
      name: chart.name,
      category: chart.category,
      chart_type: chart.chart_type,
      product_id: chart.product_id,
      sku: chart.sku,
      content_hash: chart.content_hash,
      doc_ids: Array.isArray(chart.doc_ids) ? chart.doc_ids : [],
      hit_count: chart.hit_count ?? 0,
      context_hash: simpleHash(contextSource),
    };
  }

  /**
   * Extract evidence from multiple size chart results.
   */
  extractBatch(charts: NormalizedSizeChart[]): SizeChartEvidence[] {
    return charts.map(c => this.extractEvidence(c));
  }

  /**
   * Increment hit count for a size chart (fire-and-forget).
   */
  async recordHit(chartId: string): Promise<void> {
    try {
      const { getSupabaseClient } = await import('@/storage/database/supabase-client');
      const client = getSupabaseClient();
      await client.rpc('increment_hit_count', { chart_id: chartId });
    } catch (err) {
      logger.agent.debug('[SizeChartEvidenceService] Failed to record hit', { chartId, error: err });
    }
  }
}
