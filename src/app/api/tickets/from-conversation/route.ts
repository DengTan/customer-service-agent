import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requirePermission } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'tickets', 'write');
  if (denied) return denied;

  const body = await request.json();
  const { conversation_id, title, description, category, priority, creator_id, assignee_id } = body ?? {};

  const ticket = await ticketService.createTicketFromConversation({
    conversation_id,
    title,
    description: description || null,
    category: category || 'other',
    priority: priority || 'medium',
    creator_id: creator_id || null,
    assignee_id: assignee_id || null,
  });
  return apiSuccess({ ticket }, 201);
});
