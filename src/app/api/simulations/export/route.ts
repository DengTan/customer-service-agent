import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { logger } from '@/lib/logger';

type ResponseSource = 'auto_reply' | 'knowledge' | 'llm' | 'handoff' | 'error';

interface BatchResult {
  scriptIndex: number;
  groupIndex: number;
  script: string;
  success: boolean;
  response?: string;
  confidence?: number;
  error?: string;
  duration?: number;
  sources?: Array<{ name?: string; score?: number }>;
  reason?: string;
  source?: ResponseSource;
}

const SOURCE_LABELS: Record<ResponseSource, string> = {
  auto_reply: '自动回复',
  knowledge: '知识库',
  llm: 'LLM',
  handoff: '转人工',
  error: '异常',
};

export const POST = async (request: NextRequest) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体解析失败' }, { status: 400 });
  }

  const results = Array.isArray(body) ? body as BatchResult[] :
    (body && typeof body === 'object' && 'results' in body ? (body as { results: unknown }).results : null);

  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: '没有可导出的测试结果' }, { status: 400 });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');

  const exportData = results.map((r) => ({
    '组别': `组${(Number(r.groupIndex) || 0) + 1}`,
    '脚本序号': (Number(r.scriptIndex) || 0) + 1,
    '测试脚本': String(r.script ?? ''),
    '执行结果': r.success === true ? '成功' : '失败',
    'AI 回复': String(r.response ?? ''),
    '置信度': typeof r.confidence === 'number' ? `${(r.confidence * 100).toFixed(1)}%` : '',
    '回复来源': r.source ? (SOURCE_LABELS[r.source as ResponseSource] ?? String(r.source)) : '',
    '响应耗时': typeof r.duration === 'number'
      ? r.duration < 1000 ? `${r.duration}ms` : `${(r.duration / 1000).toFixed(1)}s`
      : '',
    '失败原因': r.success === true ? '' : String(r.error ?? ''),
    '引用知识': Array.isArray(r.sources)
      ? r.sources
          .filter((s: unknown) => s && typeof s === 'object')
          .map((s: unknown) => (s as { name?: string }).name ?? '')
          .filter(Boolean)
          .join('; ')
      : '',
  }));

  try {
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '批量测试报告');

    ws['!cols'] = [
      { wch: 8 },   // 组别
      { wch: 8 },   // 脚本序号
      { wch: 40 },  // 测试脚本
      { wch: 8 },   // 执行结果
      { wch: 60 },  // AI 回复
      { wch: 8 },   // 置信度
      { wch: 10 },  // 回复来源
      { wch: 10 },  // 响应耗时
      { wch: 30 },  // 失败原因
      { wch: 30 },  // 引用知识
    ];

    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    // Convert Buffer to Uint8Array for proper binary handling in NextResponse
    const uint8Array = new Uint8Array(xlsxBuffer);
    // Use ASCII filename to avoid ByteString conversion issues with Chinese characters
    const filename = `batch_test_report_${timestamp}.xlsx`;
    return new NextResponse(uint8Array, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Batch test export failed', { error: msg, stack: error instanceof Error ? error.stack : undefined });
    return NextResponse.json({ error: '导出失败，请重试', detail: msg }, { status: 500 });
  }
};
