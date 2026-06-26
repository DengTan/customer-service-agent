import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requireRole } from '@/lib/api-utils';
import { TicketService } from '@/server/services/ticket-service';

const ticketService = new TicketService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
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
    page_size: parseInt(searchParams.get('page_size') || '50', 10),
  };
  const result = await ticketService.listTickets(filters);

  // Fire-and-forget: check for unassigned tickets that need alerts
  ticketService.checkUnassignedTickets().catch(() => {});

  return apiSuccess(result);
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { title, description, category, priority, conversation_id, creator_id, assignee_id, custom_field_values } = body ?? {};

  const ticket = await ticketService.createTicket({
    title,
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
  const body = await request.json();
  const { ids, status, assignee_id, priority, category } = body ?? {};

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return apiSuccess({ error: '请选择至少一个工单' }, 400);
  }

  const result = await ticketService.batchUpdate(ids, {
    status,
    assignee_id,
    priority,
    category,
  });
  return apiSuccess(result);
});
