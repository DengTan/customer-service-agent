import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, HttpStatus, withErrorHandler } from '@/lib/api-utils';
import { ConversationService } from '@/server/services/conversation-service';

const conversationService = new ConversationService();

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: conversationId } = await params;
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
});
