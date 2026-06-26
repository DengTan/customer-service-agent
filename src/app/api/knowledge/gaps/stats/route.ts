import { NextRequest } from 'next/server';
import { apiSuccess, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const READ_ROLES = ['admin', 'agent'];
const service = new KnowledgeGapService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, READ_ROLES);
  if (forbidden) return forbidden;

  const stats = await service.getStats();
  return apiSuccess({ stats });
});
