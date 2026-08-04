import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';
import { logger } from '@/lib/logger';

const repository = new ContentFilterRepository();

interface ImportWord {
  word: string;
  match_mode?: 'exact' | 'fuzzy';
  action?: 'block' | 'replace' | 'warn';
  replacement?: string;
  category?: string;
  is_enabled?: boolean;
}

// POST /api/content-filter/sensitive-words/import - Batch import sensitive words
export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const words: ImportWord[] = body.words || [];

      if (!Array.isArray(words) || words.length === 0) {
        return new Response(JSON.stringify({ error: '请提供要导入的敏感词列表' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (words.length > 1000) {
        return new Response(JSON.stringify({ error: '单次导入最多支持 1000 条记录' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const item of words) {
        if (!item.word || typeof item.word !== 'string' || !item.word.trim()) {
          results.failed++;
          results.errors.push(`敏感词为空，跳过`);
          continue;
        }

        try {
          await repository.createSensitiveWord({
            word: item.word.trim(),
            match_mode: item.match_mode || 'exact',
            action: item.action || 'block',
            replacement: item.replacement,
            category: item.category || '其他',
            is_enabled: item.is_enabled !== false,
          });
          results.success++;
        } catch (error) {
          results.failed++;
          const errMsg = error instanceof Error ? error.message : '未知错误';
          results.errors.push(`"${item.word}": ${errMsg}`);
          logger.api.warn('Failed to import sensitive word', { word: item.word, error });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        results,
        message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Import sensitive words failed', { error });
      return new Response(JSON.stringify({ error: '导入失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
