import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requirePermission } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';
import { TICKET } from '@/lib/constants';

const ticketService = new TicketService();
const logger = getLogger('Tickets');

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'tickets', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const filters = {
    status: searchParams.get('status') ?? undefined,
    priority: searchParams.get('priority') ?? undefined,
    category: searchParams.get('category') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    assignee_id: searchParams.get('assignee_id') ?? undefined,
    sort_by: searchParams.get('sort_by') ?? undefined,
    sort_order: searchParams.get('sort_order') ?? undefined,
    page: parseInt(searchParams.get('page') || '1', 10),
    page_size: parseInt(searchParams.get('page_size') || String(TICKET.PAGE_SIZE), 10),
  };
  const result = await ticketService.listTickets(filters);

  // Fire-and-forget: check for unassigned tickets that need alerts
  ticketService.checkUnassignedTickets().catch((err) => {
    logger.error('Failed to check unassigned tickets', { error: err });
  });

  return apiSuccess(result);
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'tickets', 'write');
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '请求体格式无效' },
      { status: 400 }
    );
  }
  const { title, description, category, priority, conversation_id, creator_id, assignee_id, custom_field_values } = body ?? {};

  // Validate required fields
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: '标题不能为空' },
      { status: 400 }
    );
  }

  if (title.length > 500) {
    return NextResponse.json(
      { success: false, error: '标题不能超过500个字符' },
      { status: 400 }
    );
  }

  if (description && typeof description === 'string' && description.length > TICKET.MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { success: false, error: `描述不能超过${TICKET.MAX_DESCRIPTION_LENGTH}个字符` },
      { status: 400 }
    );
  }

  const ticket = await ticketService.createTicket({
    title: title.trim(),
    description: description || null,
    category: category || 'other',
    priority: priority || 'medium',
    conversation_id: conversation_id || null,
    creator_id: creator_id || null,
    assignee_id: assignee_id || null,
    custom_field_values: custom_field_values || undefined,
  });
  return apiSuccess({ ticket }, 201);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'tickets', 'write');
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '请求体格式无效' },
      { status: 400 }
    );
  }
  const { ids, status, assignee_id, priority, category } = body ?? {};

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { success: false, error: '请选择至少一个工单' },
      { status: 400 }
    );
  }

  const result = await ticketService.batchUpdate(ids, {
    status,
    assignee_id,
    priority,
    category,
  });
  return apiSuccess(result);
});
