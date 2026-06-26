import { NextRequest, NextResponse } from 'next/server';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auditLog = await ticketService.getAuditLog(id);
    return NextResponse.json({ audit_log: auditLog });
  } catch (error) {
    console.error('[Ticket Audit Log] GET error:', error);
    return NextResponse.json({ error: '获取审计日志失败' }, { status: 500 });
  }
}
