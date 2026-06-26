import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';
import { logger } from '@/lib/logger';

const repository = new ContentFilterRepository();

interface ImportDomain {
  domain: string;
  pattern_type?: 'exact' | 'wildcard' | 'suffix';
  description?: string;
  is_enabled?: boolean;
}

// POST /api/content-filter/domains/import - Batch import allowed domains
export async function POST(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const domains: ImportDomain[] = body.domains || [];

    if (!Array.isArray(domains) || domains.length === 0) {
      return NextResponse.json(
        { error: '请提供要导入的域名列表' },
        { status: 400 }
      );
    }

    if (domains.length > 1000) {
      return NextResponse.json(
        { error: '单次导入最多支持 1000 条记录' },
        { status: 400 }
      );
    }

    // Domain validation regex
    const domainRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+/;

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const item of domains) {
      if (!item.domain || typeof item.domain !== 'string' || !item.domain.trim()) {
        results.failed++;
        results.errors.push(`域名数据无效，跳过`);
        continue;
      }

      // Normalize domain (remove protocol and trailing slash)
      const normalizedDomain = item.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

      // Validate domain format
      if (!domainRegex.test(normalizedDomain)) {
        results.failed++;
        results.errors.push(`"${item.domain}": 域名格式无效`);
        continue;
      }

      try {
        await repository.createAllowedDomain({
          domain: normalizedDomain,
          pattern_type: item.pattern_type || 'exact',
          description: item.description,
          is_enabled: item.is_enabled !== false,
        });
        results.success++;
      } catch (error) {
        results.failed++;
        const errMsg = error instanceof Error ? error.message : '未知错误';
        results.errors.push(`"${item.domain}": ${errMsg}`);
        logger.api.warn('Failed to import domain', { domain: item.domain, error });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`,
    });
  } catch (error) {
    logger.api.error('Import domains failed', { error });
    return NextResponse.json(
      { error: '导入失败' },
      { status: 500 }
    );
  }
}
