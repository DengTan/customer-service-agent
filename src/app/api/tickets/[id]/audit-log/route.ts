import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';

const ticketService = new TicketService();
const logger = getLogger('TicketsAuditLog');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'read' } },
  async ({ request, params }) => {
    try {
      const { id } = params as { id: string };
      const auditLog = await ticketService.getAuditLog(id);
      return new Response(JSON.stringify({ audit_log: auditLog }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Audit Log] GET error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '获取审计日志失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
