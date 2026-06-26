import { NextRequest } from 'next/server';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';

const service = new SubAgentService();

// GET /api/sub-agents/delegations?conversation_id=xxx - Get delegation history for a conversation
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversation_id');

  if (!conversationId) {
    return apiError('缺少 conversation_id 参数', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.getDelegationHistory(conversationId);
  return apiSuccess(result);
});
