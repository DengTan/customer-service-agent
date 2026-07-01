import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';

const ticketService = new TicketService();
const logger = getLogger('TicketsAuditLog');

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission(req, 'tickets', 'read');
  if (denied) return denied;

  try {
    const { id } = await params;
    const auditLog = await ticketService.getAuditLog(id);
    return NextResponse.json({ audit_log: auditLog });
  } catch (error) {
    logger.error('[Ticket Audit Log] GET error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '获取审计日志失败' }, { status: 500 });
  }
}
