import { NextRequest } from 'next/server';
import { apiSuccess, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const READ_ROLES = ['admin', 'agent'];
const service = new KnowledgeGapService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, READ_ROLES);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const minFrequency = url.searchParams.get('min_frequency');
  const limit = url.searchParams.get('limit');

  const statusFilter = status
    ? (status.split(',').filter(Boolean) as ('open' | 'in_progress' | 'resolved' | 'dismissed')[])
    : undefined;

  const gaps = await service.listGaps({
    status: statusFilter,
    minFrequency: minFrequency ? parseInt(minFrequency, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : 50,
  });

  return apiSuccess({ gaps });
});
