import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { ids } = body ?? {};
  const result = await knowledgeService.bulkUnarchive(Array.isArray(ids) ? ids : []);
  return apiSuccess(result);
});
