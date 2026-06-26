import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { ProductDetailService } from '@/server/services/product-detail-service';
import { isServiceError } from '@/server/services/service-error';

const productService = new ProductDetailService();

// ─── GET /api/knowledge/products/[id] ────────────────────────────────────────

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiSuccess({ error: '请提供商品ID' }, 400);
  }

  try {
    const product = await productService.getProduct(id);
    return apiSuccess({ product });
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 404 ? 404 : 500;
      return apiSuccess({ error: error.userMessage }, status);
    }
    throw error;
  }
});
