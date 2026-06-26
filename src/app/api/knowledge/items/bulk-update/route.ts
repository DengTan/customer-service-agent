import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { ids, category, parent_category } = body ?? {};
  const result = await knowledgeService.bulkUpdateCategory({
    ids: Array.isArray(ids) ? ids : [],
    category,
    parent_category: parent_category === undefined ? undefined : parent_category,
  });
  return apiSuccess(result);
});
