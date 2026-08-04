import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { SizeChartService } from '@/server/services/size-chart-service';

const service = new SizeChartService();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const chartId = searchParams.get('chart_id');

    if (!chartId) {
      return new Response(JSON.stringify({ error: '缺少 chart_id 参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const history = await service.getVersionHistory(chartId);
      return new Response(JSON.stringify({ items: history, total: history.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: '服务器错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const { version_id } = body;

      if (!version_id) {
        return new Response(JSON.stringify({ error: '缺少 version_id 参数' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const chart = await service.rollbackToVersion(version_id);

      if (!chart) {
        return new Response(JSON.stringify({ error: '版本不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ message: '回滚成功', item: chart }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ error: '服务器错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
