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
}
