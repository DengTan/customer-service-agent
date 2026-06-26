import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const GET = withErrorHandlerSimple(async () => {
  const result = await knowledgeService.listAllCategories();
  return apiSuccess(result);
});
