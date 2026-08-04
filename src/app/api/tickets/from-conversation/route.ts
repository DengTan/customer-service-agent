import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const POST = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
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
    return new Response(JSON.stringify({ ok: true, ticket }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
