import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandler } from '@/lib/api-utils';
import { ConversationService } from '@/server/services/conversation-service';

const conversationService = new ConversationService();

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const messageLimit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const messagePage = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);

  const detail = await conversationService.getConversationDetail(id, messageLimit, messagePage);
  return apiSuccess(detail);
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  await conversationService.updateConversation(id, body ?? {});
  return apiSuccess({ success: true });
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  await conversationService.deleteConversation(id);
  return apiSuccess({ success: true });
});
