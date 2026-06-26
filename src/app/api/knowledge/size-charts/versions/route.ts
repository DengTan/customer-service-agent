import { NextRequest, NextResponse } from 'next/server';
import { SizeChartService } from '@/server/services/size-chart-service';
import { getAuthenticatedUserId } from '@/lib/api-utils';

const service = new SizeChartService();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chartId = searchParams.get('chart_id');

  if (!chartId) {
    return NextResponse.json({ error: '缺少 chart_id 参数' }, { status: 400 });
  }

  try {
    const history = await service.getVersionHistory(chartId);
    return NextResponse.json({ items: history, total: history.length });
  } catch (err) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { version_id } = body;

    if (!version_id) {
      return NextResponse.json({ error: '缺少 version_id 参数' }, { status: 400 });
    }

    const userId = getAuthenticatedUserId(request);
    const chart = await service.rollbackToVersion(version_id);

    if (!chart) {
      return NextResponse.json({ error: '版本不存在' }, { status: 404 });
    }

    return NextResponse.json({ message: '回滚成功', item: chart });
  } catch (err) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
