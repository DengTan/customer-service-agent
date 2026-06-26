import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { ProductDetailService } from '@/server/services/product-detail-service';
import { isServiceError } from '@/server/services/service-error';

const productService = new ProductDetailService();

// ─── PATCH /api/knowledge/products/batch ───────────────────────────────────────
// Body: { ids: string[], action: 'update_status' | 'update_category', status?: string, category?: string, parent_category?: string | null }

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);

  if (!body) {
    return apiSuccess({ error: '请求体无效' }, 400);
  }

  const { ids = [], action } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return apiSuccess({ error: '请选择要操作的商品' }, 400);
  }

  try {
    if (action === 'update_status') {
      const result = await productService.batchUpdateStatus(ids, body.status);
      return apiSuccess({ message: `已更新 ${result.count} 个商品的状态`, count: result.count });
    }

    if (action === 'update_category') {
      const result = await productService.batchUpdateCategory(
        ids,
        body.category,
        body.parent_category ?? null,
      );
      return apiSuccess({ message: `已更新 ${result.count} 个商品的分类`, count: result.count });
    }

    return apiSuccess({ error: '不支持的操作类型' }, 400);
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 500;
      return apiSuccess({ error: error.userMessage }, status);
    }
    throw error;
  }
});
