/**
 * Gorgias Ticket Detail API
 * 获取单个工单详情
 */

import { NextRequest } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasTicketDetailAPI');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request, params }) => {
    try {
      const { id } = params as { id: string };
      const ticketId = parseInt(id, 10);

      if (isNaN(ticketId)) {
        return new Response(JSON.stringify({ error: 'Invalid ticket ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const ticket = await gorgiasService.getTicket(ticketId);

      if (!ticket) {
        return new Response(JSON.stringify({ error: 'Ticket not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }

      const messages = await gorgiasService.getTicketMessages(ticketId, { limit: 100 });

      return new Response(JSON.stringify({
        ticket,
        messages: messages.messages,
        messagesHasMore: messages.hasMore,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      logger.error('Failed to get ticket', {
        error: err instanceof Error ? err.message : 'Unknown'
      });
      return new Response(JSON.stringify({ error: 'Failed to get ticket' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
