import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface HandoffConversationContext {
  summary: string | null;
  source: string | null;
  external_user_id: string | null;
  title: string | null;
}

export interface AgentQueueInput {
  conversation_id: string;
  customer_name: string;
  priority: string;
  skill_group_id: string | null;
  status: string;
  reason: string;
  summary: string | null;
  source_platform: string | null;
}

export class AgentQueueRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async findHandoffConversationContext(conversationId: string): Promise<HandoffConversationContext | null> {
    if (isDemoMode()) return { summary: '客户咨询退货问题，AI置信度低需转人工', source: 'web', external_user_id: null, title: '退货咨询' };
    const { data, error } = await this.client
      .from('conversations')
      .select('summary, source, external_user_id, title')
      .eq('id', conversationId)
      .maybeSingle();

    if (error) throw new RepositoryError('find handoff conversation context', error.message, error.code);
    return data as HandoffConversationContext | null;
  }

  async findDefaultSkillGroupId(): Promise<string | null> {
    if (isDemoMode()) return 'demo-sg-1';
    const { data, error } = await this.client
      .from('skill_groups')
      .select('id')
      .eq('is_default', true)
      .maybeSingle();

    if (error) throw new RepositoryError('find default skill group', error.message, error.code);
    return ((data as { id?: string } | null)?.id) ?? null;
  }

  async findCustomerNameForConversation(conversationId: string): Promise<string | null> {
    if (isDemoMode()) return '演示客户';
    // Two-step query to avoid FK requirement for Supabase join syntax
    const { data: linkData, error: linkError } = await this.client
      .from('customer_conversations')
      .select('customer_id')
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (linkError) throw new RepositoryError('find conversation customer link', linkError.message, linkError.code);
    if (!linkData?.customer_id) return null;

    const { data: customerData, error: customerError } = await this.client
      .from('customers')
      .select('name')
      .eq('id', linkData.customer_id)
      .maybeSingle();

    if (customerError) throw new RepositoryError('find customer name', customerError.message, customerError.code);
    return (customerData as { name?: string } | null)?.name ?? null;
  }

  async findShopIdForConversation(conversationId: string): Promise<string | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('conversations')
      .select('platform_connection_id')
      .eq('id', conversationId)
      .maybeSingle();

    if (error) throw new RepositoryError('find shop id for conversation', error.message, error.code);
    return (data as { platform_connection_id?: string } | null)?.platform_connection_id ?? null;
  }

  async enqueue(input: AgentQueueInput): Promise<string> {
    if (isDemoMode()) return 'demo-queue-new';
    const { data, error } = await this.client.from('agent_queue').insert(input).select('id').single();
    if (error) throw new RepositoryError('enqueue handoff conversation', error.message, error.code);
    return (data as { id: string }).id;
  }

  /**
   * Bulk-resolve every non-terminal agent_queue row for a conversation. Used by
   * `ConversationService.updateConversation` when the conversation enters the
   * `ended` state so the agent workspace does not keep showing phantom rows.
   *
   * Returns the number of rows whose status changed; rows already in the
   * `resolved` state are left untouched (idempotent). The implementation
   * walks all rows for the conversation and applies a single UPDATE so the
   * N+1 anti-pattern is avoided.
   */
  async resolveByConversationId(
    conversationId: string,
    reason: AgentQueueResolutionReason,
  ): Promise<number> {
    if (isDemoMode()) return 0;
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('agent_queue')
      .update({
        status: 'resolved',
        resolved_at: nowIso,
        resolution_reason: reason,
        reopened_at: null,
      })
      .eq('conversation_id', conversationId)
      .neq('status', 'resolved')
      .select('id');

    if (error) throw new RepositoryError('resolve queue by conversation', error.message, error.code);
    return Array.isArray(data) ? data.length : 0;
  }

  /**
   * Re-open agent_queue rows that were previously resolved via
   * `resolveByConversationId` (P0-1 US-1-3). Stamps `reopened_at` so the
   * audit trail shows when the customer returned to the queue. The status
   * itself is reset to the prior non-terminal value when one is recoverable
   * (assigned 鈫?'assigned'; otherwise 'queued').
   */
  async reopenByConversationId(conversationId: string): Promise<number> {
    if (isDemoMode()) return 0;
    const nowIso = new Date().toISOString();
    const { data: rows, error: fetchError } = await this.client
      .from('agent_queue')
      .select('id, status, assigned_agent_id')
      .eq('conversation_id', conversationId)
      .eq('status', 'resolved');

    if (fetchError) throw new RepositoryError('fetch resolved queue by conversation', fetchError.message, fetchError.code);
    const items = (rows ?? []) as Array<{ id: string; status: string; assigned_agent_id: string | null }>;
    if (items.length === 0) return 0;

    // Perf: bucket rows by next status and issue one UPDATE per bucket
    // (.in('id', ids)) instead of one UPDATE per row. This converts a N+1
    // pattern into 1-2 round-trips regardless of how many queue rows the
    // conversation has accumulated.
    const assignedIds = items.filter((r) => r.assigned_agent_id).map((r) => r.id);
    const queuedIds = items.filter((r) => !r.assigned_agent_id).map((r) => r.id);
    let affected = 0;

    const runBatch = async (ids: string[], nextStatus: string) => {
      if (ids.length === 0) return;
      const { error: updateError, count } = await this.client
        .from('agent_queue')
        .update({
          status: nextStatus,
          resolved_at: null,
          reopened_at: nowIso,
        })
        .in('id', ids);
      if (updateError) {
        throw new RepositoryError('reopen queue items batch', updateError.message, updateError.code);
      }
      affected += typeof count === 'number' ? count : ids.length;
    };

    await runBatch(assignedIds, 'assigned');
    await runBatch(queuedIds, 'queued');

    return affected;
  }
}

/** Reason values used by the M-1 agent_queue 鈫?conversation state coupling. */
export type AgentQueueResolutionReason =
  | 'conversation_ended'
  | 'transferred'
  | 'cancelled'
  | 'conversation_reopened';

export interface ResolveByConversationIdResult {
  conversationId: string;
  reason: AgentQueueResolutionReason;
  affected: number;
}
