import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

// ============================================
// Types
// ============================================

export type AssignmentStrategy = 'round_robin' | 'load_balance' | 'designated_shop';

export interface AgentAssignmentConfigRow {
  id: string;
  strategy: AssignmentStrategy;
  name: string;
  is_enabled: boolean;
  condition_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

export interface ShopAgentBindingRow {
  id: string;
  shop_id: string;
  user_id: string;
  priority: number;
  is_enabled: boolean;
  created_at: string;
}

export interface CreateAssignmentConfigInput {
  strategy: AssignmentStrategy;
  name: string;
  is_enabled?: boolean;
  condition_config?: Record<string, unknown>;
}

export interface UpdateAssignmentConfigInput {
  id: string;
  strategy?: AssignmentStrategy;
  name?: string;
  is_enabled?: boolean;
  condition_config?: Record<string, unknown>;
}

export interface CreateShopBindingInput {
  shop_id: string;
  user_id: string;
  priority?: number;
  is_enabled?: boolean;
}

export interface ShopAgentBindingWithDetails extends ShopAgentBindingRow {
  shop_name?: string;
  user_name?: string;
  user_email?: string;
}

// ============================================
// Repository
// ============================================

export class AgentAssignmentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // ==========================================
  // Assignment Config CRUD
  // ==========================================

  async listConfigs(): Promise<AgentAssignmentConfigRow[]> {
    if (isDemoMode()) return [];

    const { data, error } = await this.client
      .from('agent_assignment_config')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new RepositoryError('list assignment configs', error.message, error.code);
    return (data ?? []) as AgentAssignmentConfigRow[];
  }

  async getActiveConfig(): Promise<AgentAssignmentConfigRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('agent_assignment_config')
      .select('*')
      .eq('is_enabled', true)
      .maybeSingle();

    if (error) throw new RepositoryError('get active config', error.message, error.code);
    return data as AgentAssignmentConfigRow | null;
  }

  async getConfigById(id: string): Promise<AgentAssignmentConfigRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('agent_assignment_config')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError('get config by id', error.message, error.code);
    return data as AgentAssignmentConfigRow | null;
  }

  async createConfig(input: CreateAssignmentConfigInput): Promise<AgentAssignmentConfigRow> {
    if (isDemoMode()) {
      return {
        id: `demo-config-${Date.now()}`,
        strategy: input.strategy,
        name: input.name,
        is_enabled: input.is_enabled ?? true,
        condition_config: input.condition_config ?? null,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
    }

    const { data, error } = await this.client
      .from('agent_assignment_config')
      .insert({
        strategy: input.strategy,
        name: input.name,
        is_enabled: input.is_enabled ?? true,
        condition_config: input.condition_config ?? null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create assignment config', error.message, error.code);
    return data as AgentAssignmentConfigRow;
  }

  async updateConfig(input: UpdateAssignmentConfigInput): Promise<AgentAssignmentConfigRow> {
    if (isDemoMode()) {
      return {
        id: input.id,
        strategy: input.strategy ?? 'round_robin',
        name: input.name ?? 'Demo Config',
        is_enabled: input.is_enabled ?? true,
        condition_config: input.condition_config ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.strategy !== undefined) updates.strategy = input.strategy;
    if (input.name !== undefined) updates.name = input.name;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
    if (input.condition_config !== undefined) updates.condition_config = input.condition_config;

    const { data, error } = await this.client
      .from('agent_assignment_config')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update assignment config', error.message, error.code);
    return data as AgentAssignmentConfigRow;
  }

  async deleteConfig(id: string): Promise<void> {
    if (isDemoMode()) return;

    const { error } = await this.client
      .from('agent_assignment_config')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete assignment config', error.message, error.code);
  }

  // ==========================================
  // Shop Bindings CRUD
  // ==========================================

  async listShopBindings(filters?: { shop_id?: string; user_id?: string }): Promise<ShopAgentBindingWithDetails[]> {
    if (isDemoMode()) return [];

    let query = this.client
      .from('shop_agent_bindings')
      .select(`
        *,
        shops:shop_id (name),
        users:user_id (name, email)
      `);

    if (filters?.shop_id) query = query.eq('shop_id', filters.shop_id);
    if (filters?.user_id) query = query.eq('user_id', filters.user_id);

    query = query.order('priority', { ascending: true });

    const { data, error } = await query;

    if (error) throw new RepositoryError('list shop bindings', error.message, error.code);

    return (data ?? []).map((row: Record<string, unknown>) => {
      const shops = row.shops as Record<string, unknown> | null;
      const users = row.users as Record<string, unknown> | null;
      return {
        ...row,
        shop_name: shops?.name as string | undefined,
        user_name: users?.name as string | undefined,
        user_email: users?.email as string | undefined,
      } as ShopAgentBindingWithDetails;
    });
  }

  async createShopBinding(input: CreateShopBindingInput): Promise<ShopAgentBindingRow> {
    if (isDemoMode()) {
      return {
        id: `demo-binding-${Date.now()}`,
        shop_id: input.shop_id,
        user_id: input.user_id,
        priority: input.priority ?? 0,
        is_enabled: input.is_enabled ?? true,
        created_at: new Date().toISOString(),
      };
    }

    const { data, error } = await this.client
      .from('shop_agent_bindings')
      .insert({
        shop_id: input.shop_id,
        user_id: input.user_id,
        priority: input.priority ?? 0,
        is_enabled: input.is_enabled ?? true,
      })
      .select()
      .single();

    if (error) {
      // Handle unique constraint violation (duplicate binding)
      if (error.code === '23505') {
        throw new ServiceError('该店铺和坐席的绑定已存在', { status: 409, code: 'DUPLICATE_BINDING' });
      }
      throw new RepositoryError('create shop binding', error.message, error.code);
    }
    return data as ShopAgentBindingRow;
  }

  async deleteShopBinding(id: string): Promise<void> {
    if (isDemoMode()) return;

    const { error } = await this.client
      .from('shop_agent_bindings')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete shop binding', error.message, error.code);
  }

  async deleteShopBindingsByShopAndUser(shopId: string, userId: string): Promise<void> {
    if (isDemoMode()) return;

    const { error } = await this.client
      .from('shop_agent_bindings')
      .delete()
      .eq('shop_id', shopId)
      .eq('user_id', userId);

    if (error) throw new RepositoryError('delete shop bindings', error.message, error.code);
  }

  // ==========================================
  // Shop Binding Query Helpers
  // ==========================================

  /**
   * Find the best available agent for a shop (designated_shop strategy)
   * Returns the agent with highest priority who is online
   */
  async findBestAgentForShop(shopId: string): Promise<string | null> {
    if (isDemoMode()) return null;

    // Get enabled bindings for the shop, ordered by priority
    const { data: bindings, error: bindingsError } = await this.client
      .from('shop_agent_bindings')
      .select('user_id')
      .eq('shop_id', shopId)
      .eq('is_enabled', true)
      .order('priority', { ascending: true });

    if (bindingsError) throw new RepositoryError('find agents for shop', bindingsError.message, bindingsError.code);
    if (!bindings || bindings.length === 0) return null;

    const userIds = (bindings as Array<{ user_id: string }>).map(b => b.user_id);

    // Get online agents from the bindings
    const { data: onlineAgents, error: sessionError } = await this.client
      .from('agent_sessions')
      .select('user_id')
      .in('user_id', userIds)
      .eq('status', 'online')
      .is('current_conversation_id', null);

    if (sessionError) throw new RepositoryError('find online agents', sessionError.message, sessionError.code);
    if (!onlineAgents || onlineAgents.length === 0) return null;

    // Return the first online agent (highest priority binding)
    const onlineUserIds = new Set((onlineAgents as Array<{ user_id: string }>).map(a => a.user_id));
    for (const binding of (bindings as Array<{ user_id: string }>)) {
      if (onlineUserIds.has(binding.user_id)) {
        return binding.user_id;
      }
    }

    return null;
  }

  /**
   * Find available agents for a skill group
   */
  async findAvailableAgentsForSkillGroup(skillGroupId: string | null): Promise<string[]> {
    if (isDemoMode()) return [];

    // Get skill group member IDs
    if (!skillGroupId) {
      // If no skill group, return all online agents
      const { data: allOnline, error } = await this.client
        .from('agent_sessions')
        .select('user_id')
        .eq('status', 'online')
        .is('current_conversation_id', null);

      if (error) throw new RepositoryError('find all online agents', error.message, error.code);
      return (allOnline ?? []).map(a => (a as { user_id: string }).user_id);
    }

    const { data: group, error: groupError } = await this.client
      .from('skill_groups')
      .select('member_ids')
      .eq('id', skillGroupId)
      .maybeSingle();

    if (groupError) throw new RepositoryError('find skill group', groupError.message, groupError.code);
    if (!group) return [];

    const memberIds = (group as Record<string, unknown>).member_ids as string[] | undefined;
    if (!memberIds || memberIds.length === 0) return [];

    // Get online agents from skill group members
    const { data: onlineAgents, error: sessionError } = await this.client
      .from('agent_sessions')
      .select('user_id')
      .in('user_id', memberIds)
      .eq('status', 'online')
      .is('current_conversation_id', null);

    if (sessionError) throw new RepositoryError('find skill group online agents', sessionError.message, sessionError.code);
    return (onlineAgents ?? []).map(a => (a as { user_id: string }).user_id);
  }
}
