import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandler, requireRole, getAuthenticatedUserId } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const ADMIN_ONLY = ['admin'];
const service = new KnowledgeGapService();

interface ResolveBody {
  linkedKnowledgeItemId?: string;
  linked_knowledge_item_id?: string;
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

  const { data: body } = await parseJsonBody<ResolveBody>(request);
  const userId = getAuthenticatedUserId(request) ?? 'admin';

  const gap = await service.resolveGap(id, {
    resolvedBy: userId,
    // 支持 camelCase 和 snake_case 两种格式
    linkedKnowledgeItemId: body?.linkedKnowledgeItemId ?? body?.linked_knowledge_item_id,
    notes: body?.notes,
  });
  return apiSuccess({ gap });
});
