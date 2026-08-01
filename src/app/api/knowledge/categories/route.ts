import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requirePermission } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'read');
  if (denied) return denied;

  const result = await knowledgeService.listAllCategories();
  return apiSuccess(result);
});
