import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { escapeLikePattern } from '@/lib/api-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProductDetail {
  id: string;
  name: string;
  sku: string;
  category: string;
  parent_category: string | null;
  brand: string | null;
  price: number | null;
  original_price: number | null;
  specifications: Array<{ key: string; value: string }>;
  features: string[];
  description: string | null;
  usage_instructions: string | null;
  image_urls: string[];
  status: 'on_sale' | 'off_sale' | 'discontinued';
  doc_ids: string[];
  content_hash: string | null;
  tags: string[];
  platform_connection_id: string | null;
  external_product_id: string | null;
  sync_source: string;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface NormalizedProductDetail extends ProductDetail {
  name: string;
  sku: string;
  category: string;
  parent_category: string | null;
  brand: string | null;
  price: number | null;
  original_price: number | null;
  status: 'on_sale' | 'off_sale' | 'discontinued';
  specifications: Array<{ key: string; value: string }>;
  features: string[];
  description: string | null;
  usage_instructions: string | null;
  image_urls: string[];
  doc_ids: string[];
  content_hash: string | null;
  tags: string[];
  platform_connection_id: string | null;
  external_product_id: string | null;
  sync_source: string;
  hit_count: number;
  last_hit_at: string | null;
}

export interface ProductDetailFilters {
  category?: string;
  parent_category?: string;
  status?: string;
  search?: string;
  platform_connection_id?: string;
  sync_source?: string;
}

export interface CreateProductInput {
  name: string;
  sku: string;
  category?: string;
  parent_category?: string | null;
  brand?: string | null;
  price?: number | null;
  original_price?: number | null;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  description?: string | null;
  usage_instructions?: string | null;
  image_urls?: string[];
  tags?: string[];
  platform_connection_id?: string | null;
  external_product_id?: string | null;
  sync_source?: string;
  doc_ids?: string[];
  content_hash?: string | null;
}

export interface UpdateProductInput {
  id: string;
  name?: string;
  sku?: string;
  category?: string;
  parent_category?: string | null;
  brand?: string | null;
  price?: number | null;
  original_price?: number | null;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  description?: string | null;
  usage_instructions?: string | null;
  image_urls?: string[];
  status?: string;
  doc_ids?: string[];
  content_hash?: string | null;
  tags?: string[];
  platform_connection_id?: string | null;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_PRODUCTS: NormalizedProductDetail[] = [
  {
    id: 'demo-pd-1',
    name: '纯棉圆领T恤 男款',
    sku: 'SKU-TEE-001',
    category: '服装',
    parent_category: null,
    brand: '自在服饰',
    price: 89.00,
    original_price: 129.00,
    specifications: [
      { key: '颜色', value: '黑色/白色/灰色' },
      { key: '尺码', value: 'S/M/L/XL/XXL' },
      { key: '材质', value: '100%纯棉' },
      { key: '袖长', value: '短袖' },
    ],
    features: ['透气舒适', '柔软亲肤', '简约百搭'],
    description: '采用优质100%纯棉面料，透气吸汗，穿着舒适。圆领设计，简约大方，适合日常休闲穿着。',
    usage_instructions: '建议手洗，水温不超过30°C；避免暴晒；熨斗熨烫温度不超过110°C。',
    image_urls: ['https://placehold.co/400x400/png?text=T恤'],
    status: 'on_sale',
    doc_ids: [],
    content_hash: null,
    tags: ['T恤', '男装', '夏装'],
    platform_connection_id: null,
    external_product_id: null,
    sync_source: 'manual',
    hit_count: 12,
    last_hit_at: new Date(Date.now() - 86400000).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'demo-pd-2',
    name: '运动休闲裤 男款',
    sku: 'SKU-PANTS-001',
    category: '服装',
    parent_category: null,
    brand: '自在服饰',
    price: 159.00,
    original_price: 199.00,
    specifications: [
      { key: '颜色', value: '黑色/深灰' },
      { key: '尺码', value: 'M/L/XL/XXL' },
      { key: '材质', value: '聚酯纤维+氨纶' },
      { key: '款式', value: '束脚款' },
    ],
    features: ['弹力面料', '透气速干', '宽松舒适'],
    description: '采用弹力速干面料，适合运动和日常休闲穿着。束脚设计，时尚百搭。',
    usage_instructions: '可机洗，水温不超过40°C；禁止漂白；低温熨烫。',
    image_urls: ['https://placehold.co/400x400/png?text=运动裤'],
    status: 'on_sale',
    doc_ids: [],
    content_hash: null,
    tags: ['运动裤', '男装', '休闲'],
    platform_connection_id: null,
    external_product_id: null,
    sync_source: 'manual',
    hit_count: 5,
    last_hit_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 14).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'demo-pd-3',
    name: '真皮商务皮带',
    sku: 'SKU-BELT-001',
    category: '配饰',
    parent_category: null,
    brand: '考拉皮具',
    price: 199.00,
    original_price: 299.00,
    specifications: [
      { key: '材质', value: '头层牛皮' },
      { key: '扣头', value: '合金自动扣' },
      { key: '宽度', value: '3.5cm' },
      { key: '长度', value: '105-125cm' },
    ],
    features: ['真材实料', '经久耐用', '商务休闲两用'],
    description: '精选头层牛皮，质感柔软细腻。合金自动扣，经久耐用不掉色。',
    usage_instructions: '避免接触尖锐物品；定期用皮革护理油擦拭保养。',
    image_urls: ['https://placehold.co/400x400/png?text=皮带'],
    status: 'off_sale',
    doc_ids: [],
    content_hash: null,
    tags: ['皮带', '男装', '商务'],
    platform_connection_id: null,
    external_product_id: null,
    sync_source: 'manual',
    hit_count: 3,
    last_hit_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
];

// ─── Repository ────────────────────────────────────────────────────────────────

export class ProductDetailRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /** Normalize a raw DB row to NormalizedProductDetail */
  private normalize(row: Record<string, unknown>): NormalizedProductDetail {
    return {
      id: (row.id as string) || '',
      name: (row.name as string) || '',
      sku: (row.sku as string) || '',
      category: ((row.category as string) || '未分类'),
      parent_category: (row.parent_category as string) || null,
      brand: (row.brand as string) || null,
      price: (row.price as number) || null,
      original_price: (row.original_price as number) || null,
      specifications: (Array.isArray(row.specifications) ? row.specifications : []) as Array<{ key: string; value: string }>,
      features: (Array.isArray(row.features) ? row.features : []) as string[],
      description: (row.description as string) || null,
      usage_instructions: (row.usage_instructions as string) || null,
      image_urls: (Array.isArray(row.image_urls) ? row.image_urls : []) as string[],
      status: ((row.status as string) || 'on_sale') as NormalizedProductDetail['status'],
      doc_ids: (Array.isArray(row.doc_ids) ? row.doc_ids : []) as string[],
      content_hash: (row.content_hash as string) || null,
      tags: (Array.isArray(row.tags) ? row.tags : []) as string[],
      platform_connection_id: (row.platform_connection_id as string) || null,
      external_product_id: (row.external_product_id as string) || null,
      sync_source: ((row.sync_source as string) || 'manual'),
      hit_count: (row.hit_count as number) || 0,
      last_hit_at: (row.last_hit_at as string) || null,
      created_at: (row.created_at as string) || '',
      updated_at: (row.updated_at as string) || null,
    };
  }

  /**
   * List products with optional filters.
   * Returns items, category stats, status stats, and total count.
   */
  async list(
    filters: ProductDetailFilters = {},
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: NormalizedProductDetail[];
    categories: Record<string, number>;
    statuses: Record<string, number>;
    total: number;
  }> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;

    if (isDemoMode()) {
      let filtered = [...DEMO_PRODUCTS];
      if (filters.status) filtered = filtered.filter(p => p.status === filters.status);
      if (filters.category) filtered = filtered.filter(p => p.category === filters.category);
      if (filters.search) {
        const q = (filters.search as string).toLowerCase();
        filtered = filtered.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q),
        );
      }
      const categories: Record<string, number> = {};
      const statuses: Record<string, number> = {};
      filtered.forEach(p => {
        categories[p.category] = (categories[p.category] || 0) + 1;
        statuses[p.status] = (statuses[p.status] || 0) + 1;
      });
      return { items: filtered, categories, statuses, total: filtered.length };
    }

    let query = this.client.from('product_details').select('*', { count: 'exact' });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.parent_category) query = query.eq('parent_category', filters.parent_category);
    if (filters.platform_connection_id) query = query.eq('platform_connection_id', filters.platform_connection_id);
    if (filters.sync_source) query = query.eq('sync_source', filters.sync_source);
    if (filters.search) {
      const q = (filters.search as string).toLowerCase();
      const escaped = escapeLikePattern(q);
      query = query.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%,brand.ilike.%${escaped}%`);
    }

    query = query.order('created_at', { ascending: false });
    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new RepositoryError('list product details', error.message, error.code);
    }

    const items = (data || []).map(row => this.normalize(row as Record<string, unknown>));
    const categories: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    items.forEach(p => {
      categories[p.category] = (categories[p.category] || 0) + 1;
      statuses[p.status] = (statuses[p.status] || 0) + 1;
    });

    return { items, categories, statuses, total: count ?? items.length };
  }

  /**
   * Find a product by ID.
   */
  async findById(id: string): Promise<NormalizedProductDetail | null> {
    if (isDemoMode()) {
      return DEMO_PRODUCTS.find(p => p.id === id) ?? null;
    }
    const { data, error } = await this.client
      .from('product_details')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find product detail by id', error.message, error.code);
    }
    return data ? this.normalize(data as Record<string, unknown>) : null;
  }

  /**
   * Find a product by SKU.
   */
  async findBySku(sku: string): Promise<NormalizedProductDetail | null> {
    if (isDemoMode()) {
      return DEMO_PRODUCTS.find(p => p.sku === sku) ?? null;
    }
    const { data, error } = await this.client
      .from('product_details')
      .select('*')
      .eq('sku', sku)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find product detail by sku', error.message, error.code);
    }
    return data ? this.normalize(data as Record<string, unknown>) : null;
  }

  /**
   * Find a product by content hash (deduplication).
   */
  async findByContentHash(contentHash: string): Promise<NormalizedProductDetail | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('product_details')
      .select('*')
      .eq('content_hash', contentHash)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find product detail by content hash', error.message, error.code);
    }
    return data ? this.normalize(data as Record<string, unknown>) : null;
  }

  /**
   * Create a new product.
   */
  async create(input: CreateProductInput): Promise<NormalizedProductDetail> {
    if (isDemoMode()) {
      const newProduct: NormalizedProductDetail = {
        id: `demo-pd-${Date.now()}`,
        name: input.name,
        sku: input.sku,
        category: input.category || '未分类',
        parent_category: input.parent_category ?? null,
        brand: input.brand ?? null,
        price: input.price ?? null,
        original_price: input.original_price ?? null,
        specifications: input.specifications || [],
        features: input.features || [],
        description: input.description ?? null,
        usage_instructions: input.usage_instructions ?? null,
        image_urls: input.image_urls || [],
        status: 'on_sale',
        doc_ids: input.doc_ids || [],
        content_hash: input.content_hash ?? null,
        tags: input.tags || [],
        platform_connection_id: input.platform_connection_id ?? null,
        external_product_id: input.external_product_id ?? null,
        sync_source: input.sync_source || 'manual',
        hit_count: 0,
        last_hit_at: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      return newProduct;
    }

    const insertData: Record<string, unknown> = {
      name: input.name,
      sku: input.sku,
      category: input.category ?? '未分类',
      parent_category: input.parent_category ?? null,
      brand: input.brand ?? null,
      price: input.price ?? null,
      original_price: input.original_price ?? null,
      specifications: input.specifications ?? [],
      features: input.features ?? [],
      description: input.description ?? null,
      usage_instructions: input.usage_instructions ?? null,
      image_urls: input.image_urls ?? [],
      status: 'on_sale',
      doc_ids: input.doc_ids ?? [],
      content_hash: input.content_hash ?? null,
      tags: input.tags ?? [],
      platform_connection_id: input.platform_connection_id ?? null,
      external_product_id: input.external_product_id ?? null,
      sync_source: input.sync_source ?? 'manual',
    };

    const { data, error } = await this.client
      .from('product_details')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create product detail', error.message, error.code);
    }

    return this.normalize(data as Record<string, unknown>);
  }

  /**
   * Update an existing product.
   */
  async update(input: UpdateProductInput): Promise<void> {
    if (isDemoMode()) return;
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.sku !== undefined) updateData.sku = input.sku;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.parent_category !== undefined) updateData.parent_category = input.parent_category;
    if (input.brand !== undefined) updateData.brand = input.brand;
    if (input.price !== undefined) updateData.price = input.price;
    if (input.original_price !== undefined) updateData.original_price = input.original_price;
    if (input.specifications !== undefined) updateData.specifications = input.specifications;
    if (input.features !== undefined) updateData.features = input.features;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.usage_instructions !== undefined) updateData.usage_instructions = input.usage_instructions;
    if (input.image_urls !== undefined) updateData.image_urls = input.image_urls;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.doc_ids !== undefined) updateData.doc_ids = input.doc_ids;
    if (input.content_hash !== undefined) updateData.content_hash = input.content_hash;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.platform_connection_id !== undefined) updateData.platform_connection_id = input.platform_connection_id;

    const { error } = await this.client
      .from('product_details')
      .update(updateData)
      .eq('id', input.id);

    if (error) {
      throw new RepositoryError('update product detail', error.message, error.code);
    }
  }

  /**
   * Delete a product (hard delete).
   */
  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('product_details')
      .delete()
      .eq('id', id);

    if (error) {
      throw new RepositoryError('delete product detail', error.message, error.code);
    }
  }

  /**
   * Increment hit_count and update last_hit_at.
   */
  async incrementHitCount(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { data: current } = await this.client
      .from('product_details')
      .select('hit_count')
      .eq('id', id)
      .single();
    const newCount = ((current?.hit_count as number) ?? 0) + 1;
    const { error } = await this.client
      .from('product_details')
      .update({ hit_count: newCount, last_hit_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.warn('[ProductDetailRepo] incrementHitCount failed:', error.message);
    }
  }

  /**
   * Batch update status.
   */
  async batchUpdateStatus(ids: string[], status: string): Promise<{ count: number }> {
    if (isDemoMode()) return { count: ids.length };
    const { error } = await this.client
      .from('product_details')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (error) {
      throw new RepositoryError('batch update product status', error.message, error.code);
    }
    return { count: ids.length };
  }

  /**
   * Batch update category.
   */
  async batchUpdateCategory(ids: string[], category: string, parent_category?: string | null): Promise<{ count: number }> {
    if (isDemoMode()) return { count: ids.length };
    const updateData: Record<string, unknown> = { category, updated_at: new Date().toISOString() };
    if (parent_category !== undefined) updateData.parent_category = parent_category;

    const { error } = await this.client
      .from('product_details')
      .update(updateData)
      .in('id', ids);

    if (error) {
      throw new RepositoryError('batch update product category', error.message, error.code);
    }
    return { count: ids.length };
  }
}
