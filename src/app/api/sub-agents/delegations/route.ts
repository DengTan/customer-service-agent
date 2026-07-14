import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requirePermission } from '@/lib/api-utils';

const service = new SubAgentService();

const ConversationIdSchema = z.string().uuid({ message: 'conversation_id 必须是合法 UUID' });

// GET /api/sub-agents/delegations?conversation_id=xxx - Get delegation history for a conversation
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'sub_agents', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversation_id');

  const parsed = ConversationIdSchema.safeParse(conversationId);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '缺少 conversation_id 参数', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.getDelegationHistory(parsed.data);
  return apiSuccess(result);
});
