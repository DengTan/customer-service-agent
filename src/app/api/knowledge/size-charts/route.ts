import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { SizeChartService } from '@/server/services/size-chart-service';
import { isServiceError } from '@/server/services/service-error';

const sizeChartService = new SizeChartService();

// ─── GET /api/knowledge/size-charts ──────────────────────────────────────────

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const filters: Record<string, string | undefined> = {
    category: searchParams.get('category') || undefined,
    parent_category: searchParams.get('parent_category') || undefined,
    status: searchParams.get('status') || undefined,
    search: searchParams.get('search') || undefined,
    chart_type: searchParams.get('chart_type') || undefined,
    product_id: searchParams.get('product_id') || undefined,
    platform_connection_id: searchParams.get('platform_connection_id') || undefined,
  };

  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('page_size') || '50', 10);

  const result = await sizeChartService.listSizeCharts(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
    { page, pageSize },
  );

  return apiSuccess(result);
});

// ─── POST /api/knowledge/size-charts ─────────────────────────────────────────

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);

  if (!body) {
    return apiSuccess({ error: '请求体无效' }, 400);
  }

  try {
    const sizeChart = await sizeChartService.createSizeChart({
      name: body.name,
      category: body.category,
      parent_category: body.parent_category ?? null,
      chart_type: body.chart_type,
      size_columns: body.size_columns || [],
      size_rows: body.size_rows || [],
      product_id: body.product_id ?? null,
      sku: body.sku ?? null,
      recommend_params: body.recommend_params ?? null,
      recommend_rules: body.recommend_rules ?? null,
      description: body.description ?? null,
      image_url: body.image_url ?? null,
      platform_connection_id: body.platform_connection_id ?? null,
    });

    return apiSuccess({ sizeChart }, 201);
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
      return apiSuccess({ error: error.userMessage, code: error.code }, status);
    }
    throw error;
  }
});

// ─── PUT /api/knowledge/size-charts ─────────────────────────────────────────

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);

  if (!body || !body.id) {
    return apiSuccess({ error: '请提供尺码表ID' }, 400);
  }

  try {
    await sizeChartService.updateSizeChart({
      id: body.id,
      name: body.name,
      category: body.category,
      parent_category: body.parent_category,
      chart_type: body.chart_type,
      size_columns: body.size_columns,
      size_rows: body.size_rows,
      product_id: body.product_id,
      sku: body.sku,
      recommend_params: body.recommend_params,
      recommend_rules: body.recommend_rules,
      description: body.description,
      image_url: body.image_url,
      status: body.status,
      platform_connection_id: body.platform_connection_id,
    });

    return apiSuccess({ message: '尺码表已更新' });
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
      return apiSuccess({ error: error.userMessage, code: error.code }, status);
    }
    throw error;
  }
});

// ─── DELETE /api/knowledge/size-charts ───────────────────────────────────────

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiSuccess({ error: '请提供尺码表ID' }, 400);
  }

  try {
    await sizeChartService.deleteSizeChart(id);
    return apiSuccess({ message: '尺码表已删除' });
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 404 ? 404 : 500;
      return apiSuccess({ error: error.userMessage }, status);
    }
    throw error;
  }
});
