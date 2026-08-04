import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';

const service = new SubAgentService();

const ConversationIdSchema = z.string().uuid({ message: 'conversation_id 必须是合法 UUID' });

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'sub_agents', action: 'read' },
  },
  async ({ request }) => {
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
}, );

export { GETHandler as GET };
