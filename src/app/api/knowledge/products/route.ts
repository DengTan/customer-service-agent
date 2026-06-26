import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { ProductDetailService } from '@/server/services/product-detail-service';
import { isServiceError } from '@/server/services/service-error';

const productService = new ProductDetailService();

// ─── GET /api/knowledge/products ─────────────────────────────────────────────

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const filters: Record<string, string | undefined> = {
    category: searchParams.get('category') || undefined,
    parent_category: searchParams.get('parent_category') || undefined,
    status: searchParams.get('status') || undefined,
    search: searchParams.get('search') || undefined,
    platform_connection_id: searchParams.get('platform_connection_id') || undefined,
    sync_source: searchParams.get('sync_source') || undefined,
  };

  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('page_size') || '50', 10);

  const result = await productService.listProducts(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
    { page, pageSize },
  );

  return apiSuccess(result);
});

// ─── POST /api/knowledge/products ────────────────────────────────────────────

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);

  if (!body) {
    return apiSuccess({ error: '请求体无效' }, 400);
  }

  try {
    const product = await productService.createProduct({
      name: body.name,
      sku: body.sku,
      category: body.category,
      parent_category: body.parent_category ?? null,
      brand: body.brand ?? null,
      price: body.price ?? null,
      original_price: body.original_price ?? null,
      specifications: body.specifications ?? [],
      features: body.features ?? [],
      description: body.description ?? null,
      usage_instructions: body.usage_instructions ?? null,
      image_urls: body.image_urls ?? [],
      tags: body.tags ?? [],
      platform_connection_id: body.platform_connection_id ?? null,
      external_product_id: body.external_product_id ?? null,
      sync_source: body.sync_source ?? 'manual',
    });

    return apiSuccess({ product }, 201);
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
      return apiSuccess({ error: error.userMessage, code: error.code }, status);
    }
    throw error;
  }
});

// ─── PUT /api/knowledge/products ──────────────────────────────────────────────

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);

  if (!body || !body.id) {
    return apiSuccess({ error: '请提供商品ID' }, 400);
  }

  try {
    await productService.updateProduct({
      id: body.id,
      name: body.name,
      sku: body.sku,
      category: body.category,
      parent_category: body.parent_category,
      brand: body.brand,
      price: body.price ?? null,
      original_price: body.original_price ?? null,
      specifications: body.specifications,
      features: body.features,
      description: body.description ?? null,
      usage_instructions: body.usage_instructions ?? null,
      image_urls: body.image_urls,
      status: body.status,
      tags: body.tags,
      platform_connection_id: body.platform_connection_id,
    });

    return apiSuccess({ message: '商品已更新' });
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
      return apiSuccess({ error: error.userMessage, code: error.code }, status);
    }
    throw error;
  }
});

// ─── DELETE /api/knowledge/products ─────────────────────────────────────────

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiSuccess({ error: '请提供商品ID' }, 400);
  }

  try {
    await productService.deleteProduct(id);
    return apiSuccess({ message: '商品已删除' });
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 404 ? 404 : 400;
      return apiSuccess({ error: error.userMessage }, status);
    }
    throw error;
  }
});
