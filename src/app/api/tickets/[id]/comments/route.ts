import { NextRequest } from 'next/server';
import { apiSuccess, requirePermission, getAuthenticatedUserId } from '@/lib/api-utils';
import { GET, POST } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'read' },
  },
  async ({ params }) => {
  const { id } = params as { id: string };
  const comments = await ticketService.listComments(id);
  return apiSuccess({
    comments: comments.map((c) => ({
      ...(c.comment as Record<string, unknown>),
      author_name: c.author_name,
      author_avatar: c.author_avatar,
    })),
  });
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'write' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };
  const body = await request.json();
  const content = (body?.content as string) || '';
  const is_internal = (body?.is_internal as boolean) || false;
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
}, );

export { POSTHandler as POST };
