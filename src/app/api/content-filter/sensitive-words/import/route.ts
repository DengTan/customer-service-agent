import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
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
export async function POST(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const words: ImportWord[] = body.words || [];

    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: '请提供要导入的敏感词列表' },
        { status: 400 }
      );
    }

    if (words.length > 1000) {
      return NextResponse.json(
        { error: '单次导入最多支持 1000 条记录' },
        { status: 400 }
      );
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

    return NextResponse.json({
      success: true,
      results,
      message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`,
    });
  } catch (error) {
    logger.api.error('Import sensitive words failed', { error });
    return NextResponse.json(
      { error: '导入失败' },
      { status: 500 }
    );
  }
}
