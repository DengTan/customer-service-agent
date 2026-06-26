import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { id } = body ?? {};
  await knowledgeService.archiveItem(id);
  return apiSuccess({ message: '已归档', id });
});
