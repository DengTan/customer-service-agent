import { apiSuccess, apiError, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';
import { ProductDetailService } from '@/server/services/product-detail-service';
import { isServiceError } from '@/server/services/service-error';

const productService = new ProductDetailService();

// ─── GET /api/knowledge/products ─────────────────────────────────────────────

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async ({ request }) => {
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
  },
);

export { GETHandler as GET };

// ─── POST /api/knowledge/products ────────────────────────────────────────────

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      name?: string;
      sku?: string;
      category?: string;
      parent_category?: string | null;
      brand?: string | null;
      price?: number | null;
      original_price?: number | null;
      specifications?: unknown[];
      features?: string[];
      description?: string | null;
      usage_instructions?: string | null;
      image_urls?: string[];
      tags?: string[];
      platform_connection_id?: string | null;
      external_product_id?: string | null;
      sync_source?: string;
    }>(request);
    if (parseError) return parseError;
    if (!body) {
      return apiError('请求体无效', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    try {
      const product = await productService.createProduct({
        name: body.name ?? '',
        sku: body.sku ?? '',
        category: body.category ?? '',
        parent_category: body.parent_category ?? null,
        brand: body.brand ?? null,
        price: body.price ?? null,
        original_price: body.original_price ?? null,
        specifications: (body.specifications ?? []) as Array<{ key: string; value: string }>,
        features: body.features ?? [],
        description: body.description ?? null,
        usage_instructions: body.usage_instructions ?? null,
        image_urls: body.image_urls ?? [],
        tags: body.tags ?? [],
        platform_connection_id: body.platform_connection_id ?? null,
        external_product_id: body.external_product_id ?? null,
        sync_source: body.sync_source ?? 'manual',
      });

      return apiSuccess({ product }, HttpStatus.CREATED);
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
        return apiError(error.userMessage, { status, code: error.code });
      }
      throw error;
    }
  },
);

export { POSTHandler as POST };

// ─── PUT /api/knowledge/products ──────────────────────────────────────────────

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      id?: string;
      name?: string;
      sku?: string;
      category?: string;
      parent_category?: string | null;
      brand?: string | null;
      price?: number | null;
      original_price?: number | null;
      specifications?: unknown[];
      features?: string[];
      description?: string | null;
      usage_instructions?: string | null;
      image_urls?: string[];
      status?: string;
      tags?: string[];
      platform_connection_id?: string | null;
    }>(request);
    if (parseError) return parseError;
    if (!body || !body.id) {
      return apiError('请提供商品ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    try {
      await productService.updateProduct({
        id: body.id,
        name: body.name ?? '',
        sku: body.sku ?? '',
        category: body.category ?? '',
        parent_category: body.parent_category,
        brand: body.brand,
        price: body.price ?? null,
        original_price: body.original_price ?? null,
        specifications: body.specifications as Array<{ key: string; value: string }> | undefined,
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
        return apiError(error.userMessage, { status, code: error.code });
      }
      throw error;
    }
  },
);

export { PUTHandler as PUT };

// ─── DELETE /api/knowledge/products ─────────────────────────────────────────

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'delete' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('请提供商品ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    try {
      await productService.deleteProduct(id);
      return apiSuccess({ message: '商品已删除' });
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status === 404 ? 404 : 400;
        return apiError(error.userMessage, { status });
      }
      throw error;
    }
  },
);

export { DELETEHandler as DELETE };