import { createHash } from 'node:crypto';
import { getEmbeddingService } from './embedding-service';
import {
  ProductDetailRepository,
  type CreateProductInput,
  type NormalizedProductDetail,
  type ProductDetailFilters,
  type UpdateProductInput,
} from '@/server/repositories/product-detail-repository';
import { SizeChartRepository } from '@/server/repositories/size-chart-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';
import { deleteStorageFiles } from '@/lib/storage-cleanup';

// ─── Content Hash ─────────────────────────────────────────────────────────────

/** Build a deterministic SHA-256 hash of product content for deduplication */
export function buildProductContentHash(product: {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  description?: string | null;
}): string {
  const raw = [
    product.name,
    product.sku,
    product.brand || '',
    product.category || '',
    JSON.stringify(product.specifications || []),
    JSON.stringify(product.features || []),
    product.description || '',
  ].join('||');
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Text Content ─────────────────────────────────────────────────────────────

/** Build a searchable text summary of a product */
function buildProductTextContent(product: {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  specifications?: Array<{ key: string; value: string }>;
  features?: string[];
  description?: string | null;
  usage_instructions?: string | null;
}): string {
  const parts: (string | null)[] = [
    `【商品名称】${product.name}`,
    `【SKU】${product.sku}`,
    product.brand ? `【品牌】${product.brand}` : null,
    product.category ? `【分类】${product.category}` : null,
    product.specifications && product.specifications.length > 0
      ? `【规格参数】\n${product.specifications.map(s => `  ${s.key}：${s.value}`).join('\n')}`
      : null,
    product.features && product.features.length > 0
      ? `【产品卖点】${product.features.join('、')}`
      : null,
    product.description ? `【商品详情】\n${product.description}` : null,
    product.usage_instructions ? `【使用说明】\n${product.usage_instructions}` : null,
  ].filter(Boolean) as string[];
  return parts.join('\n');
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ProductDetailService {
  constructor(
    private readonly repository = new ProductDetailRepository(),
    private readonly sizeChartRepository = new SizeChartRepository(),
  ) {}

  /**
   * List products with filters, stats, and pagination.
   */
  async listProducts(
    filters: ProductDetailFilters = {},
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{
    items: NormalizedProductDetail[];
    categories: Record<string, number>;
    statuses: Record<string, number>;
    total: number;
  }> {
    try {
      return await this.repository.list(filters, options);
    } catch (error) {
      throw toServiceError(error, '获取商品列表失败', 'DB_QUERY_ERROR');
    }
  }

  /**
   * Get a single product by ID.
   */
  async getProduct(id: string): Promise<NormalizedProductDetail> {
    if (!id?.trim()) {
      throw new ServiceError('商品ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const product = await this.repository.findById(id);
      if (!product) {
        throw new ServiceError('商品不存在', { status: 404, code: 'NOT_FOUND' });
      }
      return product;
    } catch (error) {
      throw toServiceError(error, '获取商品详情失败', 'DB_QUERY_ERROR');
    }
  }

  /**
   * Get product by SKU.
   */
  async getProductBySku(sku: string): Promise<NormalizedProductDetail | null> {
    if (!sku?.trim()) {
      throw new ServiceError('SKU不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      return await this.repository.findBySku(sku);
    } catch (error) {
      throw toServiceError(error, '获取商品失败', 'DB_QUERY_ERROR');
    }
  }

  /**
   * Create a new product.
   * - Validates required fields
   * - Checks SKU uniqueness
   * - Checks content hash deduplication
   * - Vectorizes via Coze SDK and stores doc_ids
   * - Inserts into product_details table
   */
  async createProduct(input: {
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
  }): Promise<NormalizedProductDetail> {
    // ── Validation ──────────────────────────────────────────────────────────
    if (!input.name?.trim()) {
      throw new ServiceError('商品名称不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!input.sku?.trim()) {
      throw new ServiceError('商品SKU不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // ── SKU deduplication ───────────────────────────────────────────────────
    try {
      const existingBySku = await this.repository.findBySku(input.sku.trim());
      if (existingBySku) {
        throw new ServiceError(`SKU "${input.sku}" 已存在，请使用其他编号`, {
          status: 409,
          code: 'DUPLICATE_SKU',
        });
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, 'SKU重复检查失败', 'DB_ERROR');
    }

    // ── Build content hash ──────────────────────────────────────────────────
    const contentHash = buildProductContentHash({
      name: input.name.trim(),
      sku: input.sku.trim(),
      brand: input.brand,
      category: input.category,
      specifications: input.specifications,
      features: input.features,
      description: input.description,
    });

    // ── Content hash deduplication ──────────────────────────────────────────
    try {
      const existingByHash = await this.repository.findByContentHash(contentHash);
      if (existingByHash) {
        throw new ServiceError('商品内容重复（相同名称、SKU、规格和描述），无需重复添加', {
          status: 409,
          code: 'DUPLICATE_CONTENT',
        });
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '内容去重检查失败', 'DB_ERROR');
    }

    // ── Vectorize ───────────────────────────────────────────────────────────
    const content = buildProductTextContent(input);
    let embedding: number[] | undefined;
    try {
      const embeddingService = getEmbeddingService();
      embedding = await embeddingService.embed(content);
    } catch (error) {
      logger.api.warn('product-embed-failed', { sku: input.sku, error: (error as Error).message });
    }

    // ── Save ────────────────────────────────────────────────────────────────
    try {
      const createInput: CreateProductInput = {
        name: input.name.trim(),
        sku: input.sku.trim(),
        category: input.category?.trim() || '未分类',
        parent_category: input.parent_category ?? null,
        brand: input.brand ?? null,
        price: input.price ?? null,
        original_price: input.original_price ?? null,
        specifications: input.specifications ?? [],
        features: input.features ?? [],
        description: input.description ?? null,
        usage_instructions: input.usage_instructions ?? null,
        image_urls: input.image_urls ?? [],
        tags: input.tags ?? [],
        platform_connection_id: input.platform_connection_id ?? null,
        external_product_id: input.external_product_id ?? null,
        sync_source: input.sync_source ?? 'manual',
        doc_ids: [],
        content_hash: contentHash,
        embedding,
      };
      return await this.repository.create(createInput);
    } catch (error) {
      throw toServiceError(error, '创建商品失败', 'DB_ERROR');
    }
  }

  /**
   * Update an existing product.
   * - Re-vectorizes if content changed
   * - Updates doc_ids and content_hash
   * - Handles status changes (off_sale → delete vectors)
   */
  async updateProduct(input: UpdateProductInput): Promise<void> {
    if (!input.id?.trim()) {
      throw new ServiceError('商品ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // Fetch existing product
    let existing: NormalizedProductDetail | null;
    try {
      existing = await this.repository.findById(input.id);
      if (!existing) {
        throw new ServiceError('商品不存在', { status: 404, code: 'NOT_FOUND' });
      }
    } catch (error) {
      throw toServiceError(error, '获取商品失败', 'DB_QUERY_ERROR');
    }

    // Merge with existing values
    const merged = {
      name: input.name ?? existing.name,
      sku: input.sku ?? existing.sku,
      category: input.category ?? existing.category,
      parent_category: input.parent_category !== undefined ? input.parent_category : existing.parent_category,
      brand: input.brand !== undefined ? input.brand : existing.brand,
      price: input.price !== undefined ? input.price : existing.price,
      original_price: input.original_price !== undefined ? input.original_price : existing.original_price,
      specifications: input.specifications ?? existing.specifications,
      features: input.features ?? existing.features,
      description: input.description !== undefined ? input.description : existing.description,
      usage_instructions: input.usage_instructions !== undefined ? input.usage_instructions : existing.usage_instructions,
      image_urls: input.image_urls ?? existing.image_urls,
      tags: input.tags ?? existing.tags,
      status: input.status ?? existing.status,
    };

    // Check SKU uniqueness if changed
    if (input.sku && input.sku !== existing.sku) {
      try {
        const existingBySku = await this.repository.findBySku(input.sku);
        if (existingBySku && existingBySku.id !== input.id) {
          throw new ServiceError(`SKU "${input.sku}" 已被其他商品使用`, {
            status: 409,
            code: 'DUPLICATE_SKU',
          });
        }
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw toServiceError(error, 'SKU重复检查失败', 'DB_ERROR');
      }
    }

    // Determine if content changed (requires re-vectorization)
    const contentChanged =
      input.name !== undefined ||
      input.sku !== undefined ||
      input.brand !== undefined ||
      input.category !== undefined ||
      input.specifications !== undefined ||
      input.features !== undefined ||
      input.description !== undefined ||
      input.usage_instructions !== undefined;

    const newContentHash = contentChanged
      ? buildProductContentHash(merged)
      : existing.content_hash;

    let newEmbedding = existing.embedding;

    // Handle status change → vector lifecycle
    const oldStatus = existing.status;
    const newStatus = input.status ?? existing.status;

    if (newStatus === 'off_sale' || newStatus === 'discontinued') {
      // Clear embedding for offline products
      newEmbedding = undefined;
    } else if (contentChanged) {
      // Re-embed with new content
      try {
        const embeddingService = getEmbeddingService();
        const content = buildProductTextContent(merged);
        newEmbedding = await embeddingService.embed(content);
      } catch (error) {
        logger.api.warn('product-embed-failed', { sku: merged.sku, error: (error as Error).message });
      }
    }

    // Persist
    try {
      await this.repository.update({
        id: input.id,
        name: merged.name !== existing.name ? merged.name : undefined,
        sku: merged.sku !== existing.sku ? merged.sku : undefined,
        category: merged.category !== existing.category ? merged.category : undefined,
        parent_category: merged.parent_category !== existing.parent_category ? merged.parent_category : undefined,
        brand: merged.brand !== existing.brand ? merged.brand : undefined,
        price: merged.price !== existing.price ? merged.price : undefined,
        original_price: merged.original_price !== existing.original_price ? merged.original_price : undefined,
        specifications: merged.specifications !== existing.specifications ? merged.specifications : undefined,
        features: merged.features !== existing.features ? merged.features : undefined,
        description: merged.description !== existing.description ? merged.description : undefined,
        usage_instructions: merged.usage_instructions !== existing.usage_instructions ? merged.usage_instructions : undefined,
        image_urls: merged.image_urls !== existing.image_urls ? merged.image_urls : undefined,
        status: newStatus !== oldStatus ? newStatus : undefined,
        doc_ids: [],
        content_hash: newContentHash !== existing.content_hash ? newContentHash : undefined,
        tags: merged.tags !== existing.tags ? merged.tags : undefined,
        platform_connection_id: input.platform_connection_id,
        embedding: newEmbedding,
      });
    } catch (error) {
      throw toServiceError(error, '更新商品失败', 'DB_ERROR');
    }
  }

  /**
   * Delete a product and its vector documents.
   */
  async deleteProduct(id: string): Promise<void> {
    if (!id?.trim()) {
      throw new ServiceError('商品ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    let existing: NormalizedProductDetail | null;
    try {
      existing = await this.repository.findById(id);
      if (!existing) {
        throw new ServiceError('商品不存在', { status: 404, code: 'NOT_FOUND' });
      }
    } catch (error) {
      throw toServiceError(error, '获取商品失败', 'DB_QUERY_ERROR');
    }

    // Clear product references in size_charts (foreign key cleanup)
    try {
      await this.clearProductReferences(id);
    } catch (err) {
      logger.api.warn('product-delete-clear-size-chart-refs-failed', { id });
    }

    // Delete from DB
    try {
      await this.repository.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除商品失败', 'DB_ERROR');
    }
  }

  /**
   * Clear product_id references in size_charts table when a product is deleted.
   * This maintains referential integrity by removing associations before product deletion.
   */
  private async clearProductReferences(productId: string): Promise<void> {
    const charts = await this.sizeChartRepository.findByProductId(productId);
    for (const chart of charts) {
      await this.sizeChartRepository.update({
        id: chart.id,
        product_id: null,
        sku: null,
      });
    }
  }

  /**
   * Batch update product status.
   */
  async batchUpdateStatus(ids: string[], status: string): Promise<{ count: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError('请选择要操作的商品', { status: 400, code: 'VALIDATION_ERROR' });
    }
    const validStatuses = ['on_sale', 'off_sale', 'discontinued'];
    if (!validStatuses.includes(status)) {
      throw new ServiceError('状态值无效', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      // For off_sale/discontinued, clear embedding
      if (status === 'off_sale' || status === 'discontinued') {
        for (const id of ids) {
          await this.repository.update({ id, doc_ids: [], embedding: undefined });
        }
      }
      return await this.repository.batchUpdateStatus(ids, status);
    } catch (error) {
      throw toServiceError(error, '批量更新状态失败', 'DB_ERROR');
    }
  }

  /**
   * Batch update product category.
   */
  async batchUpdateCategory(
    ids: string[],
    category: string,
    parent_category?: string | null,
  ): Promise<{ count: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError('请选择要操作的商品', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!category?.trim()) {
      throw new ServiceError('分类不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      return await this.repository.batchUpdateCategory(ids, category.trim(), parent_category);
    } catch (error) {
      throw toServiceError(error, '批量修改分类失败', 'DB_ERROR');
    }
  }

  /**
   * Format a single product as an LLM-readable context block.
   */
  formatProductForLLM(product: NormalizedProductDetail): string {
    const parts: string[] = [
      `【商品名称】${product.name}`,
      `【SKU】${product.sku}`,
    ];
    if (product.brand) parts.push(`【品牌】${product.brand}`);
    parts.push(`【分类】${product.category}`);
    if (product.price !== null) {
      const priceStr = product.original_price !== null && product.original_price > product.price
        ? `¥${product.price.toFixed(2)}（原价 ¥${product.original_price.toFixed(2)}）`
        : `¥${product.price.toFixed(2)}`;
      parts.push(`【价格】${priceStr}`);
    }
    if (product.status !== 'on_sale') {
      parts.push(`【状态】${product.status === 'off_sale' ? '已下架' : '已停售'}`);
    }
    if (product.specifications && product.specifications.length > 0) {
      parts.push(`【规格参数】`);
      product.specifications.forEach(s => parts.push(`  · ${s.key}：${s.value}`));
    }
    if (product.features && product.features.length > 0) {
      parts.push(`【产品卖点】${product.features.join('、')}`);
    }
    if (product.description) {
      parts.push(`【商品详情】${product.description}`);
    }
    if (product.usage_instructions) {
      parts.push(`【使用说明】${product.usage_instructions}`);
    }
    if (product.image_urls && product.image_urls.length > 0) {
      parts.push(`【商品图片】${product.image_urls.join(' | ')}`);
    }
    return parts.join('\n');
  }

  /**
   * Search products by keyword for LLM context.
   * Searches across name, SKU, brand, category, and description.
   * Returns formatted product context string and matched product IDs.
   */
  async searchProductsForLLM(
    query: string,
    limit: number = 3,
  ): Promise<{ productContext: string; matchedProductIds: string[]; items: NormalizedProductDetail[] }> {
    if (!query?.trim()) {
      return { productContext: '', matchedProductIds: [], items: [] };
    }

    try {
      const { items } = await this.repository.list({ search: query.trim() }, { page: 1, pageSize: limit });
      // Filter to only on_sale products for LLM context
      const activeProducts = items.filter(p => p.status === 'on_sale').slice(0, limit);

      if (activeProducts.length === 0) {
        return { productContext: '', matchedProductIds: [], items: [] };
      }

      const productContext = activeProducts
        .map((p, i) => `【商品 ${i + 1}】\n${this.formatProductForLLM(p)}`)
        .join('\n\n');

      // Increment hit_count for all matched products (fire-and-forget)
      activeProducts.forEach(p => {
        this.repository.incrementHitCount(p.id).catch(() => {
          // Non-critical
        });
      });

      return {
        productContext: `\n\n以下是检索到的相关商品信息：\n${productContext}`,
        matchedProductIds: activeProducts.map(p => p.id),
        items: activeProducts,
      };
    } catch (error) {
      // Product search failure should not block the main LLM flow
      logger.api.warn('product-search-for-llm-failed', { query, error: (error as Error).message });
      return { productContext: '', matchedProductIds: [], items: [] };
    }
  }
}
