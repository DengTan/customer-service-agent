/**
 * Product Detail Provider
 * Queries product details from the product_details table
 */

import { ProductDetailService } from '../../services/product-detail-service';
import { ProductDetail } from '../../repositories/product-detail-repository';
import { BaseToolProvider, ToolParams, ToolResult } from './types';
import { logger } from '@/lib/logger';

export class ProductProvider extends BaseToolProvider {
  readonly type = 'product' as const;
  private service: ProductDetailService;

  constructor() {
    super();
    this.service = new ProductDetailService();
  }

  /**
   * Validate product query parameters
   */
  validate(params: ToolParams): { valid: boolean; errorMessage?: string; errorCode?: string } {
    const hasSku = params.sku && typeof params.sku === 'string' && (params.sku as string).trim().length > 0;
    const hasName = params.name && typeof params.name === 'string' && (params.name as string).trim().length > 0;
    const hasId = params.product_id && typeof params.product_id === 'string' && (params.product_id as string).trim().length > 0;

    if (!hasSku && !hasName && !hasId) {
      return {
        valid: false,
        errorMessage: '请提供商品SKU、商品名称或商品ID',
        errorCode: 'MISSING_PARAMS',
      };
    }

    if (hasSku && (params.sku as string).length > 100) {
      return {
        valid: false,
        errorMessage: 'SKU 编号过长',
        errorCode: 'SKU_TOO_LONG',
      };
    }

    if (hasName && (params.name as string).length > 200) {
      return {
        valid: false,
        errorMessage: '商品名称过长',
        errorCode: 'NAME_TOO_LONG',
      };
    }

    return { valid: true };
  }

  /**
   * Execute product query
   */
  async execute(params: ToolParams): Promise<ToolResult> {
    const validation = this.validate(params);
    if (!validation.valid) {
      return {
        message: validation.errorMessage!,
        confidence: 0.3,
        isMockData: false,
        errorCode: validation.errorCode,
      };
    }

    try {
      let product: ProductDetail | null = null;

      if (params.product_id) {
        product = await this.service.getProduct((params.product_id as string).trim());
      } else if (params.sku) {
        product = await this.service.getProductBySku((params.sku as string).trim());
      } else if (params.name) {
        const results = await this.service.listProducts({ search: (params.name as string).trim() }, { pageSize: 1 });
        product = results.items[0] || null;
      }

      if (!product) {
        return {
          message: '未找到该商品',
          confidence: 0.4,
          isMockData: false,
          errorCode: 'NOT_FOUND',
        };
      }

      return {
        message: this.formatProductMessage(product),
        data: { product: this.normalizeProduct(product) },
        confidence: this.getBaseConfidence(),
        isMockData: false,
      };
    } catch (error) {
      logger.error('[ProductProvider] Error querying product', { error });
      return {
        message: '查询商品信息失败',
        confidence: 0.3,
        isMockData: false,
        errorCode: 'QUERY_ERROR',
      };
    }
  }

  /**
   * Normalize product for frontend rendering
   */
  private normalizeProduct(product: ProductDetail): Record<string, unknown> {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      brand: product.brand,
      price: product.price,
      original_price: product.original_price,
      specifications: product.specifications,
      features: Array.isArray(product.features) ? product.features : [],
      description: product.description,
      usage_instructions: product.usage_instructions,
      image_urls: Array.isArray(product.image_urls) ? product.image_urls : [],
      status: product.status,
    };
  }

  /**
   * Format product info into human-readable message
   */
  private formatProductMessage(product: ProductDetail): string {
    const parts: string[] = [`商品名称：${product.name}`];

    if (product.sku) parts.push(`SKU：${product.sku}`);
    if (product.brand) parts.push(`品牌：${product.brand}`);
    if (product.category) parts.push(`分类：${product.category}`);
    if (product.price != null) {
      parts.push(`售价：¥${product.price.toFixed(2)}`);
      if (product.original_price && product.original_price > 0) {
        parts.push(`原价：¥${product.original_price.toFixed(2)}`);
      }
    }

    if (product.specifications && Array.isArray(product.specifications) && product.specifications.length > 0) {
      const specs = product.specifications
        .slice(0, 5)
        .map((s: { key: string; value: string }) => `${s.key}：${s.value}`)
        .join('、');
      parts.push(`规格：${specs}`);
    }

    if (product.features && Array.isArray(product.features) && product.features.length > 0) {
      parts.push(`卖点：${(product.features as string[]).slice(0, 3).join('、')}`);
    }

    if (product.description) {
      const shortDesc = product.description.slice(0, 200);
      parts.push(`商品详情：${shortDesc}${product.description.length > 200 ? '...' : ''}`);
    }

    if (product.status !== 'on_sale') {
      parts.push(`【注意】该商品当前状态为：${product.status === 'off_sale' ? '已下架' : '已停售'}`);
    }

    return parts.join('。');
  }
}

// Singleton instance
let productProviderInstance: ProductProvider | null = null;

export function getProductProvider(): ProductProvider {
  if (!productProviderInstance) {
    productProviderInstance = new ProductProvider();
  }
  return productProviderInstance;
}
