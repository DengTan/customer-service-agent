import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requirePermission, checkRateLimit } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'read');
  if (denied) return denied;

  // P1-9: all-ids 接口加 rate limit，10/min/IP，防止全表选取被滥用
  const rateLimited = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

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
});