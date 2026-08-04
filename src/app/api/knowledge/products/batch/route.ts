import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { ProductDetailService } from '@/server/services/product-detail-service';
import { isServiceError } from '@/server/services/service-error';

const productService = new ProductDetailService();

// ─── PATCH /api/knowledge/products/batch ───────────────────────────────────────
// Body: { ids: string[], action: 'update_status' | 'update_category', status?: string, category?: string, parent_category?: string | null }

export const PATCH = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    const body = await request.json().catch(() => null);

    if (!body) {
      return new Response(JSON.stringify({ error: '请求体无效' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { ids = [], action } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: '请选择要操作的商品' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      if (action === 'update_status') {
        const result = await productService.batchUpdateStatus(ids, body.status);
        return new Response(JSON.stringify({ message: `已更新 ${result.count} 个商品的状态`, count: result.count }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (action === 'update_category') {
        const result = await productService.batchUpdateCategory(
          ids,
          body.category,
          body.parent_category ?? null,
        );
        return new Response(JSON.stringify({ message: `已更新 ${result.count} 个商品的分类`, count: result.count }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: '不支持的操作类型' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status >= 400 && error.status < 600 ? error.status : 500;
        return new Response(JSON.stringify({ error: error.userMessage }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }
  },
);
