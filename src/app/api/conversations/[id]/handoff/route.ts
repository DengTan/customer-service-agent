import { apiSuccess, parseJsonBody } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { HandoffService } from '@/server/services/handoff-service';

const handoffService = new HandoffService();

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async ({ request, params }) => {
    const { id: conversationId } = params as { id: string };
    const { data: body, error: parseError } = await parseJsonBody<{
      reason?: string;
      priority?: 'urgent' | 'normal';
    }>(request);
    if (parseError) return parseError;

    const result = await handoffService.requestHandoff({
      conversationId,
      reason: body?.reason,
      priority: body?.priority,
    });

    return apiSuccess({ success: true, summary: result.summary });
  },
);

export { POSTHandler as POST };
