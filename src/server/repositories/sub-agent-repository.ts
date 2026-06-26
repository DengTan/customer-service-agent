import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

// ====== Agent Delegations ======

export interface AgentDelegationRow {
  id: string;
  conversation_id: string;
  parent_bot_id: string;
  child_bot_id: string;
  trigger_intent: string | null;
  input_message: string | null;
  result_content: string | null;
  confidence: number | null;
  status: string; // pending, processing, completed, failed
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

export interface CreateDelegationInput {
  conversation_id: string;
  parent_bot_id: string;
  child_bot_id: string;
  trigger_intent?: string | null;
  input_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ====== Agent Collaborations ======

export interface AgentCollaborationRow {
  id: string;
  conversation_id: string;
  delegation_id: string | null;
  sender_bot_id: string;
  receiver_bot_id: string;
  message_type: string; // request, response, notify
  content: string;
  context: Record<string, unknown> | null;
  status: string; // sent, delivered, processed, failed
  created_at: string;
}

export interface CreateCollaborationInput {
  conversation_id: string;
  delegation_id?: string | null;
  sender_bot_id: string;
  receiver_bot_id: string;
  message_type: string;
  content: string;
  context?: Record<string, unknown> | null;
}

// Demo delegation data
const DEMO_DELEGATIONS: AgentDelegationRow[] = [
  {
    id: 'demo-del-1',
    conversation_id: 'demo-conv-1',
    parent_bot_id: 'demo-bot-1',
    child_bot_id: 'demo-sub-1',
    trigger_intent: 'order_query',
    input_message: '我的订单到哪了？',
    result_content: '您的订单 ORD-20260610 已发货，预计6月12日送达。当前物流：北京分拣中心 → 上海转运中。',
    confidence: 0.92,
    status: 'completed',
    error_message: null,
    metadata: { tool_used: 'order_query' },
    created_at: '2026-06-10T10:00:00Z',
    completed_at: '2026-06-10T10:00:05Z',
  },
  {
    id: 'demo-del-2',
    conversation_id: 'demo-conv-2',
    parent_bot_id: 'demo-bot-1',
    child_bot_id: 'demo-sub-2',
    trigger_intent: 'refund_request',
    input_message: '我要退款，商品和描述不符',
    result_content: '已为您提交退款申请，退款金额 ¥299.00 将在3-5个工作日内原路返回。退款单号：RF-20260610-001。',
    confidence: 0.88,
    status: 'completed',
    error_message: null,
    metadata: { tool_used: 'refund_action', refund_amount: 299 },
    created_at: '2026-06-10T11:00:00Z',
    completed_at: '2026-06-10T11:00:08Z',
  },
];

const DEMO_COLLABORATIONS: AgentCollaborationRow[] = [
  {
    id: 'demo-collab-1',
    conversation_id: 'demo-conv-2',
    delegation_id: 'demo-del-2',
    sender_bot_id: 'demo-sub-2',
    receiver_bot_id: 'demo-sub-1',
    message_type: 'request',
    content: '客户申请退款，请确认订单 ORD-20260610 的当前状态是否支持退款操作',
    context: { order_id: 'ORD-20260610', refund_amount: 299 },
    status: 'processed',
    created_at: '2026-06-10T11:00:02Z',
  },
  {
    id: 'demo-collab-2',
    conversation_id: 'demo-conv-2',
    delegation_id: 'demo-del-2',
    sender_bot_id: 'demo-sub-1',
    receiver_bot_id: 'demo-sub-2',
    message_type: 'response',
    content: '订单 ORD-20260610 状态为"已签收"，支持退款操作，退款金额上限 ¥299.00',
    context: { order_id: 'ORD-20260610', order_status: 'delivered', max_refund: 299 },
    status: 'processed',
    created_at: '2026-06-10T11:00:04Z',
  },
];

export class SubAgentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // ====== Delegations ======

  async listDelegations(conversationId?: string): Promise<AgentDelegationRow[]> {
    if (isDemoMode()) {
      if (conversationId) {
        return DEMO_DELEGATIONS.filter(d => d.conversation_id === conversationId);
      }
      return DEMO_DELEGATIONS;
    }

    let query = this.client
      .from('agent_delegations')
      .select('*')
      .order('created_at', { ascending: false });

    if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    }

    const { data, error } = await query;
    if (error) throw new RepositoryError('list delegations', error.message, error.code);
    return (data ?? []) as AgentDelegationRow[];
  }

  async findDelegation(id: string): Promise<AgentDelegationRow | null> {
    if (isDemoMode()) {
      return DEMO_DELEGATIONS.find(d => d.id === id) ?? null;
    }
    const { data, error } = await this.client
      .from('agent_delegations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError('find delegation', error.message, error.code);
    return data as AgentDelegationRow | null;
  }

  async createDelegation(input: CreateDelegationInput): Promise<AgentDelegationRow> {
    if (isDemoMode()) {
      return {
        id: `demo-del-${Date.now()}`,
        conversation_id: input.conversation_id,
        parent_bot_id: input.parent_bot_id,
        child_bot_id: input.child_bot_id,
        trigger_intent: input.trigger_intent ?? null,
        input_message: input.input_message ?? null,
        result_content: null,
        confidence: null,
        status: 'pending',
        error_message: null,
        metadata: input.metadata ?? null,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
    }

    const { data, error } = await this.client
      .from('agent_delegations')
      .insert({
        conversation_id: input.conversation_id,
        parent_bot_id: input.parent_bot_id,
        child_bot_id: input.child_bot_id,
        trigger_intent: input.trigger_intent ?? null,
        input_message: input.input_message ?? null,
        status: 'pending',
        metadata: input.metadata ?? null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create delegation', error.message, error.code);
    return data as AgentDelegationRow;
  }

  async updateDelegationStatus(
    id: string,
    status: string,
    updates?: {
      result_content?: string;
      confidence?: number;
      error_message?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AgentDelegationRow> {
    if (isDemoMode()) {
      const existing = DEMO_DELEGATIONS.find(d => d.id === id);
      return {
        id,
        conversation_id: existing?.conversation_id ?? '',
        parent_bot_id: existing?.parent_bot_id ?? '',
        child_bot_id: existing?.child_bot_id ?? '',
        trigger_intent: existing?.trigger_intent ?? null,
        input_message: existing?.input_message ?? null,
        result_content: updates?.result_content ?? existing?.result_content ?? null,
        confidence: updates?.confidence ?? existing?.confidence ?? null,
        status,
        error_message: updates?.error_message ?? null,
        metadata: updates?.metadata ?? existing?.metadata ?? null,
        created_at: existing?.created_at ?? new Date().toISOString(),
        completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
      };
    }

    const updateData: Record<string, unknown> = { status };
    if (updates?.result_content !== undefined) updateData.result_content = updates.result_content;
    if (updates?.confidence !== undefined) updateData.confidence = updates.confidence;
    if (updates?.error_message !== undefined) updateData.error_message = updates.error_message;
    if (updates?.metadata !== undefined) updateData.metadata = updates.metadata;
    if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('agent_delegations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update delegation', error.message, error.code);
    return data as AgentDelegationRow;
  }

  // ====== Collaborations ======

  async listCollaborations(conversationId?: string, delegationId?: string): Promise<AgentCollaborationRow[]> {
    if (isDemoMode()) {
      let results = DEMO_COLLABORATIONS;
      if (conversationId) {
        results = results.filter(c => c.conversation_id === conversationId);
      }
      if (delegationId) {
        results = results.filter(c => c.delegation_id === delegationId);
      }
      return results;
    }

    let query = this.client
      .from('agent_collaborations')
      .select('*')
      .order('created_at', { ascending: true });

    if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    }
    if (delegationId) {
      query = query.eq('delegation_id', delegationId);
    }

    const { data, error } = await query;
    if (error) throw new RepositoryError('list collaborations', error.message, error.code);
    return (data ?? []) as AgentCollaborationRow[];
  }

  async createCollaboration(input: CreateCollaborationInput): Promise<AgentCollaborationRow> {
    if (isDemoMode()) {
      return {
        id: `demo-collab-${Date.now()}`,
        conversation_id: input.conversation_id,
        delegation_id: input.delegation_id ?? null,
        sender_bot_id: input.sender_bot_id,
        receiver_bot_id: input.receiver_bot_id,
        message_type: input.message_type,
        content: input.content,
        context: input.context ?? null,
        status: 'sent',
        created_at: new Date().toISOString(),
      };
    }

    const { data, error } = await this.client
      .from('agent_collaborations')
      .insert({
        conversation_id: input.conversation_id,
        delegation_id: input.delegation_id ?? null,
        sender_bot_id: input.sender_bot_id,
        receiver_bot_id: input.receiver_bot_id,
        message_type: input.message_type,
        content: input.content,
        context: input.context ?? null,
        status: 'sent',
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create collaboration', error.message, error.code);
    return data as AgentCollaborationRow;
  }

  async updateCollaborationStatus(id: string, status: string): Promise<AgentCollaborationRow> {
    if (isDemoMode()) {
      const existing = DEMO_COLLABORATIONS.find(c => c.id === id);
      return {
        id,
        conversation_id: existing?.conversation_id ?? '',
        delegation_id: existing?.delegation_id ?? null,
        sender_bot_id: existing?.sender_bot_id ?? '',
        receiver_bot_id: existing?.receiver_bot_id ?? '',
        message_type: existing?.message_type ?? 'request',
        content: existing?.content ?? '',
        context: existing?.context ?? null,
        status,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
    }

    const { data, error } = await this.client
      .from('agent_collaborations')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update collaboration status', error.message, error.code);
    return data as AgentCollaborationRow;
  }
}
