import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_QUEUE } from './demo-data/demo-queue';
export interface AgentQueueFilters {
  status?: string | null;
  agent_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface AgentQueueRow {
  id: string;
  conversation_id: string;
  customer_name: string | null;
  customer_avatar: string | null;
  priority: string;
  skill_group_id: string | null;
  status: string;
  reason: string;
  summary: string | null;
  source_platform: string | null;
  assigned_agent_id: string | null;
  assigned_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AgentQueueItem extends AgentQueueRow {
  agent?: { name: string } | null;
  agent_name?: string | null;
}

export interface AgentSessionRow {
  id: string;
  user_id: string;
  status: string;
  current_conversation_id: string | null;
  last_active_at: string;
  updated_at: string;
}

export class AgentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async listQueue(filters: AgentQueueFilters): Promise<{ items: AgentQueueItem[]; total: number }> {
    if (isDemoMode()) {
      let filtered = DEMO_QUEUE;
      if (filters.status) filtered = filtered.filter(q => q.status === filters.status);
      const total = filtered.length;
      const { offset = 0, limit } = filters;
      const sliced = limit ? filtered.slice(offset, offset + limit) : filtered.slice(offset);
      return { items: sliced.map(item => ({ ...item, agent_name: null })) as AgentQueueItem[], total };
    }

    // Count total first
    let countQuery = this.client
      .from('agent_queue')
      .select('id', { count: 'exact', head: true });

    if (filters.status) countQuery = countQuery.eq('status', filters.status);
    if (filters.agent_id) countQuery = countQuery.eq('assigned_agent_id', filters.agent_id);

    const { count, error: countError } = await countQuery;
    if (countError) throw new RepositoryError('count queue', countError.message, countError.code);

    // Fetch queue items (no nested joins — PostgREST can't traverse multi-level relationships)
    let query = this.client
      .from('agent_queue')
      .select('*')
      .order('created_at', { ascending: true });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.agent_id) query = query.eq('assigned_agent_id', filters.agent_id);
    if (filters.offset !== undefined && filters.limit !== undefined) {
      query = query.range(filters.offset, filters.offset + filters.limit - 1);
    }

    const { data, error } = await query;

    if (error) throw new RepositoryError('list queue', error.message, error.code);

    interface QueueRow {
      id: string;
      conversation_id: string;
      customer_name: string | null;
      priority: string;
      skill_group_id: string | null;
      status: string;
      reason: string;
      summary: string | null;
      source_platform: string | null;
      assigned_agent_id: string | null;
      assigned_at: string | null;
      resolved_at: string | null;
      created_at: string;
    }

    const queueRows = (data as QueueRow[] | null) ?? [];

    // Fetch customer info via conversation_ids -> customer_conversations -> customers (2-level join only)
    const conversationIds = [...new Set(queueRows.map(r => r.conversation_id).filter(Boolean))];
    const customerMap = new Map<string, { name: string | null; avatar: string | null }>();

    if (conversationIds.length > 0) {
      const { data: ccData } = await this.client
        .from('customer_conversations')
        .select(`
          conversation_id,
          customers (
            id,
            name,
            avatar
          )
        `)
        .in('conversation_id', conversationIds);

      for (const cc of ccData ?? []) {
        const raw = cc as unknown as { conversation_id: string; customers: { id: string; name: string | null; avatar: string | null } | null };
        const cust = Array.isArray(raw.customers) ? raw.customers[0] : raw.customers;
        if (cust) {
          customerMap.set(raw.conversation_id, { name: cust.name, avatar: cust.avatar });
        }
      }
    }

    const items = queueRows.map((row) => {
      const customer = customerMap.get(row.conversation_id);
      return {
        id: row.id,
        conversation_id: row.conversation_id,
        customer_name: customer?.name ?? row.customer_name,
        customer_avatar: customer?.avatar ?? null,
        priority: row.priority,
        skill_group_id: row.skill_group_id,
        status: row.status,
        reason: row.reason,
        summary: row.summary,
        source_platform: row.source_platform,
        assigned_agent_id: row.assigned_agent_id,
        assigned_at: row.assigned_at,
        resolved_at: row.resolved_at,
        created_at: row.created_at,
      };
    });

    // Fetch agent names separately
    const agentIds = [...new Set(items.map((i) => i.assigned_agent_id).filter(Boolean))] as string[];

    const mappedItems = agentIds.length > 0
      ? await (async () => {
          const { data: agentsData } = await this.client
            .from('users')
            .select('id, name')
            .in('id', agentIds);
          const agentMap = new Map((agentsData ?? []).map(a => [a.id, a.name]));
          return items.map((item) => ({
            ...item,
            agent_name: item.assigned_agent_id ? agentMap.get(item.assigned_agent_id) ?? null : null,
          })) as AgentQueueItem[];
        })()
      : items.map((item) => ({ ...item, agent_name: null })) as AgentQueueItem[];

    return { items: mappedItems, total: count ?? 0 };
  }

  async findQueueItem(id: string, requireStatus?: string): Promise<AgentQueueRow | null> {
    if (isDemoMode()) return null;
    let query = this.client.from('agent_queue').select('*').eq('id', id);
    if (requireStatus) {
      query = query.eq('status', requireStatus);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw new RepositoryError('find queue item', error.message, error.code);
    return data as AgentQueueRow | null;
  }

  async assignQueueItem(id: string, agentId: string): Promise<AgentQueueRow> {
    if (isDemoMode()) return { id, conversation_id: 'demo-conv-1', customer_name: '演示客户', customer_avatar: null, priority: 'normal', skill_group_id: null, status: 'assigned', reason: '', summary: null, source_platform: null, assigned_agent_id: agentId, assigned_at: new Date().toISOString(), resolved_at: null, created_at: new Date().toISOString() };
    const { data, error } = await this.client
      .from('agent_queue')
      .update({
        status: 'assigned',
        assigned_agent_id: agentId,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('assign queue item', error.message, error.code);
    return data as AgentQueueRow;
  }

  async resolveQueueItem(id: string): Promise<AgentQueueRow> {
    if (isDemoMode()) return { id, conversation_id: 'demo-conv-1', customer_name: '演示客户', customer_avatar: null, priority: 'normal', skill_group_id: null, status: 'resolved', reason: '', summary: null, source_platform: null, assigned_agent_id: null, assigned_at: null, resolved_at: new Date().toISOString(), created_at: new Date().toISOString() };
    const { data, error } = await this.client
      .from('agent_queue')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('resolve queue item', error.message, error.code);
    return data as AgentQueueRow;
  }

  async transferQueueItem(id: string, targetAgentId: string): Promise<AgentQueueRow> {
    if (isDemoMode()) return { id, conversation_id: 'demo-conv-1', customer_name: '演示客户', customer_avatar: null, priority: 'normal', skill_group_id: null, status: 'assigned', reason: '', summary: null, source_platform: null, assigned_agent_id: targetAgentId, assigned_at: new Date().toISOString(), resolved_at: null, created_at: new Date().toISOString() };
    const { data, error } = await this.client
      .from('agent_queue')
      .update({
        assigned_agent_id: targetAgentId,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('transfer queue item', error.message, error.code);
    return data as AgentQueueRow;
  }

  async upsertSession(
    userId: string,
    status: string,
    currentConversationId?: string | null,
  ): Promise<AgentSessionRow> {
    if (isDemoMode()) return { id: 'demo-session-1', user_id: userId, status, current_conversation_id: currentConversationId ?? null, last_active_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data: existing } = await this.client
      .from('agent_sessions')
      .select('id')
      .eq('user_id', userId)
      .single();

    let result: AgentSessionRow;
    if (existing) {
      const { data, error } = await this.client
        .from('agent_sessions')
        .update({
          status,
          last_active_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(currentConversationId !== undefined ? { current_conversation_id: currentConversationId } : {}),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw new RepositoryError('update agent session', error.message, error.code);
      result = data as AgentSessionRow;
    } else {
      const { data, error } = await this.client
        .from('agent_sessions')
        .insert({
          user_id: userId,
          status,
          last_active_at: new Date().toISOString(),
          ...(currentConversationId !== undefined ? { current_conversation_id: currentConversationId } : {}),
        })
        .select()
        .single();

      if (error) throw new RepositoryError('create agent session', error.message, error.code);
      result = data as AgentSessionRow;
    }
    return result;
  }

  async clearAgentCurrentConversation(agentId: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('agent_sessions')
      .update({
        current_conversation_id: null,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', agentId);

    if (error) throw new RepositoryError('clear agent current conversation', error.message, error.code);
  }

  async updateConversationAssignedAgent(conversationId: string, agentId: string | null): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('conversations')
      .update({
        assigned_agent: agentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (error) throw new RepositoryError('update conversation assigned agent', error.message, error.code);
  }

  async updateConversationStatus(conversationId: string, status: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('conversations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    if (error) throw new RepositoryError('update conversation status', error.message, error.code);
  }

  async countResolvedToday(agentId?: string): Promise<{ count: number; items: AgentQueueRow[] }> {
    if (isDemoMode()) return { count: 5, items: [] };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    let query = this.client
      .from('agent_queue')
      .select('id, created_at, assigned_at, resolved_at', { count: 'exact' })
      .eq('status', 'resolved')
      .gte('resolved_at', todayISO);

    if (agentId) query = query.eq('assigned_agent_id', agentId);

    const { count, data, error } = await query;
    if (error) throw new RepositoryError('count resolved today', error.message, error.code);
    return { count: count ?? 0, items: (data ?? []) as AgentQueueRow[] };
  }

  async countByStatus(status: string): Promise<number> {
    if (isDemoMode()) return status === 'waiting' ? 2 : status === 'assigned' ? 1 : 0;
    const { count, error } = await this.client
      .from('agent_queue')
      .select('id', { count: 'exact' })
      .eq('status', status);

    if (error) throw new RepositoryError('count queue by status', error.message, error.code);
    return count ?? 0;
  }

  async listRatedConversationsUpdatedSince(sinceIso: string): Promise<{ rating: number | null }[]> {
    if (isDemoMode()) return [{ rating: 4 }, { rating: 5 }, { rating: 3 }, { rating: 5 }, { rating: 4 }];
    const { data, error } = await this.client
      .from('conversations')
      .select('rating')
      .not('rating', 'is', null)
      .gte('updated_at', sinceIso);

    if (error) throw new RepositoryError('list rated conversations', error.message, error.code);
    return (data ?? []) as { rating: number | null }[];
  }

  /**
   * Find the best available agent for a queue item, considering schedule and skill group.
   * Priority: online agents in same skill group with today's schedule > online agents with today's schedule > online agents
   */
  async findBestAvailableAgent(skillGroupId: string | null): Promise<string | null> {
    if (isDemoMode()) return null;
    const today = new Date().toISOString().split('T')[0];

    // Get online agents with no current conversation
    const { data: onlineAgents, error: agentsError } = await this.client
      .from('agent_sessions')
      .select('user_id')
      .eq('status', 'online')
      .is('current_conversation_id', null);

    if (agentsError || !onlineAgents || onlineAgents.length === 0) return null;

    const agentIds = (onlineAgents as Array<{ user_id: string }>).map(a => a.user_id);
    if (agentIds.length === 0) return null;

    // Get agents on schedule today
    const { data: scheduledAgents } = await this.client
      .from('schedules')
      .select('user_id, skill_group_id')
      .eq('date', today)
      .in('user_id', agentIds);

    const scheduledMap = new Map<string, string | null>();
    for (const s of (scheduledAgents ?? []) as Array<{ user_id: string; skill_group_id: string | null }>) {
      scheduledMap.set(s.user_id, s.skill_group_id);
    }

    // Priority 1: Scheduled agent in same skill group
    if (skillGroupId) {
      for (const [agentId, sgId] of scheduledMap) {
        if (sgId === skillGroupId) return agentId;
      }
    }

    // Priority 2: Any scheduled agent
    for (const agentId of scheduledMap.keys()) {
      return agentId;
    }

    // Priority 3: Any online agent (prefer skill group members)
    if (skillGroupId) {
      const { data: groupMembers } = await this.client
        .from('skill_groups')
        .select('member_ids')
        .eq('id', skillGroupId)
        .maybeSingle();

      const memberIds = (groupMembers as Record<string, unknown>)?.member_ids as string[] | undefined;
      if (memberIds) {
        const match = agentIds.find(id => memberIds.includes(id));
        if (match) return match;
      }
    }

    // Fallback: first available online agent
    return agentIds[0];
  }
}
