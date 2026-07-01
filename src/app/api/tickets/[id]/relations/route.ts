import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';

const ticketService = new TicketService();
const logger = getLogger('TicketsRelations');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [relations, subTickets, subTicketProgress] = await Promise.all([
      ticketService.getTicketRelations(id).catch(() => []),
      ticketService.getSubTickets(id).catch(() => []),
      ticketService.getSubTicketProgress(id).catch(() => ({ total: 0, closed: 0, resolved: 0, in_progress: 0 })),
    ]);
    return NextResponse.json({ relations, sub_tickets: subTickets, sub_ticket_progress: subTicketProgress });
  } catch (error) {
    logger.error('[Ticket Relations] GET error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '获取关联信息失败' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission(req, 'tickets', 'write');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const { target_ticket_id, relation_type } = body;

    if (!target_ticket_id) {
      return NextResponse.json({ error: '目标工单ID必填' }, { status: 400 });
    }

    const relation = await ticketService.addTicketRelation(id, target_ticket_id, relation_type || 'related');
    return NextResponse.json({ relation }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '创建关联失败';
    if (msg.includes('已存在') || msg.includes('already exists')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes('circular') || msg.includes('循环')) {
      return NextResponse.json({ error: '设置此父工单会创建循环引用' }, { status: 400 });
    }
    logger.error('[Ticket Relations] POST error', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission(req, 'tickets', 'write');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const relationId = searchParams.get('relation_id');
    if (!relationId) {
      return NextResponse.json({ error: '关联ID必填' }, { status: 400 });
    }
    await ticketService.removeTicketRelation(relationId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Ticket Relations] DELETE error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '删除关联失败' }, { status: 500 });
  }
}
