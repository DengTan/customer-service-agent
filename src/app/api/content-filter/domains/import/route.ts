import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
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
export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const domains: ImportDomain[] = body.domains || [];

      if (!Array.isArray(domains) || domains.length === 0) {
        return new Response(JSON.stringify({ error: '请提供要导入的域名列表' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (domains.length > 1000) {
        return new Response(JSON.stringify({ error: '单次导入最多支持 1000 条记录' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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

        const normalizedDomain = item.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

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

      return new Response(JSON.stringify({
        success: true,
        results,
        message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Import domains failed', { error });
      return new Response(JSON.stringify({ error: '导入失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
