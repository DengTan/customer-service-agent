import { apiSuccess, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { ConversationService } from '@/server/services/conversation-service';

const conversationService = new ConversationService();

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async ({ request, params }) => {
    const { id: conversationId } = params as { id: string };
    const { data: body, error: parseError } = await parseJsonBody<{
      content?: string;
      mentions?: string[];
    }>(request);
    if (parseError) return parseError;

    const message = await conversationService.addInternalNote(
      conversationId,
      body?.content,
      body?.mentions || [],
    );

    return apiSuccess({ message }, HttpStatus.CREATED);
  },
);

export { POSTHandler as POST };
