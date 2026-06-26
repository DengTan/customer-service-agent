import { NextRequest, NextResponse } from 'next/server';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    console.error('[Ticket Sub-tickets] POST error:', error);
    const msg = error instanceof Error ? error.message : '创建子工单失败';
    if (msg.includes('circular') || msg.includes('循环')) {
      return NextResponse.json({ error: '设置此父工单会创建循环引用' }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
