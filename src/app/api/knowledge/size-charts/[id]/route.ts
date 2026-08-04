import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { SizeChartService } from '@/server/services/size-chart-service';
import { isServiceError } from '@/server/services/service-error';

const sizeChartService = new SizeChartService();

// ─── GET /api/knowledge/size-charts/[id] ──────────────────────────────────────

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: '请提供尺码表ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const sizeChart = await sizeChartService.getSizeChart(id);
      return new Response(JSON.stringify({ sizeChart }), {
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

// ─── PUT /api/knowledge/size-charts/[id] ──────────────────────────────────────

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    const body = await request.json();
    const { id, change_summary } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: '请提供尺码表ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create version snapshot before updating
    await sizeChartService.createVersion(id, change_summary || '编辑前快照');

    const updateData = { ...body };
    delete updateData.id;
    delete updateData.change_summary;

    const updated = await sizeChartService.updateSizeChart(updateData as Parameters<typeof sizeChartService.updateSizeChart>[0]);
    return new Response(JSON.stringify({ sizeChart: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

// ─── DELETE /api/knowledge/size-charts/[id] ───────────────────────────────────

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'delete' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: '请提供尺码表ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await sizeChartService.deleteSizeChart(id);
    return new Response(JSON.stringify({ message: '尺码表已删除' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
