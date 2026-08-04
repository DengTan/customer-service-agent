import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { QuickReplyService } from '@/server/services/quick-reply-service';
import { checkRateLimit } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import * as XLSX from 'xlsx';

const service = new QuickReplyService();

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'quick_replies', action: 'write' },
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  },
  async ({ request }) => {
    try {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return new Response(JSON.stringify({ error: '请上传文件' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const fileName = file.name.toLowerCase();
      if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
        return new Response(JSON.stringify({ error: '只支持 .xlsx、.xls、.csv 格式' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (file.size > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: '文件大小不能超过 5MB' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } catch {
        return new Response(JSON.stringify({ error: '文件格式错误，无法解析' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

      if (data.length === 0) {
        return new Response(JSON.stringify({ error: '文件中没有数据' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const firstRow = data[0];
      const hasTitle = '标题' in firstRow;
      const hasContent = '内容' in firstRow;

      if (!hasTitle || !hasContent) {
        return new Response(JSON.stringify({ error: '文件必须包含「标题」和「内容」列' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const existingReplies = await service.listReplies({});
      const existingTitles = new Set(existingReplies.map(r => r.title.toLowerCase()));

      const result: ImportResult = {
        success: 0,
        failed: 0,
        errors: [],
      };

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowNum = i + 2;

        const title = String(row['标题'] || '').trim();
        const content = String(row['内容'] || '').trim();

        if (!title && !content) {
          continue;
        }

        if (!title) {
          result.failed++;
          result.errors.push({ row: rowNum, message: '标题不能为空' });
          continue;
        }

        if (existingTitles.has(title.toLowerCase())) {
          result.failed++;
          result.errors.push({ row: rowNum, message: `标题 "${title}" 已存在，跳过` });
          continue;
        }
        if (!content) {
          result.failed++;
          result.errors.push({ row: rowNum, message: '内容不能为空' });
          continue;
        }

        const category = String(row['分类'] || '').trim();

        let scope = 'global';
        const scopeValue = String(row['适用范围'] || '全局').trim();
        if (scopeValue.includes('坐席')) {
          scope = 'agent';
        } else if (scopeValue.includes('AI')) {
          scope = 'ai';
        }

        try {
          await service.createReply({
            title,
            content,
            category,
            scope,
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

      return new Response(JSON.stringify({
        total: data.length,
        ...result,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Import failed', { error });
      return new Response(JSON.stringify({ error: '导入失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
