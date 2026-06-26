import { NextRequest, NextResponse } from 'next/server';
import { SizeChartService } from '@/server/services/size-chart-service';

const service = new SizeChartService();

const CHART_TYPE_LABELS: Record<string, string> = {
  clothing: '服装',
  shoes: '鞋类',
  accessories: '配饰',
  custom: '自定义',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'csv';
  const category = searchParams.get('category') || undefined;
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const filters: Record<string, string> = {};
  if (category) filters.category = category;
  if (status) filters.status = status;
  if (search) filters.search = search;

  const result = await service.listSizeCharts(filters, { pageSize: 10000, page: 1 });

  if (result.items.length === 0) {
    return NextResponse.json({ error: '没有可导出的数据' }, { status: 404 });
  }

  const exportData = result.items.map(chart => ({
    '尺码表名称': chart.name,
    '类型': CHART_TYPE_LABELS[chart.chart_type] || chart.chart_type,
    '分类': chart.category || '',
    '关联SKU': chart.sku || '',
    '状态': chart.status === 'active' ? '启用' : '禁用',
    'AI推荐': chart.recommend_params ? '是' : '否',
    '推荐规则': chart.recommend_rules || '',
    '补充说明': chart.description || '',
    'AI引用次数': chart.hit_count || 0,
    '创建时间': chart.created_at ? new Date(chart.created_at).toLocaleString('zh-CN') : '',
    '更新时间': chart.updated_at ? new Date(chart.updated_at).toLocaleString('zh-CN') : '',
  }));

  if (format === 'csv') {
    const csvRows = [Object.keys(exportData[0]).join(',')];
    exportData.forEach((row: Record<string, unknown>) => {
      csvRows.push(Object.values(row).map(v => {
        const str = String(v ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(','));
    });
    const csvContent = '\uFEFF' + csvRows.join('\n');
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=尺码配置_${Date.now()}.csv`,
      },
    });
  }

  // Default: JSON export
  return NextResponse.json({ items: exportData, total: exportData.length });
}
