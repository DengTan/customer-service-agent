import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface RoutingRuleRow {
  id: string;
  name: string;
  condition_type: string;
  condition_config: unknown;
  target_bot_id: string;
  priority: number;
  is_enabled: boolean;
  created_at: string;
  updated_at?: string;
  bot_configs?: { id: string; name: string } | null;
}

export interface CreateRoutingRuleInput {
  name: string;
  condition_type?: string;
  condition_config?: unknown;
  target_bot_id: string;
  priority?: number;
  is_enabled?: boolean;
}

export interface UpdateRoutingRuleInput {
  id: string;
  name?: string;
  condition_type?: string;
  condition_config?: unknown;
  target_bot_id?: string;
  priority?: number;
  is_enabled?: boolean;
}

export class RoutingRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(): Promise<RoutingRuleRow[]> {
    if (isDemoMode()) {
      return [
        { id: 'demo-rr-1', name: '退款关键词路由', condition_type: 'keyword', condition_config: { keywords: ['退款', '退货', '换货'] }, target_bot_id: 'demo-bot-2', priority: 10, is_enabled: true, created_at: '2026-01-01T00:00:00Z', bot_configs: { id: 'demo-bot-2', name: '售后专用Bot' } },
        { id: 'demo-rr-2', name: '默认路由', condition_type: 'default', condition_config: {}, target_bot_id: 'demo-bot-1', priority: 0, is_enabled: true, created_at: '2026-01-01T00:00:00Z', bot_configs: { id: 'demo-bot-1', name: '通用客服Bot' } },
      ];
    }
    const { data, error } = await this.client
      .from('routing_rules')
      .select('*, bot_configs(id, name)')
      .order('priority', { ascending: false });

    if (error) throw new RepositoryError('list routing rules', error.message, error.code);
    return data as RoutingRuleRow[];
  }

  async findById(id: string): Promise<RoutingRuleRow | null> {
    if (isDemoMode()) {
      const rules = await this.list();
      return rules.find(r => r.id === id) ?? null;
    }
    const { data, error } = await this.client
      .from('routing_rules')
      .select('*, bot_configs(id, name)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError('find routing rule', error.message, error.code);
    return data as RoutingRuleRow | null;
  }

  async create(input: CreateRoutingRuleInput): Promise<RoutingRuleRow> {
    if (isDemoMode()) return { id: 'demo-rr-new', name: input.name, condition_type: input.condition_type ?? 'keyword', condition_config: input.condition_config ?? {}, target_bot_id: input.target_bot_id, priority: input.priority ?? 0, is_enabled: input.is_enabled !== false, created_at: new Date().toISOString(), bot_configs: null };
    const { data, error } = await this.client
      .from('routing_rules')
      .insert({
        name: input.name,
        condition_type: input.condition_type ?? 'keyword',
        condition_config: input.condition_config ?? {},
        target_bot_id: input.target_bot_id,
        priority: input.priority ?? 0,
        is_enabled: input.is_enabled !== false,
      })
      .select('*, bot_configs(id, name)')
      .single();

    if (error) throw new RepositoryError('create routing rule', error.message, error.code);
    return data as RoutingRuleRow;
  }

  async update(input: UpdateRoutingRuleInput): Promise<RoutingRuleRow> {
    if (isDemoMode()) return { id: input.id, name: input.name ?? '路由规则', condition_type: input.condition_type ?? 'keyword', condition_config: input.condition_config ?? {}, target_bot_id: input.target_bot_id ?? 'demo-bot-1', priority: input.priority ?? 0, is_enabled: input.is_enabled ?? true, created_at: '2026-01-01T00:00:00Z', bot_configs: null };
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.condition_type !== undefined) updateData.condition_type = input.condition_type;
    if (input.condition_config !== undefined) updateData.condition_config = input.condition_config;
    if (input.target_bot_id !== undefined) updateData.target_bot_id = input.target_bot_id;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.is_enabled !== undefined) updateData.is_enabled = input.is_enabled;

    const { data, error } = await this.client
      .from('routing_rules')
      .update(updateData)
      .eq('id', input.id)
      .select('*, bot_configs(id, name)')
      .single();

    if (error) throw new RepositoryError('update routing rule', error.message, error.code);
    return data as RoutingRuleRow;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('routing_rules').delete().eq('id', id);
    if (error) throw new RepositoryError('delete routing rule', error.message, error.code);
  }
}
