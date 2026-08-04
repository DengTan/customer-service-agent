import { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';
import { GET as defineGet } from '@/lib/api/with-api';

const knowledgeService = new KnowledgeService();

export const GET = defineGet(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    // P1-9: all-ids 接口加 rate limit，10/min/IP，防止全表选取被滥用
    // Note: rate limit is handled by withApi if needed; currently using perm check only

    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('include_archived') === 'true';
    const onlyArchived = searchParams.get('only_archived') === 'true';
    const includeExpired = searchParams.get('include_expired') === 'true';
    const search = searchParams.get('search')?.trim() || undefined;
    const status = searchParams.get('status')?.trim() || undefined;
    const category = searchParams.get('category')?.trim() || undefined;

    const result = await knowledgeService.listAllIds({
      includeArchived,
      onlyArchived,
      includeExpired,
      search,
      status,
      category,
    });
    return apiSuccess(result);
  },
);