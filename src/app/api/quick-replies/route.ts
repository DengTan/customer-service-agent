import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { QuickReplyService } from '@/server/services/quick-reply-service';

const service = new QuickReplyService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const scope = searchParams.get('scope');

  const replies = await service.listReplies({ category, search, scope });
  return apiSuccess({ replies });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const reply = await service.createReply({
    title: body?.title as string,
    content: body?.content as string,
    category: body?.category as string,
    variables: body?.variables as unknown[],
    scope: body?.scope as string,
    creator_id: body?.creator_id as string,
  });
  return apiSuccess({ reply });
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const reply = await service.updateReply({
    id: body?.id as string,
    title: body?.title as string,
    content: body?.content as string,
    category: body?.category as string,
    variables: body?.variables as unknown[],
    scope: body?.scope as string,
  });
  return apiSuccess({ reply });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  await service.deleteReply(id!);
  return apiSuccess({ success: true });
});
