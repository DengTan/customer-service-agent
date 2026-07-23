/**
 * P3 Phase 4 — Product Evidence Service.
 *
 * Extracts evidence metadata from product search results and computes stable
 * content hashes for citation stability.
 */
import type { NormalizedProductDetail } from '@/server/repositories/product-detail-repository';
import { logger } from '@/lib/logger';

export interface ProductEvidence {
  product_id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  price: number | null;
  content_hash: string | null;
  doc_ids: string[];
  hit_count: number;
  context_hash: string | null; // stable hash for citation
}

export interface SearchProductsResult {
  items: ProductEvidence[];
  total: number;
}

/**
 * Simple non-crypto hash for stable context hashing.
 * In production, replace with SHA-256 via crypto.subtle.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `prod_${Math.abs(hash).toString(36)}`;
}

export class ProductEvidenceService {
  /**
   * Extract evidence from a product search result.
   * Computes a stable context_hash from product identity fields.
   */
  extractEvidence(product: NormalizedProductDetail): ProductEvidence {
    const contextSource = [
      product.id,
      product.sku,
      product.name,
      product.category,
      product.brand ?? '',
      product.price?.toString() ?? '',
    ].join('|');

    return {
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
      price: product.price,
      content_hash: product.content_hash,
      doc_ids: Array.isArray(product.doc_ids) ? product.doc_ids : [],
      hit_count: product.hit_count ?? 0,
      context_hash: simpleHash(contextSource),
    };
  }

  /**
   * Extract evidence from multiple product results.
   */
  extractBatch(products: NormalizedProductDetail[]): ProductEvidence[] {
    return products.map(p => this.extractEvidence(p));
  }

  /**
   * Increment hit count for a product (fire-and-forget).
   */
  async recordHit(productId: string): Promise<void> {
    try {
      const { getSupabaseClient } = await import('@/storage/database/supabase-client');
      const client = getSupabaseClient();
      await client.rpc('increment_hit_count', { product_id: productId });
    } catch (err) {
      logger.agent.debug('[ProductEvidenceService] Failed to record hit', { productId, error: err });
    }
  }
}
