import { NextRequest } from 'next/server';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError } from '@/lib/api-utils';

const service = new SubAgentService();

interface CollaborateBody {
  conversation_id: string;
  delegation_id?: string;
  sender_bot_id: string;
  receiver_bot_id: string;
  message_type?: 'request' | 'response' | 'notify';
  content: string;
  context?: Record<string, unknown>;
}

// POST /api/sub-agents/collaborate - Send a collaboration message between sub-agents
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<CollaborateBody>(request);
  if (parseError) return parseError;

  if (!body?.conversation_id || !body?.sender_bot_id || !body?.receiver_bot_id || !body?.content) {
    return apiError('conversation_id、sender_bot_id、receiver_bot_id 和 content 为必填项', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.sendCollaboration({
    conversation_id: body.conversation_id,
    delegation_id: body.delegation_id,
    senderBotId: body.sender_bot_id,
    receiverBotId: body.receiver_bot_id,
    messageType: body.message_type || 'notify',
    content: body.content,
    context: body.context,
  });

  return Response.json({
    success: true,
    data: result.collaboration,
  });
});
