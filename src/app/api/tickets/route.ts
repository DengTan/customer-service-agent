import { apiSuccess, apiError, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { GET, POST, PATCH } from '@/lib/api/with-api';
import { TicketService } from '@/server/services/ticket-service';
import { getLogger } from '@/lib/logger';
import { TICKET } from '@/lib/constants';

const ticketService = new TicketService();
const logger = getLogger('Tickets');

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'read' },
  },
  async ({ request }) => {
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
  },
);

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      title?: string;
      description?: string;
      category?: string;
      priority?: string;
      conversation_id?: string | null;
      creator_id?: string | null;
      assignee_id?: string | null;
      custom_field_values?: Array<{ field_id: string; field_value: string }>;
    }>(request);
    if (parseError) return parseError;
    const { title, description, category, priority, conversation_id, creator_id, assignee_id, custom_field_values } = body ?? {};

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return apiError('标题不能为空', { status: HttpStatus.BAD_REQUEST });
    }

    if (title.length > 500) {
      return apiError('标题不能超过500个字符', { status: HttpStatus.BAD_REQUEST });
    }

    if (description && typeof description === 'string' && description.length > TICKET.MAX_DESCRIPTION_LENGTH) {
      return apiError(`描述不能超过${TICKET.MAX_DESCRIPTION_LENGTH}个字符`, { status: HttpStatus.BAD_REQUEST });
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
    return apiSuccess({ ticket }, HttpStatus.CREATED);
  },
);

export { POSTHandler as POST };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'tickets', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      ids?: string[];
      status?: string;
      assignee_id?: string;
      priority?: string;
      category?: string;
    }>(request);
    if (parseError) return parseError;
    const { ids, status, assignee_id, priority, category } = body ?? {};

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return apiError('请选择至少一个工单', { status: HttpStatus.BAD_REQUEST });
    }

    const result = await ticketService.batchUpdate(ids, {
      status,
      assignee_id,
      priority,
      category,
    });
    return apiSuccess(result);
  },
);

export { PATCHHandler as PATCH };