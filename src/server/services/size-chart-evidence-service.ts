/**
 * P3 Phase 4 — Size Chart Evidence Service.
 *
 * Extracts evidence metadata from size chart search results and computes stable
 * content hashes for citation stability.
 */
import { createHash } from 'node:crypto';
import type { NormalizedSizeChart } from '@/server/repositories/size-chart-repository';
import { SizeChartRepository } from '@/server/repositories/size-chart-repository';
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
 * Build a stable SHA-256 content hash for citation stability.
 */
function buildContextHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
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
      chart.product_ids[0] ?? '',
      chart.sku ?? '',
    ].join('|');

    return {
      size_chart_id: chart.id,
      name: chart.name,
      category: chart.category,
      chart_type: chart.chart_type,
      product_id: chart.product_ids[0] ?? null,
      sku: chart.sku,
      content_hash: chart.content_hash,
      doc_ids: Array.isArray(chart.doc_ids) ? chart.doc_ids : [],
      hit_count: chart.hit_count ?? 0,
      context_hash: buildContextHash(contextSource),
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
      const repo = new SizeChartRepository();
      await repo.incrementHitCount(chartId);
    } catch (err) {
      logger.agent.debug('[SizeChartEvidenceService] Failed to record hit', { chartId, error: err });
    }
  }
}
