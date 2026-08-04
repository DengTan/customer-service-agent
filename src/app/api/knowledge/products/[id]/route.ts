import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { ProductDetailService } from '@/server/services/product-detail-service';
import { isServiceError } from '@/server/services/service-error';

const productService = new ProductDetailService();

// ─── GET /api/knowledge/products/[id] ────────────────────────────────────────

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: '请提供商品ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const product = await productService.getProduct(id);
      return new Response(JSON.stringify({ product }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status === 404 ? 404 : 500;
        return new Response(JSON.stringify({ error: error.userMessage }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }
  },
);
