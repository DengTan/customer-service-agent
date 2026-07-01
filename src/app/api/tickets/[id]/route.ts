import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess, requireRole, requirePermission, getAuthenticatedUserId } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(request, 'tickets', 'read');
  if (denied) return denied;

  const { id } = await params;
  const detail = await ticketService.getTicket(id);
  return apiSuccess(detail);
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(request, 'tickets', 'write');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { status, assignee_id, auto_assign } = body ?? {};

  // operator_id 强制从 JWT 获取，禁止从请求体伪造
  const operatorId = getAuthenticatedUserId(request) ?? undefined;

  // Auto-assign mode
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
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(request, 'tickets', 'delete');
  if (denied) return denied;

  const { id } = await params;
  
  // Parse body for optional reason
  let reason: string | undefined;
  try {
    const body = await request.json();
    reason = body?.reason?.trim();
  } catch {
    // No body provided
  }
  
  // operatorId is forced from JWT, body operator_name is ignored
  const operatorId = getAuthenticatedUserId(request) ?? undefined;

  await ticketService.deleteTicket(id, operatorId, undefined, reason);
  return apiSuccess({ success: true });
});
