import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';

const ticketService = new TicketService();
const logger = getLogger('TicketsSubTickets');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission(req, 'tickets', 'write');
  if (denied) return denied;

  try {
    const { id: parentTicketId } = await params;
    const body = await req.json();
    const { title, description, category, priority, assignee_id } = body;

    if (!title) {
      return NextResponse.json({ error: '标题不能为空' }, { status: 400 });
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

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '创建子工单失败';
    if (msg.includes('circular') || msg.includes('循环')) {
      return NextResponse.json({ error: '设置此父工单会创建循环引用' }, { status: 400 });
    }
    logger.error('[Ticket Sub-tickets] POST error', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
