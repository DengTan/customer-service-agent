/**
 * Ticket relations API
 */
import { withApi } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';

const ticketService = new TicketService();
const logger = getLogger('TicketsRelations');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ params }) => {
    const { id } = params as { id: string };
    try {
      const [relations, subTickets, subTicketProgress] = await Promise.all([
        ticketService.getTicketRelations(id).catch(() => []),
        ticketService.getSubTickets(id).catch(() => []),
        ticketService.getSubTicketProgress(id).catch(() => ({ total: 0, closed: 0, resolved: 0, in_progress: 0 })),
      ]);
      return new Response(JSON.stringify({ relations, sub_tickets: subTickets, sub_ticket_progress: subTicketProgress }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Relations] GET error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '获取关联信息失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request, params }) => {
    const { id } = params as { id: string };
    try {
      const body = await request.json();
      const { target_ticket_id, relation_type } = body;

      if (!target_ticket_id) {
        return new Response(JSON.stringify({ error: '目标工单ID必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const relation = await ticketService.addTicketRelation(id, target_ticket_id, relation_type || 'related');
      return new Response(JSON.stringify({ relation }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '创建关联失败';
      if (msg.includes('已存在') || msg.includes('already exists')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('circular') || msg.includes('循环')) {
        return new Response(JSON.stringify({ error: '设置此父工单会创建循环引用' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      logger.error('[Ticket Relations] POST error', { error: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const relationId = searchParams.get('relation_id');
      if (!relationId) {
        return new Response(JSON.stringify({ error: '关联ID必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await ticketService.removeTicketRelation(relationId);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Relations] DELETE error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '删除关联失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
