import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, getAuthenticatedUserId } from '@/lib/api-utils';
import { SizeChartService } from '@/server/services/size-chart-service';
import { isServiceError } from '@/server/services/service-error';

const sizeChartService = new SizeChartService();

// ─── GET /api/knowledge/size-charts/[id] ──────────────────────────────────────

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiSuccess({ error: '请提供尺码表ID' }, 400);
  }

  try {
    const sizeChart = await sizeChartService.getSizeChart(id);
    return apiSuccess({ sizeChart });
  } catch (error) {
    if (isServiceError(error)) {
      const status = error.status === 404 ? 404 : 500;
      return apiSuccess({ error: error.userMessage }, status);
    }
    throw error;
  }
});

// ─── PUT /api/knowledge/size-charts/[id] ──────────────────────────────────────

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { id, change_summary } = body;

  if (!id) {
    return apiSuccess({ error: '请提供尺码表ID' }, 400);
  }

  const userId = getAuthenticatedUserId(request);

  // Create version snapshot before updating
  await sizeChartService.createVersion(id, change_summary || '编辑前快照', userId ?? undefined);

  const updateData = { ...body };
  delete updateData.id;
  delete updateData.change_summary;

  const updated = await sizeChartService.updateSizeChart(updateData as Parameters<typeof sizeChartService.updateSizeChart>[0]);
  return apiSuccess({ sizeChart: updated });
});

// ─── DELETE /api/knowledge/size-charts/[id] ───────────────────────────────────

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiSuccess({ error: '请提供尺码表ID' }, 400);
  }

  await sizeChartService.deleteSizeChart(id);
  return apiSuccess({ message: '尺码表已删除' });
});
