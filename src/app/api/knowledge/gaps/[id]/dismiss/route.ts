import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandler, requireRole } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const ADMIN_ONLY = ['admin'];
const service = new KnowledgeGapService();

interface DismissBody {
  notes?: string;
}

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!id) return apiSuccess({ success: false, error: 'id is required' });

  const { data: body } = await parseJsonBody<DismissBody>(request);
  const role = request.headers.get('x-user-role') || 'admin';

  const gap = await service.dismissGap(id, {
    resolvedBy: role,
    notes: body?.notes,
  });
  return apiSuccess({ gap });
});
