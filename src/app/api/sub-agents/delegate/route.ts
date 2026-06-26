import { NextRequest } from 'next/server';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError } from '@/lib/api-utils';

const service = new SubAgentService();

interface DelegateBody {
  conversation_id: string;
  parent_bot_id: string;
  child_bot_id: string;
  input_message: string;
  trigger_intent?: string;
}

// POST /api/sub-agents/delegate - Delegate a task to a sub-agent
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<DelegateBody>(request);
  if (parseError) return parseError;

  if (!body?.conversation_id || !body?.parent_bot_id || !body?.child_bot_id || !body?.input_message) {
    return apiError('conversation_id、parent_bot_id、child_bot_id 和 input_message 为必填项', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.delegateTask({
    conversation_id: body.conversation_id,
    parent_bot_id: body.parent_bot_id,
    child_bot_id: body.child_bot_id,
    trigger_intent: body.trigger_intent,
    input_message: body.input_message,
  });

  return Response.json({
    success: true,
    data: {
      delegation: result.delegation,
      childBot: {
        id: result.childBot.id,
        name: result.childBot.name,
        description: result.childBot.description,
      },
      responseContent: result.responseContent,
      confidence: result.confidence,
      collaborations: result.collaborations,
    },
  });
});
