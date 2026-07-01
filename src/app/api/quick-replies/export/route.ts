import { NextRequest, NextResponse } from 'next/server';
import { QuickReplyService } from '@/server/services/quick-reply-service';
import { checkRateLimit } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import * as XLSX from 'xlsx';

const service = new QuickReplyService();

export const GET = async (request: NextRequest) => {
  // Rate limit: 20 exports per minute
  const rateLimitError = checkRateLimit(request, { maxRequests: 20, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'xlsx';
    const category = searchParams.get('category') || undefined;
    const scope = searchParams.get('scope') || undefined;

    // Fetch all replies (without pagination limit for export)
    const replies = await service.listReplies({ category, scope });

    if (replies.length === 0) {
      return NextResponse.json({ error: '没有可导出的数据' }, { status: 404 });
    }

    // Format data for export
    const exportData = replies.map((reply) => ({
      '标题': reply.title,
      '内容': reply.content,
      '分类': reply.category || '',
      '适用范围': reply.scope === 'global' ? '全局' : reply.scope === 'agent' ? '坐席专用' : reply.scope === 'ai' ? 'AI 专用' : reply.scope,
      '使用次数': reply.usage_count || 0,
      '创建时间': reply.created_at ? new Date(reply.created_at).toLocaleString('zh-CN') : '',
    }));

    if (format === 'csv') {
      // Generate CSV
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
          'Content-Disposition': `attachment; filename=话术库_${Date.now()}.csv`,
        },
      });
    }

    // Generate XLSX
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '话术库');

    // Set column widths
    ws['!cols'] = [
      { wch: 30 }, // 标题
      { wch: 60 }, // 内容
      { wch: 15 }, // 分类
      { wch: 12 }, // 适用范围
      { wch: 10 }, // 使用次数
      { wch: 20 }, // 创建时间
    ];

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=话术库_${Date.now()}.xlsx`,
      },
    });
  } catch (error) {
    logger.api.error('Export failed', { error });
    return NextResponse.json({ error: '导出失败' }, { status: 500 });
  }
};
