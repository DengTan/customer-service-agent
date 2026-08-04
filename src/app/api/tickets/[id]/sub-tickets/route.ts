import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';

const ticketService = new TicketService();
const logger = getLogger('TicketsSubTickets');

export const POST = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request, params }) => {
    try {
      const { id: parentTicketId } = params as { id: string };
      const body = await request.json();
      const { title, description, category, priority, assignee_id } = body;

      if (!title) {
        return new Response(JSON.stringify({ error: '标题不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const ticket = await ticketService.createSubTicket(parentTicketId, {
        title,
        description: description || null,
        category: category || 'other',
        priority: priority || 'medium',
        creator_id: null,
        assignee_id: assignee_id || null,
        conversation_id: null,
      });

      return new Response(JSON.stringify({ ticket }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '创建子工单失败';
      if (msg.includes('circular') || msg.includes('循环')) {
        return new Response(JSON.stringify({ error: '设置此父工单会创建循环引用' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      logger.error('[Ticket Sub-tickets] POST error', { error: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
