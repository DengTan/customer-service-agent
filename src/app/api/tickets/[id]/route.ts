import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess, requireRole } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const detail = await ticketService.getTicket(id);
  return apiSuccess(detail);
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = await request.json();
  const { status, assignee_id, operator_id, auto_assign } = body ?? {};

  // Auto-assign mode
  if (auto_assign) {
    const ticket = await ticketService.autoAssign(id);
    return apiSuccess({ ticket });
  }

  const ticket = await ticketService.updateTicket({
    id,
    status,
    assignee_id,
    operator_id,
  });
  return apiSuccess({ ticket });
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const roleError = requireRole(request, ['admin']);
  if (roleError) return roleError;

  const { id } = await params;
  
  // Parse body for optional reason
  let reason: string | undefined;
  try {
    const body = await request.json();
    reason = body?.reason?.trim();
  } catch {
    // No body provided
  }
  
  // Get operator info from headers
  const operatorId = request.headers.get('x-user-id') || undefined;
  const operatorName = request.headers.get('x-user-name') || undefined;
  
  await ticketService.deleteTicket(id, operatorId, operatorName, reason);
  return apiSuccess({ success: true });
});
