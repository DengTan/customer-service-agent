import { NextRequest, NextResponse } from 'next/server';
import { QuickReplyService } from '@/server/services/quick-reply-service';
import { getAuthenticatedUserId, checkRateLimit } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import * as XLSX from 'xlsx';

const service = new QuickReplyService();

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export async function POST(request: NextRequest) {
  // Rate limit: 10 imports per minute
  const rateLimitError = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

    // Check file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
      return NextResponse.json({ error: '只支持 .xlsx、.xls、.csv 格式' }, { status: 400 });
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: '文件大小不能超过 5MB' }, { status: 400 });
    }

    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse Excel/CSV
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      return NextResponse.json({ error: '文件格式错误，无法解析' }, { status: 400 });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

    if (data.length === 0) {
      return NextResponse.json({ error: '文件中没有数据' }, { status: 400 });
    }

    // Validate columns
    const firstRow = data[0];
    const requiredColumns = ['标题', '内容'];
    const optionalColumns = ['分类', '适用范围'];

    const hasTitle = '标题' in firstRow;
    const hasContent = '内容' in firstRow;

    if (!hasTitle || !hasContent) {
      return NextResponse.json({
        error: '文件必须包含「标题」和「内容」列',
      }, { status: 400 });
    }

    // Get current user ID for creator_id
    const userId = getAuthenticatedUserId(request);

    // Query existing titles for deduplication
    const existingReplies = await service.listReplies({});
    const existingTitles = new Set(existingReplies.map(r => r.title.toLowerCase()));

    // Process rows
    const result: ImportResult = {
      success: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // +2 because Excel rows start at 1 and header is row 1

      const title = String(row['标题'] || '').trim();
      const content = String(row['内容'] || '').trim();

      // Skip empty rows
      if (!title && !content) {
        continue;
      }

      // Validate required fields
      if (!title) {
        result.failed++;
        result.errors.push({ row: rowNum, message: '标题不能为空' });
        continue;
      }

      // Check for duplicate title (case-insensitive)
      if (existingTitles.has(title.toLowerCase())) {
        result.failed++;
        result.errors.push({ row: rowNum, message: `标题 "${title}" 已存在，跳过` });
        continue;
      }      if (!content) {
        result.failed++;
        result.errors.push({ row: rowNum, message: '内容不能为空' });
        continue;
      }

      // Parse category
      const category = String(row['分类'] || '').trim();

      // Parse scope
      let scope = 'global';
      const scopeValue = String(row['适用范围'] || '全局').trim();
      if (scopeValue.includes('坐席')) {
        scope = 'agent';
      } else if (scopeValue.includes('AI')) {
        scope = 'ai';
      } else {
        scope = 'global';
      }

      try {
        await service.createReply({
          title,
          content,
          category,
          scope,
          creator_id: userId || undefined,
        });
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          message: `创建失败: ${error instanceof Error ? error.message : '未知错误'}`,
        });
      }
    }

    return NextResponse.json({
      total: data.length,
      ...result,
    });
  } catch (error) {
    logger.api.error('Import failed', { error });
    return NextResponse.json({ error: '导入失败' }, { status: 500 });
  }
}
