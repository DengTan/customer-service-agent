import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';
import { POST as definePost } from '@/lib/api/with-api';

const knowledgeService = new KnowledgeService();

export const POST = definePost(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    const body = await request.json();
    const { id } = body ?? {};
    await knowledgeService.unarchiveItem(id);
    return apiSuccess({ message: '已恢复', id });
  },
);
