import { NextRequest } from 'next/server';
import { apiSuccess, withErrorHandler, requireRole } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const READ_ROLES = ['admin', 'agent'];
const service = new KnowledgeGapService();

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const forbidden = requireRole(request, READ_ROLES);
  if (forbidden) return forbidden;

  const { id } = await params;
  const gap = id ? await service.getGap(id) : null;
  return apiSuccess({ gap });
});
