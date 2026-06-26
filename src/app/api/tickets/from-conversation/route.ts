import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
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
