import { NextRequest } from 'next/server';
import { apiSuccess, requirePermission, getAuthenticatedUserId } from '@/lib/api-utils';
import { GET, PATCH, DELETE } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'read' },
  },
  async ({ params }) => {
  const { id } = params as { id: string };
  const detail = await ticketService.getTicket(id);
  return apiSuccess(detail);
}, );

export { GETHandler as GET };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'write' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };
  const body = await request.json();
  const { status, assignee_id, auto_assign } = body ?? {};

  const operatorId = getAuthenticatedUserId(request) ?? undefined;

  if (auto_assign) {
    const ticket = await ticketService.autoAssign(id);
    return apiSuccess({ ticket });
  }

  const ticket = await ticketService.updateTicket({
    id,
    status,
    assignee_id,
    operator_id: operatorId,
  });
  return apiSuccess({ ticket });
}, );

export { PATCHHandler as PATCH };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'delete' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };

  let reason: string | undefined;
  try {
    const body = await request.json();
    reason = body?.reason?.trim();
  } catch {
    // No body provided
  }

  const operatorId = getAuthenticatedUserId(request) ?? undefined;

  await ticketService.deleteTicket(id, operatorId, undefined, reason);
  return apiSuccess({ success: true });
}, );

export { DELETEHandler as DELETE };
