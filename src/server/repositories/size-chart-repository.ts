/**
 * Size Chart Repository
 * CRUD operations for size_charts table
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_ARRAY_MAX_SIZE } from '@/lib/constants';
import { escapeLikePattern } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SizeChartType = 'clothing' | 'shoes' | 'accessories' | 'custom';
export type SizeChartStatus = 'active' | 'disabled';

export interface SizeChartColumn {
  key: string;
  label: string;
}

export interface SizeChartRow {
  [key: string]: string;
}

export interface SizeChartRecommendDimension {
  key: string;
  label: string;
  unit?: string;
  range?: [number, number];
  options?: string[];
  required?: boolean;
}

export interface NormalizedSizeChart {
  id: string;
  name: string;
  category: string;
  parent_category: string | null;
  chart_type: SizeChartType;
  size_columns: SizeChartColumn[];
  size_rows: SizeChartRow[];
  product_id: string | null;
  sku: string | null;
  recommend_params: { dimensions: SizeChartRecommendDimension[] } | null;
  recommend_rules: string | null;
  description: string | null;
  image_url: string | null;
  doc_ids: string[];
  content_hash: string | null;
  embedding?: number[];
  status: SizeChartStatus;
  hit_count: number;
  last_hit_at: string | null;
  platform_connection_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface SizeChartFilters {
  category?: string;
  status?: string;
  search?: string;
  product_id?: string;
  chart_type?: string;
  platform_connection_id?: string;
}

export interface CreateSizeChartInput {
  name: string;
  category?: string;
  parent_category?: string | null;
  chart_type?: SizeChartType;
  size_columns: SizeChartColumn[];
  size_rows: SizeChartRow[];
  product_id?: string | null;
  sku?: string | null;
  recommend_params?: { dimensions: SizeChartRecommendDimension[] } | null;
  recommend_rules?: string | null;
  description?: string | null;
  image_url?: string | null;
  doc_ids?: string[];
  content_hash?: string | null;
  embedding?: number[];
  platform_connection_id?: string | null;
}

export interface UpdateSizeChartInput {
  id: string;
  name?: string;
  category?: string;
  parent_category?: string | null;
  chart_type?: SizeChartType;
  size_columns?: SizeChartColumn[];
  size_rows?: SizeChartRow[];
  product_id?: string | null;
  sku?: string | null;
  recommend_params?: { dimensions: SizeChartRecommendDimension[] } | null;
  recommend_rules?: string | null;
  description?: string | null;
  image_url?: string | null;
  doc_ids?: string[];
  content_hash?: string | null;
  embedding?: number[];
  status?: SizeChartStatus;
  platform_connection_id?: string | null;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_SIZE_CHARTS: NormalizedSizeChart[] = [
  {
    id: 'demo-sc-1',
    name: '女装T恤尺码表',
    category: '服装',
    parent_category: null,
    chart_type: 'clothing',
    size_columns: [
      { key: 'size', label: '尺码' },
      { key: 'bust', label: '胸围(cm)' },
      { key: 'waist', label: '腰围(cm)' },
      { key: 'shoulder', label: '肩宽(cm)' },
      { key: 'length', label: '衣长(cm)' },
    ],
    size_rows: [
      { size: 'S', bust: '82-86', waist: '62-66', shoulder: '38', length: '60' },
      { size: 'M', bust: '86-90', waist: '66-70', shoulder: '40', length: '62' },
      { size: 'L', bust: '90-94', waist: '70-74', shoulder: '42', length: '64' },
      { size: 'XL', bust: '94-98', waist: '74-78', shoulder: '44', length: '66' },
      { size: 'XXL', bust: '98-102', waist: '78-82', shoulder: '46', length: '68' },
    ],
    product_id: null,
    sku: null,
    recommend_params: {
      dimensions: [
        { key: 'height', label: '身高', unit: 'cm', range: [140, 190], required: true },
        { key: 'weight', label: '体重', unit: 'kg', range: [35, 120], required: true },
        { key: 'preference', label: '穿着偏好', options: ['修身', '常规', '宽松'], required: false },
      ],
    },
    recommend_rules: '根据身高体重计算BMI，参考胸围和腰围范围进行推荐。若身高体重对应多个尺码，按穿着偏好决定：修身选小一号，宽松选大一号。',
    description: '此尺码表为标准尺寸，偏小一码，建议选大一号。',
    image_url: null,
    doc_ids: [],
    content_hash: null,
    status: 'active',
    hit_count: 8,
    last_hit_at: new Date(Date.now() - 3600000).toISOString(),
    platform_connection_id: null,
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: null,
  },
  {
    id: 'demo-sc-2',
    name: '男鞋尺码对照表',
    category: '鞋类',
    parent_category: null,
    chart_type: 'shoes',
    size_columns: [
      { key: 'cn_size', label: '中国尺码' },
      { key: 'eu_size', label: '欧码' },
      { key: 'us_size', label: '美码' },
      { key: 'foot_length', label: '脚长(cm)' },
    ],
    size_rows: [
      { cn_size: '38', eu_size: '38', us_size: '6', foot_length: '24.0' },
      { cn_size: '39', eu_size: '39', us_size: '7', foot_length: '24.5' },
      { cn_size: '40', eu_size: '40', us_size: '7.5', foot_length: '25.0' },
      { cn_size: '41', eu_size: '41', us_size: '8', foot_length: '25.5' },
      { cn_size: '42', eu_size: '42', us_size: '9', foot_length: '26.0' },
      { cn_size: '43', eu_size: '43', us_size: '10', foot_length: '26.5' },
      { cn_size: '44', eu_size: '44', us_size: '11', foot_length: '27.0' },
    ],
    product_id: null,
    sku: null,
    recommend_params: {
      dimensions: [
        { key: 'foot_length', label: '脚长', unit: 'cm', range: [22, 30], required: true },
        { key: 'foot_width', label: '脚宽', unit: 'cm', range: [7, 13], required: false },
      ],
    },
    recommend_rules: '根据脚长对照尺码表选择合适尺码。若脚宽较宽（>10cm），建议选大一码。',
    description: null,
    image_url: null,
    doc_ids: [],
    content_hash: null,
    status: 'active',
    hit_count: 5,
    last_hit_at: new Date(Date.now() - 86400000).toISOString(),
    platform_connection_id: null,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: null,
  },
];

// ─── Repository ────────────────────────────────────────────────────────────────

export class SizeChartRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /** Normalize a raw DB row to NormalizedSizeChart */
  private normalize(row: Record<string, unknown>): NormalizedSizeChart {
    return {
      id: (row.id as string) || '',
      name: (row.name as string) || '',
      category: ((row.category as string) || '未分类'),
      parent_category: (row.parent_category as string) || null,
      chart_type: ((row.chart_type as string) || 'clothing') as SizeChartType,
      size_columns: (Array.isArray(row.size_columns) ? row.size_columns : []) as SizeChartColumn[],
      size_rows: (Array.isArray(row.size_rows) ? row.size_rows : []) as SizeChartRow[],
      product_id: (row.product_id as string) || null,
      sku: (row.sku as string) || null,
      recommend_params: (row.recommend_params as { dimensions: SizeChartRecommendDimension[] }) || null,
      recommend_rules: (row.recommend_rules as string) || null,
      description: (row.description as string) || null,
      image_url: (row.image_url as string) || null,
      doc_ids: (Array.isArray(row.doc_ids) ? row.doc_ids : []) as string[],
      content_hash: (row.content_hash as string) || null,
      status: ((row.status as string) || 'active') as SizeChartStatus,
      hit_count: (row.hit_count as number) || 0,
      last_hit_at: (row.last_hit_at as string) || null,
      platform_connection_id: (row.platform_connection_id as string) || null,
      created_at: (row.created_at as string) || '',
      updated_at: (row.updated_at as string) || null,
    };
  }

  /**
   * List size charts with optional filters.
   * Returns items, category stats, status stats, and total count.
   */
  async list(
    filters: SizeChartFilters = {},
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: NormalizedSizeChart[];
    categories: Record<string, number>;
    statuses: Record<string, number>;
    chartTypes: Record<string, number>;
    total: number;
  }> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;

    if (isDemoMode()) {
      let filtered = [...DEMO_SIZE_CHARTS];
      if (filters.status) filtered = filtered.filter(s => s.status === filters.status);
      if (filters.category) filtered = filtered.filter(s => s.category === filters.category);
      if (filters.chart_type) filtered = filtered.filter(s => s.chart_type === filters.chart_type);
      if (filters.product_id) filtered = filtered.filter(s => s.product_id === filters.product_id);
      if (filters.search) {
        const q = (filters.search as string).toLowerCase();
        filtered = filtered.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.sku || '').toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
        );
      }
      const categories: Record<string, number> = {};
      const statuses: Record<string, number> = {};
      const chartTypes: Record<string, number> = {};
      filtered.forEach(s => {
        categories[s.category] = (categories[s.category] || 0) + 1;
        statuses[s.status] = (statuses[s.status] || 0) + 1;
        chartTypes[s.chart_type] = (chartTypes[s.chart_type] || 0) + 1;
      });
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        categories,
        statuses,
        chartTypes,
        total: filtered.length,
      };
    }

    let query = this.client.from('size_charts').select('*', { count: 'exact' });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.chart_type) query = query.eq('chart_type', filters.chart_type);
    if (filters.product_id) query = query.eq('product_id', filters.product_id);
    if (filters.platform_connection_id) query = query.eq('platform_connection_id', filters.platform_connection_id);
    if (filters.search) {
      const q = (filters.search as string).toLowerCase();
      const escaped = escapeLikePattern(q);
      query = query.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%,category.ilike.%${escaped}%`);
    }

    query = query.order('created_at', { ascending: false });
    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new RepositoryError('list size charts', error.message, error.code);
    }

    const items = (data || []).map(row => this.normalize(row as Record<string, unknown>));
    const categories: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    const chartTypes: Record<string, number> = {};
    items.forEach(s => {
      categories[s.category] = (categories[s.category] || 0) + 1;
      statuses[s.status] = (statuses[s.status] || 0) + 1;
      chartTypes[s.chart_type] = (chartTypes[s.chart_type] || 0) + 1;
    });

    return { items, categories, statuses, chartTypes, total: count ?? items.length };
  }

  /**
   * Find a size chart by ID.
   */
  async findById(id: string): Promise<NormalizedSizeChart | null> {
    if (isDemoMode()) {
      return DEMO_SIZE_CHARTS.find(s => s.id === id) ?? null;
    }
    const { data, error } = await this.client
      .from('size_charts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find size chart by id', error.message, error.code);
    }
    return data ? this.normalize(data as Record<string, unknown>) : null;
  }

  /**
   * Find a size chart by product ID (may be multiple per product).
   */
  async findByProductId(productId: string): Promise<NormalizedSizeChart[]> {
    if (isDemoMode()) {
      return DEMO_SIZE_CHARTS.filter(s => s.product_id === productId);
    }
    const { data, error } = await this.client
      .from('size_charts')
      .select('*')
      .eq('product_id', productId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) {
      throw new RepositoryError('find size charts by product id', error.message, error.code);
    }
    return (data || []).map(row => this.normalize(row as Record<string, unknown>));
  }

  /**
   * Find a size chart by SKU.
   */
  async findBySku(sku: string): Promise<NormalizedSizeChart | null> {
    if (isDemoMode()) {
      return DEMO_SIZE_CHARTS.find(s => s.sku === sku && s.status === 'active') ?? null;
    }
    const { data, error } = await this.client
      .from('size_charts')
      .select('*')
      .eq('sku', sku)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find size chart by sku', error.message, error.code);
    }
    return data ? this.normalize(data as Record<string, unknown>) : null;
  }

  /**
   * Find a size chart by content hash (deduplication).
   */
  async findByContentHash(contentHash: string): Promise<NormalizedSizeChart | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('size_charts')
      .select('*')
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find size chart by content hash', error.message, error.code);
    }
    return data ? this.normalize(data as Record<string, unknown>) : null;
  }

  /**
   * Create a new size chart.
   */
  async create(input: CreateSizeChartInput): Promise<NormalizedSizeChart> {
    if (isDemoMode()) {
      const trimmed = trimDemoArray(DEMO_SIZE_CHARTS, DEMO_ARRAY_MAX_SIZE);
      const newChart: NormalizedSizeChart = {
        id: `demo-sc-${Date.now()}`,
        name: input.name,
        category: input.category || '未分类',
        parent_category: input.parent_category ?? null,
        chart_type: input.chart_type || 'clothing',
        size_columns: input.size_columns || [],
        size_rows: input.size_rows || [],
        product_id: input.product_id ?? null,
        sku: input.sku ?? null,
        recommend_params: input.recommend_params ?? null,
        recommend_rules: input.recommend_rules ?? null,
        description: input.description ?? null,
        image_url: input.image_url ?? null,
        doc_ids: input.doc_ids || [],
        content_hash: input.content_hash ?? null,
        status: 'active',
        hit_count: 0,
        last_hit_at: null,
        platform_connection_id: input.platform_connection_id ?? null,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      trimmed.push(newChart);
      return newChart;
    }

    const insertData: Record<string, unknown> = {
      name: input.name,
      category: input.category ?? '未分类',
      parent_category: input.parent_category ?? null,
      chart_type: input.chart_type ?? 'clothing',
      size_columns: input.size_columns ?? [],
      size_rows: input.size_rows ?? [],
      product_id: input.product_id ?? null,
      sku: input.sku ?? null,
      recommend_params: input.recommend_params ?? null,
      recommend_rules: input.recommend_rules ?? null,
      description: input.description ?? null,
      image_url: input.image_url ?? null,
      doc_ids: input.doc_ids ?? [],
      content_hash: input.content_hash ?? null,
      platform_connection_id: input.platform_connection_id ?? null,
    };

    if (input.embedding !== undefined) {
      insertData.embedding = input.embedding ? JSON.stringify(input.embedding) : null;
    }

    const { data, error } = await this.client
      .from('size_charts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create size chart', error.message, error.code);
    }

    return this.normalize(data as Record<string, unknown>);
  }

  /**
   * Update an existing size chart.
   */
  async update(input: UpdateSizeChartInput): Promise<void> {
    if (isDemoMode()) return;
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.parent_category !== undefined) updateData.parent_category = input.parent_category;
    if (input.chart_type !== undefined) updateData.chart_type = input.chart_type;
    if (input.size_columns !== undefined) updateData.size_columns = input.size_columns;
    if (input.size_rows !== undefined) updateData.size_rows = input.size_rows;
    if (input.product_id !== undefined) updateData.product_id = input.product_id;
    if (input.sku !== undefined) updateData.sku = input.sku;
    if (input.recommend_params !== undefined) updateData.recommend_params = input.recommend_params;
    if (input.recommend_rules !== undefined) updateData.recommend_rules = input.recommend_rules;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.image_url !== undefined) updateData.image_url = input.image_url;
    if (input.doc_ids !== undefined) updateData.doc_ids = input.doc_ids;
    if (input.content_hash !== undefined) updateData.content_hash = input.content_hash;
    if (input.embedding !== undefined) updateData.embedding = input.embedding ? JSON.stringify(input.embedding) : null;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.platform_connection_id !== undefined) updateData.platform_connection_id = input.platform_connection_id;

    const { error } = await this.client
      .from('size_charts')
      .update(updateData)
      .eq('id', input.id);

    if (error) {
      throw new RepositoryError('update size chart', error.message, error.code);
    }
  }

  /**
   * Delete a size chart (hard delete).
   */
  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('size_charts')
      .delete()
      .eq('id', id);

    if (error) {
      throw new RepositoryError('delete size chart', error.message, error.code);
    }
  }

  /**
   * Increment hit_count and update last_hit_at.
   */
  async incrementHitCount(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { data: current } = await this.client
      .from('size_charts')
      .select('hit_count')
      .eq('id', id)
      .single();
    const newCount = ((current?.hit_count as number) ?? 0) + 1;
    const { error } = await this.client
      .from('size_charts')
      .update({ hit_count: newCount, last_hit_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      logger.error(`[SizeChartRepo] incrementHitCount failed for ${id}`, { message: error.message });
    }
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('size_charts')
      .update({ embedding: JSON.stringify(embedding), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      logger.error(`[SizeChartRepo] updateEmbedding failed for ${id}`, { message: error.message });
    }
  }
}

/** Trim demo array to max size, removing oldest entries */
function trimDemoArray<T extends { created_at: string }>(arr: T[], maxSize: number): T[] {
  if (arr.length < maxSize) return arr;
  return arr.slice(arr.length - maxSize);
}
