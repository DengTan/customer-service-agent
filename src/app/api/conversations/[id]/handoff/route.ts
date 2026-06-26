import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandler } from '@/lib/api-utils';
import { HandoffService } from '@/server/services/handoff-service';

const handoffService = new HandoffService();

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: conversationId } = await params;
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
});
