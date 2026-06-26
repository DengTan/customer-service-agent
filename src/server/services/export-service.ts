import { NextResponse } from 'next/server';
import {
  ExportRepository,
  type ConversationExportFilters,
  type AnalyticsStats,
} from '@/server/repositories/export-repository';
import { toServiceError } from './service-utils';

const CSV_HEADERS = ['ID', '标题', '状态', '评分', '创建时间', '更新时间'];
const ANALYTICS_HEADERS = ['指标', '数值'];

function toCsvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(',');
}

function conversationToRow(c: { id: string; title: string; status: string; rating: number | null; created_at: string; updated_at: string | null }): string {
  return toCsvRow([c.id, c.title, c.status, c.rating ?? '', c.created_at, c.updated_at ?? '']);
}

export class ExportService {
  constructor(private readonly repo = new ExportRepository()) {}

  async exportConversations(
    filters: ConversationExportFilters,
    format: string,
  ): Promise<NextResponse> {
    try {
      const rows = await this.repo.listConversations(filters);

      if (format === 'json') {
        return NextResponse.json({ conversations: rows });
      }

      const csvLines = [CSV_HEADERS.join(','), ...rows.map(conversationToRow)].join('\n');
      return new NextResponse(csvLines, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename=conversations.csv',
        },
      });
    } catch (error) {
      throw toServiceError(error, '导出对话记录失败');
    }
  }

  async exportAnalytics(format: string): Promise<NextResponse> {
    try {
      const stats = await this.repo.getAnalyticsStats();

      if (format === 'csv') {
        const csvLines = [
          ANALYTICS_HEADERS.join(','),
          ...Object.entries(stats).map(([k, v]) => toCsvRow([k, v])),
        ].join('\n');

        return new NextResponse(csvLines, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename=analytics.csv',
          },
        });
      }

      return NextResponse.json({ success: true, ...stats });
    } catch (error) {
      throw toServiceError(error, '导出统计数据失败');
    }
  }
}
