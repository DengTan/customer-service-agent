import { NextRequest } from 'next/server';
import { apiSuccess, requirePermission } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async () => {
  const result = await knowledgeService.listAllCategories();
  return apiSuccess(result);
}, );

export { GETHandler as GET };
