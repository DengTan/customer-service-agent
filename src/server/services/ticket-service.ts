import {
  TicketRepository,
  type TicketFilters,
  type CreateTicketInput,
  type UpdateTicketInput,
  type CreateCommentInput,
  type CommentWithAuthor,
  type TicketDetail,
} from '@/server/repositories/ticket-repository';
import type { TicketRow, TicketCommentRow } from '@/server/repositories/types';
import { AlertRepository, type CreateAlertInput } from '@/server/repositories/alert-repository';
import {
  getCategories,
  getCustomFields,
  getFieldValues,
  upsertFieldValues,
  type TicketCategoryRecord,
  type TicketCustomFieldRecord,
  type TicketFieldValueRecord,
} from '@/server/repositories/ticket-custom-field-repository';
import {
  addRelation,
  removeRelation,
  getRelations,
  getChildTickets,
  setParentTicket,
  getChildTicketProgress,
  type TicketRelationType,
  type TicketRelationRecord,
  type ChildTicketSummary,
} from '@/server/repositories/ticket-relation-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { SkillGroupRepository } from '@/server/repositories/skill-group-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import type { TicketStatus } from '@/lib/types';
import { TICKET } from '@/lib/constants';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

type TicketStatusType = 'open' | 'in_progress' | 'pending_customer' | 'resolved' | 'closed';

const VALID_TRANSITIONS: Record<TicketStatusType, TicketStatusType[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['pending_customer', 'resolved', 'closed'],
  pending_customer: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

const VALID_CATEGORIES = ['refund', 'logistics', 'product', 'account', 'other'] as const;
const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export interface CreateTicketFromConversationInput extends CreateTicketInput {
  conversation_id: string;
}

export interface StatusCounts {
  open: number;
  in_progress: number;
  pending_customer: number;
  resolved: number;
  closed: number;
}

export interface TicketListResult {
  tickets: Record<string, unknown>[];
  status_counts: StatusCounts;
  total_count: number;
  page: number;
  page_size: number;
}

// SLA default thresholds (minutes) per priority
export const DEFAULT_SLA_RESPONSE_MINUTES: Record<string, number> = {
  urgent: 15,
  high: 30,
  medium: 60,
  low: 240,
};

export const DEFAULT_SLA_RESOLVE_MINUTES: Record<string, number> = {
  urgent: 120,
  high: 480,
  medium: 1440,
  low: 2880,
};

export interface SLAConfig {
  enabled: boolean;
  responseMinutes: Record<string, number>;
  resolveMinutes: Record<string, number>;
}

export class TicketService {
  private readonly alertRepo = new AlertRepository();
  private readonly settingsRepo = new SettingsRepository();

  constructor(private readonly tickets = new TicketRepository()) {}

  async listTickets(filters: TicketFilters): Promise<TicketListResult> {
    try {
      const result = await this.tickets.list(filters);
      result.tickets = await this.enrichWithSLA(result.tickets);

      // Fire-and-forget: check SLA overdue alerts
      this.checkSLAOverdue().catch((err) => {
        logger.error('[TicketService] Failed to check SLA overdue', { error: err?.message ?? String(err) });
      });

      return {
        ...result,
        page: filters.page || 1,
        page_size: filters.page_size || 50,
      };
    } catch (error) {
      throw toServiceError(error, '获取工单列表失败', 'DB_QUERY_ERROR');
    }
  }

  async createTicket(input: CreateTicketInput & { custom_field_values?: { field_id: string; field_value: string }[] }): Promise<unknown> {
    if (!input.title) {
      throw new ServiceError('标题不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    const MAX_DESCRIPTION_LENGTH = TICKET.MAX_DESCRIPTION_LENGTH;
    if (input.description && input.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ServiceError(`描述不能超过${MAX_DESCRIPTION_LENGTH}个字符`, {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    if (input.category && !VALID_CATEGORIES.includes(input.category as typeof VALID_CATEGORIES[number])) {
      throw new ServiceError('无效的分类', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    if (input.priority && !VALID_PRIORITIES.includes(input.priority as typeof VALID_PRIORITIES[number])) {
      throw new ServiceError('无效的优先级', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const { custom_field_values, ...ticketInput } = input;
      const ticket = await this.tickets.create(ticketInput);
      const t = ticket as { id: string; ticket_number?: string; title?: string; conversation_id?: string | null; assignee_id?: string | null };

      await this.tickets.logStatusChange(
        t.id,
        null,
        'open',
        input.creator_id ?? null
      );

      // Save custom field values if provided
      if (custom_field_values && custom_field_values.length > 0) {
        await upsertFieldValues(t.id, custom_field_values);
      }

      // Notify assignee if specified
      if (t.assignee_id) {
        this.notifyTicketAssigned(t.id, t.ticket_number ?? '', t.title ?? '', t.assignee_id, t.conversation_id ?? null);
      }

      // Audit log - consistent format: { before: {...}, after: {...} }
      this.writeAuditLog(t.id, 'create', input.creator_id ?? null, null, { before: null, after: { title: input.title, category: input.category, priority: input.priority } });

      // Notify creator that ticket was created
      this.notifyTicketStatusChanged(
        t.id, t.ticket_number ?? '', t.title ?? '',
        null, 'open',
        input.creator_id ?? null,
        input.creator_id ?? null,
        t.assignee_id ?? null,
        t.conversation_id ?? null,
      );

      // Auto-assign if enabled and no assignee specified
      if (!t.assignee_id && await this.isAutoAssignEnabled()) {
        this.autoAssign(t.id).catch((err) => {
          logger.error('[TicketService] Failed to auto-assign ticket', { error: err?.message ?? String(err), ticketId: t.id });
        }); // fire-and-forget
      }

      return ticket;
    } catch (error) {
      throw toServiceError(error, '创建工单失败', 'DB_INSERT_ERROR');
    }
  }

  async createTicketFromConversation(input: CreateTicketFromConversationInput): Promise<unknown> {
    if (!input.conversation_id) {
      throw new ServiceError('对话ID不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const conversation = await this.tickets.findConversationById(input.conversation_id);
      if (!conversation) {
        throw new ServiceError('对话不存在', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      const existingTickets = await this.tickets.findByConversationId(input.conversation_id);
      if (existingTickets && existingTickets.length > 0) {
        throw new ServiceError('该对话已有未关闭工单', {
          status: 409,
          code: 'CONFLICT',
        });
      }

      const conv = conversation as { title?: string; summary?: string };
      const ticketTitle = input.title || conv.title || '来自对话的工单';
      const ticketDescription = input.description || conv.summary || '';

      const MAX_DESCRIPTION_LENGTH = TICKET.MAX_DESCRIPTION_LENGTH;
      if (ticketDescription.length > MAX_DESCRIPTION_LENGTH) {
        throw new ServiceError(`描述不能超过${MAX_DESCRIPTION_LENGTH}个字符`, {
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }

      if (input.category && !VALID_CATEGORIES.includes(input.category as typeof VALID_CATEGORIES[number])) {
        throw new ServiceError('无效的分类', {
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }

      if (input.priority && !VALID_PRIORITIES.includes(input.priority as typeof VALID_PRIORITIES[number])) {
        throw new ServiceError('无效的优先级', {
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }

      const ticket = await this.tickets.create({
        ...input,
        title: ticketTitle,
        description: ticketDescription,
      });
      const t = ticket as { id: string; ticket_number?: string; title?: string; conversation_id?: string | null; assignee_id?: string | null };

      await this.tickets.logStatusChange(
        t.id,
        null,
        'open',
        input.creator_id ?? null
      );

      // Notify assignee if specified
      if (t.assignee_id) {
        this.notifyTicketAssigned(t.id, t.ticket_number ?? '', t.title ?? '', t.assignee_id, t.conversation_id ?? null);
      }

      // Notify creator
      this.notifyTicketStatusChanged(
        t.id, t.ticket_number ?? '', t.title ?? '',
        null, 'open',
        input.creator_id ?? null,
        input.creator_id ?? null,
        t.assignee_id ?? null,
        t.conversation_id ?? null,
      );

      // Auto-assign if enabled and no assignee specified
      if (!t.assignee_id && await this.isAutoAssignEnabled()) {
        this.autoAssign(t.id).catch((err) => {
          logger.error('[TicketService] Failed to auto-assign ticket from conversation', { error: err?.message ?? String(err), ticketId: t.id });
        }); // fire-and-forget
      }

      return ticket;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '从对话创建工单失败', 'DB_INSERT_ERROR');
    }
  }

  async getTicket(id: string): Promise<TicketDetail> {
    if (!id) {
      throw new ServiceError('缺少工单 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const detail = await this.tickets.getDetail(id);
      // Attach custom field values
      try {
        const fieldValues = await getFieldValues(id);
        return { ...detail, custom_field_values: fieldValues };
      } catch {
        // Non-critical - field values are optional
        return detail;
      }
    } catch (error) {
      const repoError = error as { message?: string };
      if (repoError.message?.includes('ticket not found')) {
        throw new ServiceError('工单不存在', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }
      throw toServiceError(error, '获取工单详情失败', 'DB_QUERY_ERROR');
    }
  }

  async updateTicket(input: UpdateTicketInput): Promise<unknown> {
    if (!input.id) {
      throw new ServiceError('缺少工单 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const current = await this.tickets.findById(input.id);
      if (!current) {
        throw new ServiceError('工单不存在', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      const ticket = current as { status: TicketStatus; ticket_number?: string; title?: string; conversation_id?: string | null; assignee_id?: string | null; creator_id?: string | null; parent_ticket_id?: string | null };
      const updateData: UpdateTicketInput = { id: input.id };

      if (input.status && input.status !== ticket.status) {
        const allowed = VALID_TRANSITIONS[ticket.status as TicketStatusType];
        if (!allowed || !allowed.includes(input.status as TicketStatusType)) {
          throw new ServiceError(`不允许从 ${ticket.status} 变更为 ${input.status}`, {
            status: 400,
            code: 'VALIDATION_ERROR',
          });
        }
        updateData.status = input.status;

        await this.tickets.logStatusChange(
          input.id,
          ticket.status,
          input.status,
          input.operator_id ?? null
        );

        // Notify about status change
        this.notifyTicketStatusChanged(
          input.id,
          ticket.ticket_number ?? '',
          ticket.title ?? '',
          ticket.status,
          input.status,
          input.operator_id ?? null,
          ticket.creator_id ?? null,
          input.assignee_id ?? ticket.assignee_id ?? null,
          ticket.conversation_id ?? null,
        );

        // Parent-child linkage: check if all sub-tickets are now closed
        if (ticket.parent_ticket_id && (updateData.status === 'resolved' || updateData.status === 'closed')) {
          this.checkParentTicketClosure(ticket.parent_ticket_id, input.operator_id ?? null).catch((err) => {
            logger.error('[TicketService] Failed to check parent ticket closure', { error: err?.message ?? String(err), parentTicketId: ticket.parent_ticket_id });
          });
        }
      }

      if (input.assignee_id !== undefined) {
        const isReassignment = ticket.assignee_id && ticket.assignee_id !== input.assignee_id;
        updateData.assignee_id = input.assignee_id;

        // Notify new assignee
        if (input.assignee_id && (isReassignment || !ticket.assignee_id)) {
          this.notifyTicketAssigned(
            input.id,
            ticket.ticket_number ?? '',
            ticket.title ?? '',
            input.assignee_id,
            ticket.conversation_id ?? null,
          );
        }
      }

      // Audit log
      const auditChanges: Record<string, unknown> = {};
      if (updateData.status) auditChanges.status = { from: ticket.status, to: updateData.status };
      if (updateData.assignee_id !== undefined) auditChanges.assignee_id = { from: ticket.assignee_id, to: updateData.assignee_id };
      if (Object.keys(auditChanges).length > 0) {
        // Consistent audit log format: { before: { field: from }, after: { field: to } }
        this.writeAuditLog(input.id, 'update', input.operator_id ?? null, null, { before: auditChanges, after: null });
      }

      return await this.tickets.update(updateData);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '更新工单失败', 'DB_UPDATE_ERROR');
    }
  }

  async deleteTicket(
    id: string,
    operatorId?: string,
    operatorName?: string,
    reason?: string
  ): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少工单 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      // Get ticket data for audit log
      const ticket = await this.tickets.findById(id) as TicketRow | null;
      // Audit log before delete - consistent format: { before: {...}, after: null }
      this.writeAuditLog(id, 'delete', operatorId ?? null, operatorName ?? null, {
        before: { ticket_data: ticket },
        after: null,
        reason: reason ?? null,
      });
      await this.tickets.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除工单失败', 'DB_DELETE_ERROR');
    }
  }

  // ──────────────────────────────────────────────
  // Auto-assign (Phase 2)
  // ──────────────────────────────────────────────

  /**
   * Map ticket category to skill group keywords.
   * Used to find the best skill group for a ticket category.
   */
  private static readonly CATEGORY_SKILL_GROUP_MAP: Record<string, string[]> = {
    refund: ['售后', '退款', '退货'],
    logistics: ['物流', '快递', '配送'],
    product: ['产品', '售前', '咨询'],
    account: ['账户', '技术', '支持'],
  };

  /**
   * Auto-assign a ticket to the best available agent.
   * Strategy: skill group match (by category) → schedule awareness → load balancing.
   * Returns the updated ticket, or the original ticket if no agent available.
   */
  async autoAssign(ticketId: string): Promise<unknown> {
    if (!ticketId) {
      throw new ServiceError('缺少工单 ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const current = await this.tickets.findById(ticketId);
      if (!current) {
        throw new ServiceError('工单不存在', { status: 404, code: 'NOT_FOUND' });
      }

      const ticket = current as {
        status: string;
        assignee_id: string | null;
        category: string;
        ticket_number?: string;
        title?: string;
        conversation_id?: string | null;
        creator_id?: string | null;
      };

      // Can only auto-assign unassigned open/in_progress tickets
      if (!['open', 'in_progress'].includes(ticket.status)) {
        throw new ServiceError('该状态下无法自动指派', { status: 400, code: 'VALIDATION_ERROR' });
      }
      if (ticket.assignee_id) {
        throw new ServiceError('工单已指派，无法自动分配', { status: 400, code: 'VALIDATION_ERROR' });
      }

      const bestAgentId = await this.findBestAgentForTicket(ticket.category);
      if (!bestAgentId) {
        // No agent available - return ticket as-is
        return current;
      }

      // Assign the ticket
      const updated = await this.tickets.update({
        id: ticketId,
        assignee_id: bestAgentId,
      });

      // Notify the assigned agent
      this.notifyTicketAssigned(
        ticketId,
        ticket.ticket_number ?? '',
        ticket.title ?? '',
        bestAgentId,
        ticket.conversation_id ?? null,
      );

      return updated;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '自动指派失败', 'DB_UPDATE_ERROR');
    }
  }

  /**
   * Find the best agent for a ticket based on:
   * 1. Skill group match (ticket category → skill group keywords)
   * 2. Schedule awareness (agent on duty today)
   * 3. Load balancing (agent with fewest active tickets)
   */
  private async findBestAgentForTicket(category: string): Promise<string | null> {
    if (isDemoMode()) return null;

    const client = getSupabaseClient();

    // Step 1: Find matching skill groups by category
    const keywords = TicketService.CATEGORY_SKILL_GROUP_MAP[category] ?? [];
    let matchedGroupMemberIds: string[] = [];

    if (keywords.length > 0) {
      const skillGroupRepo = new SkillGroupRepository();
      const groups = await skillGroupRepo.list({}) as Array<{
        id: string;
        name: string;
        member_ids: string[];
      }>;

      for (const group of groups) {
        const nameMatch = keywords.some(kw => group.name?.includes(kw));
        if (nameMatch && Array.isArray(group.member_ids)) {
          matchedGroupMemberIds = matchedGroupMemberIds.concat(group.member_ids);
        }
      }
      // Deduplicate
      matchedGroupMemberIds = [...new Set(matchedGroupMemberIds)];
    }

    // Step 2: Get online agents
    const { data: onlineAgents } = await client
      .from('agent_sessions')
      .select('user_id')
      .eq('status', 'online');

    const onlineAgentIds = (onlineAgents as Array<{ user_id: string }> ?? []).map(a => a.user_id);
    if (onlineAgentIds.length === 0) return null;

    // Step 3: Get scheduled agents for today
    const today = new Date().toISOString().split('T')[0];
    const { data: scheduledAgents } = await client
      .from('schedules')
      .select('user_id, skill_group_id')
      .eq('date', today)
      .in('user_id', onlineAgentIds);

    const scheduledSet = new Set(
      (scheduledAgents as Array<{ user_id: string }> ?? []).map(s => s.user_id)
    );

    // Build candidate pool: online agents, preferring skill group members
    let candidates = onlineAgentIds;

    // If we have skill group matches, prioritize those who are also online
    if (matchedGroupMemberIds.length > 0) {
      const matchedOnline = matchedGroupMemberIds.filter(id => onlineAgentIds.includes(id));
      if (matchedOnline.length > 0) {
        // Among matched, prefer scheduled ones
        const matchedScheduled = matchedOnline.filter(id => scheduledSet.has(id));
        if (matchedScheduled.length > 0) {
          candidates = matchedScheduled;
        } else {
          candidates = matchedOnline;
        }
      } else {
        // No matched skill group members online, prefer scheduled online agents
        const scheduledOnline = onlineAgentIds.filter(id => scheduledSet.has(id));
        if (scheduledOnline.length > 0) {
          candidates = scheduledOnline;
        }
      }
    } else {
      // No skill group match, prefer scheduled agents
      const scheduledOnline = onlineAgentIds.filter(id => scheduledSet.has(id));
      if (scheduledOnline.length > 0) {
        candidates = scheduledOnline;
      }
    }

    // Step 4: Load balance - pick agent with fewest active tickets
    const ticketCounts = await this.getAgentTicketCounts(candidates);
    candidates.sort((a, b) => (ticketCounts[a] ?? 0) - (ticketCounts[b] ?? 0));

    return candidates[0] ?? null;
  }

  /**
   * Get the count of active (open + in_progress) tickets for each agent.
   */
  private async getAgentTicketCounts(agentIds: string[]): Promise<Record<string, number>> {
    if (isDemoMode() || agentIds.length === 0) return {};

    const client = getSupabaseClient();
    const { data } = await client
      .from('tickets')
      .select('assignee_id')
      .in('assignee_id', agentIds)
      .in('status', ['open', 'in_progress']);

    const counts: Record<string, number> = {};
    for (const id of agentIds) counts[id] = 0;
    for (const row of (data as Array<{ assignee_id: string }> ?? [])) {
      if (row.assignee_id) {
        counts[row.assignee_id] = (counts[row.assignee_id] ?? 0) + 1;
      }
    }
    return counts;
  }

  /**
   * Check if auto-assign is enabled in settings.
   */
  private async isAutoAssignEnabled(): Promise<boolean> {
    try {
      const rows = await this.settingsRepo.list();
      const map = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});
      return map.ticket_auto_assign === 'true';
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────
  // SLA (Phase 3)
  // ──────────────────────────────────────────────

  /**
   * Read SLA config from settings.
   */
  async getSLAConfig(): Promise<SLAConfig> {
    try {
      const rows = await this.settingsRepo.list();
      const map = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});

      const enabled = map.ticket_sla_enabled === 'true';
      let responseMinutes = DEFAULT_SLA_RESPONSE_MINUTES;
      let resolveMinutes = DEFAULT_SLA_RESOLVE_MINUTES;

      try {
        if (map.ticket_sla_response_minutes) {
          responseMinutes = JSON.parse(map.ticket_sla_response_minutes);
        }
      } catch { /* use default */ }

      try {
        if (map.ticket_sla_resolve_minutes) {
          resolveMinutes = JSON.parse(map.ticket_sla_resolve_minutes);
        }
      } catch { /* use default */ }

      return { enabled, responseMinutes, resolveMinutes };
    } catch {
      return {
        enabled: false,
        responseMinutes: DEFAULT_SLA_RESPONSE_MINUTES,
        resolveMinutes: DEFAULT_SLA_RESOLVE_MINUTES,
      };
    }
  }

  /**
   * Calculate SLA status for a ticket.
   * Returns whether response/resolve deadlines are overdue and the remaining time.
   */
  calculateSLA(
    ticket: {
      status: string;
      priority: string;
      created_at: string;
      updated_at: string | null;
      assignee_id: string | null;
    },
    config: SLAConfig,
  ): {
    response_overdue: boolean;
    resolve_overdue: boolean;
    response_remaining_ms: number | null;
    resolve_remaining_ms: number | null;
  } {
    if (!config.enabled || ticket.status === 'resolved' || ticket.status === 'closed') {
      return {
        response_overdue: false,
        resolve_overdue: false,
        response_remaining_ms: null,
        resolve_remaining_ms: null,
      };
    }

    const now = Date.now();
    const createdAt = new Date(ticket.created_at).getTime();

    // Response deadline: time from creation to first response (assignee action)
    const responseLimit = (config.responseMinutes[ticket.priority] ?? 60) * 60 * 1000;
    const responseDeadline = createdAt + responseLimit;
    const responseRemaining = responseDeadline - now;
    const responseOverdue = responseRemaining < 0;

    // Resolve deadline: time from creation to resolution
    const resolveLimit = (config.resolveMinutes[ticket.priority] ?? 1440) * 60 * 1000;
    const resolveDeadline = createdAt + resolveLimit;
    const resolveRemaining = resolveDeadline - now;
    const resolveOverdue = resolveRemaining < 0;

    return {
      response_overdue: responseOverdue,
      resolve_overdue: resolveOverdue,
      response_remaining_ms: responseRemaining > 0 ? responseRemaining : null,
      resolve_remaining_ms: resolveRemaining > 0 ? resolveRemaining : null,
    };
  }

  /**
   * Enrich ticket list items with SLA status (is_overdue, sla_remaining).
   */
  async enrichWithSLA(tickets: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const config = await this.getSLAConfig();
    if (!config.enabled) {
      return tickets.map(t => ({ ...t, is_overdue: false, sla_remaining_ms: null, sla_deadline_at: null, resolve_deadline_at: null }));
    }

    return tickets.map(t => {
      const sla = this.calculateSLA(t as {
        status: string;
        priority: string;
        created_at: string;
        updated_at: string | null;
        assignee_id: string | null;
      }, config);
      // Calculate deadline timestamps for client-side real-time countdown
      const now = new Date();
      const sla_deadline_at = sla.response_remaining_ms !== null
        ? new Date(now.getTime() + sla.response_remaining_ms).toISOString()
        : (sla.resolve_remaining_ms !== null
          ? new Date(now.getTime() + sla.resolve_remaining_ms).toISOString()
          : null);
      const resolve_deadline_at = sla.resolve_remaining_ms !== null
        ? new Date(now.getTime() + sla.resolve_remaining_ms).toISOString()
        : null;

      return {
        ...t,
        is_overdue: sla.response_overdue || sla.resolve_overdue,
        response_overdue: sla.response_overdue,
        resolve_overdue: sla.resolve_overdue,
        // Keep sla_remaining_ms for backward compatibility, frontend should use sla_deadline_at for real-time
        sla_remaining_ms: sla.response_remaining_ms ?? sla.resolve_remaining_ms,
        sla_deadline_at,
        resolve_deadline_at,
      };
    });
  }

  /**
   * Check SLA for all active tickets and create alerts for overdue ones.
   * Called periodically (e.g., when ticket list is loaded).
   */
  async checkSLAOverdue(): Promise<void> {
    const config = await this.getSLAConfig();
    if (!config.enabled) return;

    if (isDemoMode()) return;

    const client = getSupabaseClient();

    // Get all active (non-closed) tickets
    const { data: activeTickets } = await client
      .from('tickets')
      .select('id, ticket_number, title, status, priority, created_at, updated_at, conversation_id, assignee_id')
      .not('status', 'eq', 'closed')
      .not('status', 'eq', 'resolved');

    if (!activeTickets || activeTickets.length === 0) return;

    // Batch query recent alerts to avoid N+1 queries
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [responseAlerts, resolveAlerts] = await Promise.all([
      this.alertRepo.findRecentUnresolvedBatch(['ticket_sla_response_overdue'], windowStart),
      this.alertRepo.findRecentUnresolvedBatch(['ticket_sla_resolve_overdue'], windowStart),
    ]);
    const responseAlertSet = new Set(responseAlerts.map(a => `${a.conversation_id}-${a.type}`));
    const resolveAlertSet = new Set(resolveAlerts.map(a => `${a.conversation_id}-${a.type}`));

    for (const ticket of activeTickets) {
      const sla = this.calculateSLA(ticket as {
        status: string;
        priority: string;
        created_at: string;
        updated_at: string | null;
        assignee_id: string | null;
      }, config);

      const convId = ticket.conversation_id ?? ticket.id;

      // Response overdue → warning
      if (sla.response_overdue) {
        const alertKey = `${convId}-ticket_sla_response_overdue`;
        if (!responseAlertSet.has(alertKey)) {
          await this.alertRepo.create({
            conversation_id: convId,
            type: 'ticket_sla_response_overdue',
            severity: 'warning',
            message: `工单 ${ticket.ticket_number}「${ticket.title}」响应超时`,
            metadata: { ticket_id: ticket.id, ticket_number: ticket.ticket_number, sla_type: 'response' },
          });
        }
      }

      // Resolve overdue → critical
      if (sla.resolve_overdue) {
        const alertKey = `${convId}-ticket_sla_resolve_overdue`;
        if (!resolveAlertSet.has(alertKey)) {
          await this.alertRepo.create({
            conversation_id: convId,
            type: 'ticket_sla_resolve_overdue',
            severity: 'critical',
            message: `工单 ${ticket.ticket_number}「${ticket.title}」处理超时`,
            metadata: { ticket_id: ticket.id, ticket_number: ticket.ticket_number, sla_type: 'resolve' },
          });
        }

        // Auto-escalate priority for overdue tickets
        await this.escalateOverdueTicket(ticket.id, ticket.priority);
      }
    }
  }

  /**
   * Escalate overdue ticket priority: low → medium → high → urgent
   */
  private async escalateOverdueTicket(ticketId: string, currentPriority: string): Promise<void> {
    const escalationMap: Record<string, string> = {
      low: 'medium',
      medium: 'high',
      high: 'urgent',
    };
    const newPriority = escalationMap[currentPriority];
    if (!newPriority) return;

    try {
      const client = getSupabaseClient();
      await client
        .from('tickets')
        .update({ priority: newPriority, updated_at: new Date().toISOString() })
        .eq('id', ticketId);
    } catch {
      // fire-and-forget
    }
  }

  // ──────────────────────────────────────────────
  // Batch operations (Phase 4)
  // ──────────────────────────────────────────────

  /**
   * Batch update multiple tickets.
   * Supports: status change, assignee change, priority change, category change.
   */
  async batchUpdate(ids: string[], updates: {
    status?: string;
    assignee_id?: string | null;
    priority?: string;
    category?: string;
  }): Promise<{ updated_count: number }> {
    if (!ids || ids.length === 0) {
      throw new ServiceError('请选择至少一个工单', { status: 400, code: 'VALIDATION_ERROR' });
    }

    if (ids.length > TICKET.BATCH_MAX_SIZE) {
      throw new ServiceError(`单次批量操作不超过${TICKET.BATCH_MAX_SIZE}个工单`, { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      // If status change to closed, validate all tickets can be closed
      if (updates.status === 'closed') {
        const client = getSupabaseClient();
        const { data: tickets } = await client
          .from('tickets')
          .select('id, status, ticket_number')
          .in('id', ids);

        // Only tickets already in 'closed' status cannot transition to 'closed' again.
        // According to VALID_TRANSITIONS: open/in_progress/pending_customer/resolved → closed are all allowed.
        const nonClosable = (tickets as Array<{ id: string; status: string; ticket_number: string }> ?? [])
          .filter(t => t.status === 'closed');
        if (nonClosable.length > 0) {
          throw new ServiceError(
            `以下工单状态不允许关闭: ${nonClosable.map(t => t.ticket_number).join(', ')}`,
            { status: 400, code: 'VALIDATION_ERROR' }
          );
        }
      }

      const count = await this.tickets.batchUpdate(ids, updates);

      // Log status changes for each ticket if status was changed
      if (updates.status) {
        // Query current status for each ticket before batch update
        const currentTickets = await Promise.all(
          ids.map(id => this.tickets.findById(id))
        );
        const statusMap = new Map(
          currentTickets
            .filter(t => t !== null)
            .map(t => [(t as { id: string }).id, (t as { status: string }).status])
        );
        for (const id of ids) {
          await this.tickets.logStatusChange(
            id,
            statusMap.get(id) ?? null,
            updates.status,
            null
          ).catch((err) => {
            logger.error('[TicketService] Failed to log status change', { error: err?.message ?? String(err), ticketId: id });
          });
        }
      }

      // Notify assignees if batch assigned
      if (updates.assignee_id) {
        for (const id of ids) {
          this.notifyTicketAssigned(id, '', '', updates.assignee_id, null).catch((err) => {
            logger.error('[TicketService] Failed to notify assignee', { error: err?.message ?? String(err), ticketId: id, assigneeId: updates.assignee_id });
          });
        }
      }

      return { updated_count: count };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '批量更新失败', 'DB_UPDATE_ERROR');
    }
  }

  async listComments(ticketId: string): Promise<CommentWithAuthor[]> {
    if (!ticketId) {
      throw new ServiceError('缺少工单 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.tickets.listComments(ticketId);
    } catch (error) {
      throw toServiceError(error, '获取评论列表失败', 'DB_QUERY_ERROR');
    }
  }

  async addComment(input: CreateCommentInput): Promise<CommentWithAuthor> {
    const MAX_COMMENT_LENGTH = TICKET.MAX_COMMENT_LENGTH;
    if (!input.content || !input.content.trim()) {
      throw new ServiceError('评论内容不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    if (input.content.length > MAX_COMMENT_LENGTH) {
      throw new ServiceError(`评论不能超过${MAX_COMMENT_LENGTH}个字符`, {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const exists = await this.tickets.ticketExists(input.ticket_id);
      if (!exists) {
        throw new ServiceError('工单不存在', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      const result = await this.tickets.addComment(input);

      // Audit log for comment
      this.writeAuditLog(input.ticket_id, 'add_comment', input.author_id ?? null, null, { 
        before: null, 
        after: { comment_id: (result.comment as TicketCommentRow).id, content_preview: input.content.substring(0, 100), is_internal: input.is_internal } 
      });

      // Notify @mentioned users in comment
      await this.notifyCommentMentions(input.ticket_id, input.content, input.author_id ?? undefined);

      return result;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '添加评论失败', 'DB_INSERT_ERROR');
    }
  }

  // ──────────────────────────────────────────────
  // Notification helpers (fire-and-forget)
  // ──────────────────────────────────────────────

  private async isNotifyEnabled(): Promise<boolean> {
    try {
      const rows = await this.settingsRepo.list();
      const map = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});
      return map.ticket_notify_enabled !== 'false'; // default true
    } catch {
      return true;
    }
  }

  /**
   * Create an alert for ticket assignment.
   * Called after a ticket is assigned or re-assigned.
   */
  private async notifyTicketAssigned(
    ticketId: string,
    ticketNumber: string,
    ticketTitle: string,
    assigneeId: string,
    conversationId: string | null,
  ): Promise<void> {
    try {
      if (!(await this.isNotifyEnabled())) return;

      const alertInput: CreateAlertInput = {
        conversation_id: conversationId ?? ticketId, // use ticketId as fallback so alert is always created
        type: 'ticket_assigned',
        severity: 'info',
        message: `工单 ${ticketNumber}「${ticketTitle}」已指派给您`,
        metadata: { ticket_id: ticketId, ticket_number: ticketNumber, assignee_id: assigneeId },
      };
      await this.alertRepo.create(alertInput);
    } catch {
      // fire-and-forget: do not block ticket operations
    }
  }

  /**
   * Create an alert for ticket status change.
   * Notifies both creator and assignee (if different from operator).
   */
  private async notifyTicketStatusChanged(
    ticketId: string,
    ticketNumber: string,
    ticketTitle: string,
    fromStatus: string | null,
    toStatus: string,
    operatorId: string | null,
    creatorId: string | null,
    assigneeId: string | null,
    conversationId: string | null,
  ): Promise<void> {
    try {
      if (!(await this.isNotifyEnabled())) return;

      const fromLabel = fromStatus ? TICKET_STATUS_LABELS[fromStatus as TicketStatusType] : '创建';
      const toLabel = TICKET_STATUS_LABELS[toStatus as TicketStatusType] ?? toStatus;

      const alertInput: CreateAlertInput = {
        conversation_id: conversationId ?? ticketId,
        type: 'ticket_status_changed',
        severity: toStatus === 'resolved' || toStatus === 'closed' ? 'info' : 'warning',
        message: `工单 ${ticketNumber}「${ticketTitle}」状态变更：${fromLabel} → ${toLabel}`,
        metadata: {
          ticket_id: ticketId,
          ticket_number: ticketNumber,
          from_status: fromStatus,
          to_status: toStatus,
          operator_id: operatorId,
          creator_id: creatorId,
          assignee_id: assigneeId,
        },
      };
      await this.alertRepo.create(alertInput);
    } catch {
      // fire-and-forget
    }
  }

  /**
   * Create alerts for @mentioned users in a comment.
   * Parses @name patterns from the comment content.
   */
  private async notifyCommentMentions(
    ticketId: string,
    content: string,
    authorId?: string,
  ): Promise<void> {
    try {
      if (!(await this.isNotifyEnabled())) return;

      // Parse @mentions: matches @name patterns (Chinese/English names, supports · separator)
      const mentionRegex = /@([\u4e00-\u9fa5a-zA-Z][\u4e00-\u9fa5a-zA-Z0-9_·]{0,19})/g;
      const mentions: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1]);
      }

      if (mentions.length === 0) return;

      // Get ticket info for context
      const ticketDetail = await this.tickets.findById(ticketId);
      const ticket = ticketDetail as { ticket_number?: string; title?: string; conversation_id?: string | null } | null;
      const ticketNumber = ticket?.ticket_number ?? ticketId;
      const ticketTitle = ticket?.title ?? '';
      const conversationId = ticket?.conversation_id ?? null;

      for (const mentionName of mentions) {
        const alertInput: CreateAlertInput = {
          conversation_id: conversationId ?? ticketId,
          type: 'ticket_mention',
          severity: 'info',
          message: `工单 ${ticketNumber}「${ticketTitle}」中 @${mentionName} 提及了您`,
          metadata: {
            ticket_id: ticketId,
            ticket_number: ticketNumber,
            mentioned_name: mentionName,
            author_id: authorId ?? null,
          },
        };
        await this.alertRepo.create(alertInput);
      }
    } catch {
      // fire-and-forget
    }
  }

  /**
   * Create an alert for unassigned ticket that has been open too long.
   */
  async checkUnassignedTickets(): Promise<void> {
    try {
      if (!(await this.isNotifyEnabled())) return;

      // Get unassigned timeout from settings, default to 15 minutes
      const timeoutMinutes = await parseInt(await this.settingsRepo.get('ticket_unassigned_timeout_minutes') || '15', 10) ?? 15;
      const timeoutMs = timeoutMinutes * 60 * 1000;
      const unassignedTickets = await this.tickets.findUnassignedOlderThan(timeoutMs);
      if (!unassignedTickets || unassignedTickets.length === 0) return;

      for (const ticket of unassignedTickets) {
        const t = ticket as { id: string; ticket_number: string; title: string; conversation_id?: string | null };

        // Check if we already notified for this ticket (1 hour dedup window)
        const existing = await this.alertRepo.findRecentUnresolved(
          t.conversation_id ?? t.id,
          'ticket_unassigned',
          new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        );
        if (existing) continue;

        const alertInput: CreateAlertInput = {
          conversation_id: t.conversation_id ?? t.id,
          type: 'ticket_unassigned',
          severity: 'warning',
          message: `工单 ${t.ticket_number}「${t.title}」已创建超过15分钟仍未指派`,
          metadata: { ticket_id: t.id, ticket_number: t.ticket_number },
        };
        await this.alertRepo.create(alertInput);
      }
    } catch {
      // fire-and-forget
    }
  }

  // ============ Custom Fields & Categories ============

  async getCategories(): Promise<TicketCategoryRecord[]> {
    return getCategories();
  }

  async getCustomFields(): Promise<TicketCustomFieldRecord[]> {
    return getCustomFields();
  }

  async getTicketFieldValues(ticketId: string): Promise<TicketFieldValueRecord[]> {
    return getFieldValues(ticketId);
  }

  async updateCustomFieldValues(ticketId: string, values: { field_id: string; field_value: string }[]): Promise<void> {
    return upsertFieldValues(ticketId, values);
  }

  // ============ Ticket Relations & Sub-tickets ============

  async addTicketRelation(sourceTicketId: string, targetTicketId: string, relationType: TicketRelationType): Promise<TicketRelationRecord> {
    return addRelation(sourceTicketId, targetTicketId, relationType);
  }

  async removeTicketRelation(relationId: string): Promise<void> {
    return removeRelation(relationId);
  }

  async getTicketRelations(ticketId: string): Promise<TicketRelationRecord[]> {
    return getRelations(ticketId);
  }

  async createSubTicket(parentTicketId: string, input: CreateTicketInput): Promise<unknown> {
    const ticket = await this.createTicket(input);
    const t = ticket as { id: string };
    await setParentTicket(t.id, parentTicketId);
    return ticket;
  }

  async getSubTickets(parentTicketId: string): Promise<ChildTicketSummary[]> {
    return getChildTickets(parentTicketId);
  }

  async getSubTicketProgress(parentTicketId: string): Promise<{ total: number; closed: number; resolved: number; in_progress: number }> {
    return getChildTicketProgress(parentTicketId);
  }

  // ============ Customer Ticket Notification ============

  /**
   * Write audit log entry for ticket operations
   */
  private async writeAuditLog(ticketId: string, action: string, operatorId: string | null, operatorName: string | null, changes: Record<string, unknown> | null): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      await supabase.from('ticket_audit_log').insert({
        ticket_id: ticketId,
        action,
        operator_id: operatorId,
        operator_name: operatorName,
        changes: changes ? JSON.stringify(changes) : null,
      });
    } catch (error) {
      // For delete operations, audit log failure should be surfaced
      if (action === 'delete') {
        logger.error('[TicketService] writeAuditLog failed for delete', { ticketId, error: error instanceof Error ? error.message : String(error) });
      } else {
        logger.error('[TicketService] writeAuditLog failed', { ticketId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * Get audit log for a ticket
   */
  async getAuditLog(ticketId: string): Promise<Array<{ id: string; action: string; operator_id: string | null; operator_name: string | null; changes: Record<string, unknown> | null; created_at: string }>> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('ticket_audit_log')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });

      if (error) {
        // PostgREST schema cache miss - table not yet in cache
        if (error.code === 'PGRST205') return [];
        throw error;
      }
      return (data || []).map(d => ({
        ...d,
        changes: typeof d.changes === 'string' ? JSON.parse(d.changes) : d.changes,
      }));
    } catch (error) {
      logger.error('[TicketService] getAuditLog failed', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * 检查父工单是否所有子工单都已关闭，如果是则产生告警提示
   */
  private async checkParentTicketClosure(parentTicketId: string, operatorId: string | null): Promise<void> {
    try {
      const subTickets = await this.getSubTickets(parentTicketId);

      if (!subTickets || subTickets.length === 0) return;

      // Check if all sub-tickets are resolved or closed
      const allClosed = subTickets.every(t => t.status === 'resolved' || t.status === 'closed');

      if (allClosed) {
        // Get parent ticket info
        const parentTicket = await this.tickets.findById(parentTicketId) as TicketRow | null;
        if (!parentTicket || parentTicket.status === 'resolved' || parentTicket.status === 'closed') return;

        // Create alert to suggest closing parent ticket
        const message = `工单 ${parentTicket.ticket_number} 的所有子工单已关闭，建议关闭该工单`;
        await this.alertRepo.create({
          type: 'ticket_subtickets_closed',
          severity: 'info',
          message,
          conversation_id: parentTicket?.conversation_id ?? null,
          metadata: {
            ticket_id: parentTicketId,
            ticket_number: parentTicket.ticket_number,
            subticket_count: subTickets.length,
          },
        });
        // Audit log for parent closure suggestion
        this.writeAuditLog(parentTicketId, 'subtickets_all_closed', operatorId, null, { 
          before: null, 
          after: { subticket_count: subTickets.length, alert_created: true } 
        });
      }
    } catch (error) {
      logger.error('[TicketService] checkParentTicketClosure failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const TICKET_STATUS_LABELS: Record<TicketStatusType, string> = {
  open: '待处理',
  in_progress: '处理中',
  pending_customer: '待客户回复',
  resolved: '已解决',
  closed: '已关闭',
};
