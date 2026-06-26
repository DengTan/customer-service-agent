/**
 * Gorgias Ticket Detail API
 * 获取单个工单详情
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasTicketDetailAPI');

/**
 * GET /api/gorgias/tickets/[id]
 * 获取单个工单详情
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireRole(request, ['observer', 'agent', 'admin']);
    if (authError) return authError;

    const { id } = await context.params;
    const ticketId = parseInt(id, 10);

    if (isNaN(ticketId)) {
      return NextResponse.json(
        { error: 'Invalid ticket ID' },
        { status: 400 }
      );
    }

    const ticket = await gorgiasService.getTicket(ticketId);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    // 同时获取消息
    const messages = await gorgiasService.getTicketMessages(ticketId, { limit: 100 });

    return NextResponse.json({
      ticket,
      messages: messages.messages,
      messagesHasMore: messages.hasMore,
    });
  } catch (err) {
    logger.error('Failed to get ticket', { 
      ticketId: (await context.params).id,
      error: err instanceof Error ? err.message : 'Unknown' 
    });
    return NextResponse.json(
      { error: 'Failed to get ticket' },
      { status: 500 }
    );
  }
}
