import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, requirePermission } from '@/lib/api-utils';

const service = new SubAgentService();

const DelegateBodySchema = z.object({
  conversation_id: z.string().uuid({ message: 'conversation_id 必须是合法 UUID' }),
  parent_bot_id: z.string().uuid({ message: 'parent_bot_id 必须是合法 UUID' }),
  child_bot_id: z.string().uuid({ message: 'child_bot_id 必须是合法 UUID' }),
  input_message: z.string().min(1).max(10000),
  trigger_intent: z.string().max(200).optional(),
});

// POST /api/sub-agents/delegate - Delegate a task to a sub-agent
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'sub_agents', 'write');
  if (denied) return denied;

  const { data: rawBody, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = DelegateBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.delegateTask(parsed.data);

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
