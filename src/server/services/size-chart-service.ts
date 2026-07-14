/**
 * Size Chart Service
 * Business logic for size chart CRUD, vectorization, and LLM search
 */

import { createHash } from 'node:crypto';
import { getEmbeddingService } from './embedding-service';
import {
  SizeChartRepository,
  type NormalizedSizeChart,
  type SizeChartFilters,
  type CreateSizeChartInput,
  type UpdateSizeChartInput,
  type SizeChartRecommendDimension,
} from '@/server/repositories/size-chart-repository';
import {
  SizeChartVersionRepository,
  type SizeChartVersion,
} from '@/server/repositories/size-chart-version-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';
import { deleteStorageFile } from '@/lib/storage-cleanup';

// ─── Content Hash ─────────────────────────────────────────────────────────────

/** Build a deterministic SHA-256 hash of size chart content for deduplication */
export function buildSizeChartContentHash(chart: {
  name: string;
  chart_type?: string;
  size_columns?: Array<{ key: string; label: string }>;
  size_rows?: Array<Record<string, string>>;
  product_id?: string | null;
}): string {
  const raw = [
    chart.name,
    chart.chart_type || '',
    JSON.stringify(chart.size_columns || []),
    JSON.stringify(chart.size_rows || []),
    chart.product_id || '',
  ].join('||');
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Text Content ─────────────────────────────────────────────────────────────

/** Build a searchable text summary of a size chart for vectorization and LLM context */
function buildSizeChartTextContent(chart: {
  name: string;
  chart_type: string;
  category?: string;
  size_columns: Array<{ key: string; label: string }>;
  size_rows: Array<Record<string, string>>;
  recommend_rules?: string | null;
  description?: string | null;
}): string {
  const chartTypeLabels: Record<string, string> = {
    clothing: '服装',
    shoes: '鞋类',
    accessories: '配饰',
    custom: '自定义',
  };

  const columnLabels = chart.size_columns.map(c => c.label).join('、');
  const rowTexts = chart.size_rows.map(row => {
    return chart.size_columns.map(c => `${c.label}: ${row[c.key] || '-'}`).join(', ');
  });

  const parts: (string | null)[] = [
    `【尺码表名称】${chart.name}`,
    `【尺码表类型】${chartTypeLabels[chart.chart_type] || chart.chart_type}`,
    chart.category ? `【适用分类】${chart.category}` : null,
    `【尺码列】${columnLabels}`,
    chart.size_rows.length > 0
      ? `【尺码数据】\n${rowTexts.join('\n')}`
      : null,
    chart.recommend_rules ? `【推荐规则】${chart.recommend_rules}` : null,
    chart.description ? `【补充说明】${chart.description}` : null,
  ].filter(Boolean) as string[];

  return parts.join('\n');
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface SizeChartRecommendation {
  size: string;
  reason: string;
}

export interface SizeChartSearchResult {
  sizeChartContext: string;
  matchedSizeChartIds: string[];
}

export class SizeChartService {
  constructor(private readonly repository = new SizeChartRepository()) {}

  /**
   * List size charts with filters, stats, and pagination.
   */
  async listSizeCharts(
    filters: SizeChartFilters = {},
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: NormalizedSizeChart[];
    categories: Record<string, number>;
    statuses: Record<string, number>;
    chartTypes: Record<string, number>;
    total: number;
  }> {
    try {
      return await this.repository.list(filters, options);
    } catch (error) {
      throw toServiceError(error, '获取尺码表列表失败', 'DB_QUERY_ERROR');
    }
  }

  /**
   * Get a single size chart by ID.
   */
  async getSizeChart(id: string): Promise<NormalizedSizeChart> {
    if (!id?.trim()) {
      throw new ServiceError('尺码表ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const chart = await this.repository.findById(id);
      if (!chart) {
        throw new ServiceError('尺码表不存在', { status: 404, code: 'NOT_FOUND' });
      }
      return chart;
    } catch (error) {
      throw toServiceError(error, '获取尺码表详情失败', 'DB_QUERY_ERROR');
    }
  }

  /**
   * Get size charts by product ID.
   */
  async getSizeChartsByProductId(productId: string): Promise<NormalizedSizeChart[]> {
    if (!productId?.trim()) {
      throw new ServiceError('商品ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      return await this.repository.findByProductId(productId);
    } catch (error) {
      throw toServiceError(error, '获取商品关联尺码表失败', 'DB_QUERY_ERROR');
    }
  }

  /**
   * Create a new size chart.
   * - Validates required fields
   * - Checks content hash deduplication
   * - Vectorizes via Coze SDK and stores doc_ids
   * - Inserts into size_charts table
   */
  async createSizeChart(input: {
    name: string;
    category?: string;
    parent_category?: string | null;
    chart_type?: string;
    size_columns: Array<{ key: string; label: string }>;
    size_rows: Array<Record<string, string>>;
    product_id?: string | null;
    sku?: string | null;
    recommend_params?: { dimensions: SizeChartRecommendDimension[] } | null;
    recommend_rules?: string | null;
    description?: string | null;
    image_url?: string | null;
    platform_connection_id?: string | null;
  }): Promise<NormalizedSizeChart> {
    // ── Validation ──────────────────────────────────────────────────────────
    if (!input.name?.trim()) {
      throw new ServiceError('尺码表名称不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!Array.isArray(input.size_columns) || input.size_columns.length === 0) {
      throw new ServiceError('尺码列定义不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!Array.isArray(input.size_rows) || input.size_rows.length === 0) {
      throw new ServiceError('尺码数据不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // ── Content hash deduplication ──────────────────────────────────────────
    const contentHash = buildSizeChartContentHash({
      name: input.name.trim(),
      chart_type: input.chart_type,
      size_columns: input.size_columns,
      size_rows: input.size_rows,
      product_id: input.product_id,
    });

    try {
      const existingByHash = await this.repository.findByContentHash(contentHash);
      if (existingByHash) {
        throw new ServiceError('尺码表内容重复（相同名称、类型和数据），无需重复添加', {
          status: 409,
          code: 'DUPLICATE_CONTENT',
        });
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '内容去重检查失败', 'DB_ERROR');
    }

    // ── Vectorize ───────────────────────────────────────────────────────────
    const doc_ids = await this.vectorizeSizeChart(input);

    // ── Save ───────────────────────────────────────────────────────────────
    try {
      const createInput: CreateSizeChartInput = {
        name: input.name.trim(),
        category: input.category?.trim() || '未分类',
        parent_category: input.parent_category ?? null,
        chart_type: (input.chart_type as CreateSizeChartInput['chart_type']) || 'clothing',
        size_columns: input.size_columns,
        size_rows: input.size_rows,
        product_id: input.product_id ?? null,
        sku: input.sku ?? null,
        recommend_params: input.recommend_params ?? null,
        recommend_rules: input.recommend_rules ?? null,
        description: input.description ?? null,
        image_url: input.image_url ?? null,
        doc_ids,
        content_hash: contentHash,
        platform_connection_id: input.platform_connection_id ?? null,
      };
      return await this.repository.create(createInput);
    } catch (error) {
      // Rollback: delete vector documents if DB write fails
      if (doc_ids.length > 0) {
        try {
          await this.deleteVectorDocuments(doc_ids);
        } catch {
          logger.api.warn('size-chart-vector-rollback-failed', { docIds: doc_ids });
        }
      }
      throw toServiceError(error, '创建尺码表失败', 'DB_ERROR');
    }
  }

  /**
   * Update an existing size chart.
   * - Re-vectorizes if size data changed
   */
  async updateSizeChart(input: {
    id: string;
    name?: string;
    category?: string;
    parent_category?: string | null;
    chart_type?: string;
    size_columns?: Array<{ key: string; label: string }>;
    size_rows?: Array<Record<string, string>>;
    product_id?: string | null;
    sku?: string | null;
    recommend_params?: { dimensions: SizeChartRecommendDimension[] } | null;
    recommend_rules?: string | null;
    description?: string | null;
    image_url?: string | null;
    status?: string;
    platform_connection_id?: string | null;
  }): Promise<NormalizedSizeChart> {
    if (!input.id?.trim()) {
      throw new ServiceError('尺码表ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repository.findById(input.id);
      if (!existing) {
        throw new ServiceError('尺码表不存在', { status: 404, code: 'NOT_FOUND' });
      }

      // Determine if size data changed (requires re-vectorization)
      const sizeDataChanged =
        (input.size_columns !== undefined && JSON.stringify(input.size_columns) !== JSON.stringify(existing.size_columns)) ||
        (input.size_rows !== undefined && JSON.stringify(input.size_rows) !== JSON.stringify(existing.size_rows));

      let newDocIds = existing.doc_ids;

      if (sizeDataChanged) {
        // Delete old vector documents
        await this.deleteVectorDocuments(existing.doc_ids);
        // Re-vectorize with new data
        newDocIds = await this.vectorizeSizeChart({
          name: input.name ?? existing.name,
          chart_type: input.chart_type ?? existing.chart_type,
          category: input.category ?? existing.category,
          size_columns: input.size_columns ?? existing.size_columns,
          size_rows: input.size_rows ?? existing.size_rows,
          recommend_rules: input.recommend_rules ?? existing.recommend_rules,
          description: input.description ?? existing.description,
        });
      }

      const updateInput: UpdateSizeChartInput = {
        id: input.id,
        name: input.name,
        category: input.category,
        parent_category: input.parent_category,
        chart_type: input.chart_type as UpdateSizeChartInput['chart_type'],
        size_columns: input.size_columns,
        size_rows: input.size_rows,
        product_id: input.product_id,
        sku: input.sku,
        recommend_params: input.recommend_params,
        recommend_rules: input.recommend_rules,
        description: input.description,
        image_url: input.image_url,
        doc_ids: newDocIds,
        content_hash: sizeDataChanged ? buildSizeChartContentHash({
          name: input.name ?? existing.name,
          chart_type: input.chart_type ?? existing.chart_type,
          size_columns: input.size_columns ?? existing.size_columns,
          size_rows: input.size_rows ?? existing.size_rows,
          product_id: input.product_id ?? existing.product_id,
        }) : undefined,
        status: input.status as UpdateSizeChartInput['status'],
        platform_connection_id: input.platform_connection_id,
      };

      await this.repository.update(updateInput);
      return await this.getSizeChart(input.id);
    } catch (error) {
      throw toServiceError(error, '更新尺码表失败', 'DB_ERROR');
    }
  }

  /**
   * Delete a size chart.
   */
  async deleteSizeChart(id: string): Promise<void> {
    if (!id?.trim()) {
      throw new ServiceError('尺码表ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const existing = await this.repository.findById(id);
      if (!existing) {
        throw new ServiceError('尺码表不存在', { status: 404, code: 'NOT_FOUND' });
      }
      // Delete vector documents
      await this.deleteVectorDocuments(existing.doc_ids);

      // Delete size chart image from storage (fire-and-forget)
      if (existing.image_url) {
        deleteStorageFile(existing.image_url);
      }

      await this.repository.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除尺码表失败', 'DB_ERROR');
    }
  }

  /**
   * Format a single size chart as an LLM-readable context block.
   */
  formatSizeChartForLLM(chart: NormalizedSizeChart): string {
    const parts: string[] = [
      `【尺码表名称】${chart.name}`,
      `【类型】${chart.chart_type}`,
    ];
    if (chart.category) parts.push(`【分类】${chart.category}`);
    if (chart.sku) parts.push(`【关联商品SKU】${chart.sku}`);

    // Table header
    if (chart.size_columns.length > 0 && chart.size_rows.length > 0) {
      const header = chart.size_columns.map(c => c.label).join(' | ');
      parts.push(`【尺码数据】`);
      parts.push(`  ${header}`);
      chart.size_rows.forEach(row => {
        const values = chart.size_columns.map(c => row[c.key] || '-').join(' | ');
        parts.push(`  ${values}`);
      });
    }

    if (chart.recommend_rules) parts.push(`【推荐规则】${chart.recommend_rules}`);
    if (chart.description) parts.push(`【补充说明】${chart.description}`);
    if (chart.image_url) parts.push(`【尺码表示意图】${chart.image_url}`);
    if (chart.status !== 'active') parts.push(`【状态】${chart.status === 'disabled' ? '已禁用' : chart.status}`);

    return parts.join('\n');
  }

  /**
   * Generate a size recommendation based on buyer's measurements.
   */
  recommendSize(
    chart: NormalizedSizeChart,
    measurements: Record<string, string | number>,
  ): SizeChartRecommendation | null {
    if (!chart.recommend_params?.dimensions || chart.size_rows.length === 0) {
      return null;
    }

    const dimensions = chart.recommend_params.dimensions;
    const sizeColumn = chart.size_columns.find(c => c.key === 'size');
    if (!sizeColumn) return null;

    // For clothing: try to match based on measurements
    // Simple algorithm: find the row whose measurement columns encompass the buyer's measurements
    for (const row of chart.size_rows) {
      const size = row[sizeColumn.key];
      if (!size) continue;

      let matchCount = 0;
      let totalRequired = 0;
      const reasons: string[] = [];

      for (const dim of dimensions) {
        if (!dim.required) continue;
        const buyerValue = typeof measurements[dim.key] === 'number'
          ? measurements[dim.key] as number
          : parseFloat(measurements[dim.key] as string);

        if (isNaN(buyerValue) || dim.range) {
          totalRequired++;
          // Try to find matching row
          if (dim.range && buyerValue >= dim.range[0] && buyerValue <= dim.range[1]) {
            // Find row where value range encompasses buyer measurement
            const measurementKey = dim.key;
            const rowValue = row[measurementKey];
            if (rowValue && rowValue.includes('-')) {
              const [min, max] = rowValue.split('-').map(v => parseFloat(v));
              if (!isNaN(min) && !isNaN(max) && buyerValue >= min && buyerValue <= max) {
                matchCount++;
                reasons.push(`${dim.label}${buyerValue}cm落在${rowValue}区间`);
              }
            }
          }
        }
      }

      if (matchCount > 0 && matchCount === totalRequired) {
        return {
          size,
          reason: reasons.join('，') || `根据您的身体数据，推荐尺码：${size}`,
        };
      }
    }

    // Fallback: return first row as default recommendation
    const firstRow = chart.size_rows[0];
    if (firstRow && sizeColumn) {
      return {
        size: firstRow[sizeColumn.key] || 'M',
        reason: '根据您提供的数据，推荐参考尺码表第一行',
      };
    }

    return null;
  }

  /**
   * Search size charts by keyword for LLM context.
   * Searches across name, category, SKU.
   * Returns formatted size chart context string and matched IDs.
   */
  async searchSizeChartsForLLM(
    query: string,
    limit: number = 3,
  ): Promise<SizeChartSearchResult> {
    if (!query?.trim()) {
      return { sizeChartContext: '', matchedSizeChartIds: [] };
    }

    try {
      const { items } = await this.repository.list(
        { search: query.trim(), status: 'active' },
        { page: 1, pageSize: limit },
      );

      if (items.length === 0) {
        return { sizeChartContext: '', matchedSizeChartIds: [] };
      }

      const sizeChartContext = items
        .map((chart, i) => `【尺码表 ${i + 1}】\n${this.formatSizeChartForLLM(chart)}`)
        .join('\n\n');

      // Increment hit_count for all matched charts (fire-and-forget)
      items.forEach(chart => {
        this.repository.incrementHitCount(chart.id).catch(() => {
          // Non-critical
        });
      });

      return {
        sizeChartContext: `\n\n以下是检索到的相关尺码表信息：\n${sizeChartContext}`,
        matchedSizeChartIds: items.map(c => c.id),
      };
    } catch (error) {
      logger.api.warn('size-chart-search-for-llm-failed', { query, error: (error as Error).message });
      return { sizeChartContext: '', matchedSizeChartIds: [] };
    }
  }

  // ─── Version Management ───────────────────────────────────────────────────

  private versionRepo = new SizeChartVersionRepository();

  async createVersion(sizeChartId: string, changeSummary?: string, createdBy?: string): Promise<SizeChartVersion | null> {
    const chart = await this.repository.findById(sizeChartId);
    if (!chart) return null;
    const latestVersion = await this.versionRepo.getLatestVersionNumber(sizeChartId);
    return this.versionRepo.createVersion({
      size_chart_id: sizeChartId,
      version_number: latestVersion + 1,
      name: chart.name,
      chart_type: chart.chart_type,
      category: chart.category || undefined,
      sku: chart.sku || undefined,
      size_columns: chart.size_columns as Array<{ key: string; label: string }>,
      size_rows: chart.size_rows as Array<Record<string, string>>,
      recommend_params: chart.recommend_params,
      recommend_rules: chart.recommend_rules || undefined,
      description: chart.description || undefined,
      change_summary: changeSummary || undefined,
      created_by: createdBy || undefined,
    });
  }

  async getVersionHistory(sizeChartId: string): Promise<SizeChartVersion[]> {
    return this.versionRepo.getVersions(sizeChartId);
  }

  async rollbackToVersion(versionId: string): Promise<NormalizedSizeChart | null> {
    const version = await this.versionRepo.getVersionById(versionId);
    if (!version) return null;
    const current = await this.repository.findById(version.size_chart_id);
    if (current) {
      await this.createVersion(current.id, '回滚前快照');
    }
    await this.repository.update({
      id: version.size_chart_id,
      name: version.name,
      chart_type: version.chart_type as any,
      category: version.category || undefined,
      sku: version.sku || undefined,
      size_columns: version.size_columns,
      size_rows: version.size_rows,
      recommend_params: (version.recommend_params as { dimensions: any[] } | null) ?? undefined,
      recommend_rules: version.recommend_rules || undefined,
      description: version.description || undefined,
    });
    const updated = await this.repository.findById(version.size_chart_id);
    if (updated) {
      try { await this.vectorizeSizeChart(updated); } catch { /* non-critical */ }
    }
    return updated;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async vectorizeSizeChart(chart: {
    name: string;
    chart_type?: string;
    category?: string;
    size_columns: Array<{ key: string; label: string }>;
    size_rows: Array<Record<string, string>>;
    recommend_rules?: string | null;
    description?: string | null;
    id?: string;
  }): Promise<string[]> {
    const content = buildSizeChartTextContent({
      name: chart.name,
      chart_type: chart.chart_type || 'clothing',
      category: chart.category,
      size_columns: chart.size_columns,
      size_rows: chart.size_rows,
      recommend_rules: chart.recommend_rules,
      description: chart.description,
    });
    try {
      const embeddingService = getEmbeddingService();
      const embedding = await embeddingService.embed(content);
      await this.repository.updateEmbedding(chart.id!, embedding);
      return [];
    } catch (error) {
      logger.api.warn('size-chart-embed-failed', { name: chart.name, error: (error as Error).message });
      return [];
    }
  }

  private async deleteVectorDocuments(_docIds: string[]): Promise<void> {
    // No-op: embedding stored locally, no external docs to delete
  }
}
