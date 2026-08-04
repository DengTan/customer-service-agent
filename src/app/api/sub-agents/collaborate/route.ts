import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { parseJsonBody, HttpStatus, apiError } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';

const service = new SubAgentService();

const CollaborateBodySchema = z.object({
  conversation_id: z.string().uuid({ message: 'conversation_id 必须是合法 UUID' }),
  delegation_id: z.string().uuid().optional(),
  sender_bot_id: z.string().uuid({ message: 'sender_bot_id 必须是合法 UUID' }),
  receiver_bot_id: z.string().uuid({ message: 'receiver_bot_id 必须是合法 UUID' }),
  message_type: z.enum(['request', 'response', 'notify']).optional(),
  content: z.string().min(1).max(5000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'sub_agents', action: 'write' },
  },
  async ({ request }) => {
  const { data: rawBody, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = CollaborateBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.sendCollaboration({
    conversation_id: parsed.data.conversation_id,
    delegation_id: parsed.data.delegation_id,
    senderBotId: parsed.data.sender_bot_id,
    receiverBotId: parsed.data.receiver_bot_id,
    messageType: parsed.data.message_type ?? 'notify',
    content: parsed.data.content,
    context: parsed.data.context,
  });

  return Response.json({
    success: true,
    data: result.collaboration,
  });
}, );

export { POSTHandler as POST };
