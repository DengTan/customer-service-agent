/**
 * GET /api/knowledge/size-charts/by-product/[productId]
 * Returns all size charts associated with a product (no pagination limit).
 * Used by product-form-modal to load all associated charts without page_size constraints.
 */

import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess } from '@/lib/api-utils';
import { SizeChartService } from '@/server/services/size-chart-service';

const sizeChartService = new SizeChartService();

export const GET = withErrorHandler(async (_request: NextRequest, { params }: { params: Promise<{ productId: string }> }) => {
  const { productId } = await params;

  if (!productId?.trim()) {
    return apiSuccess({ error: '请提供商品ID' }, 400);
  }

  const items = await sizeChartService.getSizeChartsByProductId(productId);

  return apiSuccess({ items });
});
