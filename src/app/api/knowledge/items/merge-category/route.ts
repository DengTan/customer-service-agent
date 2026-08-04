import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';
import { POST as definePost } from '@/lib/api/with-api';

const knowledgeService = new KnowledgeService();

export const POST = definePost(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    const body = await request.json();
    const { from, to, to_parent_category } = body ?? {};
    const result = await knowledgeService.mergeCategory({
      from,
      to,
      to_parent_category: to_parent_category === undefined ? undefined : to_parent_category,
    });
    return apiSuccess(result);
  },
);
