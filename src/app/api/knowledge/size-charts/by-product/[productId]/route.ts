/**
 * GET /api/knowledge/size-charts/by-product/[productId]
 * Returns all size charts associated with a product (no pagination limit).
 * Used by product-form-modal to load all associated charts without page_size constraints.
 */

import { GET as defineGet } from '@/lib/api/with-api';
import { SizeChartService } from '@/server/services/size-chart-service';

const sizeChartService = new SizeChartService();

export const GET = defineGet(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ params }) => {
    const { productId } = params as { productId: string };

    if (!productId?.trim()) {
      return new Response(JSON.stringify({ error: '请提供商品ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const items = await sizeChartService.getSizeChartsByProductId(productId);

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
