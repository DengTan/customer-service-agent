import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { from, to, to_parent_category } = body ?? {};
  const result = await knowledgeService.mergeCategory({
    from,
    to,
    to_parent_category: to_parent_category === undefined ? undefined : to_parent_category,
  });
  return apiSuccess(result);
});
