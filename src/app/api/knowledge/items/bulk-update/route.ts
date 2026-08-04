import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';
import { POST as definePost } from '@/lib/api/with-api';

const knowledgeService = new KnowledgeService();

export const POST = definePost(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    const body = await request.json();
    const { ids, category, parent_category } = body ?? {};
    const result = await knowledgeService.bulkUpdateCategory({
      ids: Array.isArray(ids) ? ids : [],
      category,
      parent_category: parent_category === undefined ? undefined : parent_category,
    });
    return apiSuccess(result);
  },
);
