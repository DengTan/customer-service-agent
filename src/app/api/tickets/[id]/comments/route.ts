import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess, requirePermission, getAuthenticatedUserId } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(request, 'tickets', 'read');
  if (denied) return denied;

  const { id } = await params;
  const comments = await ticketService.listComments(id);
  return apiSuccess({
    comments: comments.map((c) => ({
      ...(c.comment as Record<string, unknown>),
      author_name: c.author_name,
      author_avatar: c.author_avatar,
    })),
  });
});

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(request, 'tickets', 'write');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const content = (body?.content as string) || '';
  const is_internal = (body?.is_internal as boolean) || false;
  // author_id 强制从 JWT 获取，禁止从请求体伪造
  const author_id = getAuthenticatedUserId(request) ?? null;

  const comment = await ticketService.addComment({
    ticket_id: id,
    content,
    is_internal,
    author_id,
  });
  return apiSuccess({
    comment: {
      ...(comment.comment as Record<string, unknown>),
      author_name: comment.author_name,
      author_avatar: comment.author_avatar,
    },
  }, 201);
});
