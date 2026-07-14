import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { ServiceError } from '@/server/services/service-error';
import { logger } from '@/lib/logger';

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

const ASSIGNMENT_CONFIG_SELECT =
  'id, strategy, name, is_enabled, condition_config, created_at, updated_at';

const SHOP_BINDING_SELECT =
  'id, shop_id, user_id, priority, is_enabled, created_at, shop:shops(name), user:users(name, email)';

interface ShopBindingQueryRow {
  id: string;
  shop_id: string;
  user_id: string;
  priority: number;
  is_enabled: boolean;
  created_at: string;
  shop?: { name: string } | { name: string }[] | null;
  user?: { name: string; email: string } | { name: string; email: string }[] | null;
}

function flattenShopBinding(row: ShopBindingQueryRow): ShopAgentBindingWithDetails {
  const shop = Array.isArray(row.shop) ? row.shop[0] : row.shop;
  const user = Array.isArray(row.user) ? row.user[0] : row.user;
  return {
    id: row.id,
    shop_id: row.shop_id,
    user_id: row.user_id,
    priority: row.priority,
    is_enabled: row.is_enabled,
    created_at: row.created_at,
    shop_name: shop?.name,
    user_name: user?.name,
    user_email: user?.email,
  };
}

export class AgentAssignmentRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // ==========================================
  // Assignment Config CRUD
  // ==========================================

  async listConfigs(): Promise<AgentAssignmentConfigRow[]> {
    if (isDemoMode()) return [];

    try {
      const { data, error } = await this.client
        .from('agent_assignment_config')
        .select(ASSIGNMENT_CONFIG_SELECT)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as AgentAssignmentConfigRow[];
    } catch (error) {
      throw new RepositoryError('list assignment configs', String(error), undefined);
    }
  }

  async getActiveConfig(): Promise<AgentAssignmentConfigRow | null> {
    if (isDemoMode()) return null;

    try {
      const { data, error } = await this.client
        .from('agent_assignment_config')
        .select(ASSIGNMENT_CONFIG_SELECT)
        .eq('is_enabled', true)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as AgentAssignmentConfigRow | null) ?? null;
    } catch (error) {
      throw new RepositoryError('get active config', String(error), undefined);
    }
  }

  async getConfigById(id: string): Promise<AgentAssignmentConfigRow | null> {
    if (isDemoMode()) return null;

    try {
      const { data, error } = await this.client
        .from('agent_assignment_config')
        .select(ASSIGNMENT_CONFIG_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return (data as AgentAssignmentConfigRow | null) ?? null;
    } catch (error) {
      throw new RepositoryError('get config by id', String(error), undefined);
    }
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

    try {
      const { data, error } = await this.client
        .from('agent_assignment_config')
        .insert({
          strategy: input.strategy,
          name: input.name,
          is_enabled: input.is_enabled ?? true,
          condition_config: input.condition_config ?? null,
        })
        .select(ASSIGNMENT_CONFIG_SELECT)
        .single();

      if (error) throw error;
      return data as AgentAssignmentConfigRow;
    } catch (error) {
      throw new RepositoryError('create assignment config', String(error), undefined);
    }
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

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.strategy !== undefined) updates.strategy = input.strategy;
    if (input.name !== undefined) updates.name = input.name;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
    if (input.condition_config !== undefined) updates.condition_config = input.condition_config;

    try {
      const { data, error } = await this.client
        .from('agent_assignment_config')
        .update(updates)
        .eq('id', input.id)
        .select(ASSIGNMENT_CONFIG_SELECT)
        .single();

      if (error) throw error;
      return data as AgentAssignmentConfigRow;
    } catch (error) {
      throw new RepositoryError('update assignment config', String(error), undefined);
    }
  }

  async deleteConfig(id: string): Promise<void> {
    if (isDemoMode()) return;

    try {
      const { error } = await this.client
        .from('agent_assignment_config')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      throw new RepositoryError('delete assignment config', String(error), undefined);
    }
  }

  // ==========================================
  // Shop Bindings CRUD
  // ==========================================

  async listShopBindings(filters?: { shop_id?: string; user_id?: string }): Promise<ShopAgentBindingWithDetails[]> {
    if (isDemoMode()) return [];

    try {
      let query = this.client
        .from('shop_agent_bindings')
        .select(SHOP_BINDING_SELECT)
        .order('priority', { ascending: true });

      if (filters?.shop_id) query = query.eq('shop_id', filters.shop_id);
      if (filters?.user_id) query = query.eq('user_id', filters.user_id);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => flattenShopBinding(row as ShopBindingQueryRow));
    } catch (error) {
      throw new RepositoryError('list shop bindings', String(error), undefined);
    }
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

    try {
      const { data, error } = await this.client
        .from('shop_agent_bindings')
        .insert({
          shop_id: input.shop_id,
          user_id: input.user_id,
          priority: input.priority ?? 0,
          is_enabled: input.is_enabled ?? true,
        })
        .select('id, shop_id, user_id, priority, is_enabled, created_at')
        .single();

      if (error) {
        // PostgREST reports unique-constraint violations with code 23505
        if (error.code === '23505') {
          throw new ServiceError('该店铺和坐席的绑定已存在', { status: 409, code: 'DUPLICATE_BINDING' });
        }
        throw error;
      }
      return data as ShopAgentBindingRow;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new RepositoryError('create shop binding', String(error), undefined);
    }
  }

  async deleteShopBinding(id: string): Promise<void> {
    if (isDemoMode()) return;

    try {
      const { error } = await this.client
        .from('shop_agent_bindings')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      throw new RepositoryError('delete shop binding', String(error), undefined);
    }
  }

  async deleteShopBindingsByShopAndUser(shopId: string, userId: string): Promise<void> {
    if (isDemoMode()) return;

    try {
      const { error } = await this.client
        .from('shop_agent_bindings')
        .delete()
        .eq('shop_id', shopId)
        .eq('user_id', userId);

      if (error) throw error;
    } catch (error) {
      throw new RepositoryError('delete shop bindings', String(error), undefined);
    }
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

    try {
      const { data: bindings, error: bindingsError } = await this.client
        .from('shop_agent_bindings')
        .select('user_id')
        .eq('shop_id', shopId)
        .eq('is_enabled', true)
        .order('priority', { ascending: true });

      if (bindingsError) throw bindingsError;
      if (!bindings || bindings.length === 0) return null;

      const userIds = bindings.map((b) => b.user_id);
      const { data: onlineAgents, error: onlineError } = await this.client
        .from('agent_sessions')
        .select('user_id')
        .in('user_id', userIds)
        .eq('status', 'online')
        .is('current_conversation_id', null);

      if (onlineError) throw onlineError;
      if (!onlineAgents || onlineAgents.length === 0) return null;

      const onlineUserIds = new Set(onlineAgents.map((a) => a.user_id));
      for (const binding of bindings) {
        if (onlineUserIds.has(binding.user_id)) {
          return binding.user_id;
        }
      }

      return null;
    } catch (error) {
      logger.api.warn('[agent-assignment-repository] findBestAgentForShop failed', { error: String(error) });
      return null;
    }
  }

  /**
   * Find available agents for a skill group
   */
  async findAvailableAgentsForSkillGroup(skillGroupId: string | null): Promise<string[]> {
    if (isDemoMode()) return [];

    try {
      if (!skillGroupId) {
        const { data, error } = await this.client
          .from('agent_sessions')
          .select('user_id')
          .eq('status', 'online')
          .is('current_conversation_id', null);

        if (error) throw error;
        return (data ?? []).map((r) => r.user_id);
      }

      const { data: group, error: groupError } = await this.client
        .from('skill_groups')
        .select('member_ids')
        .eq('id', skillGroupId)
        .maybeSingle();

      if (groupError) throw groupError;
      const memberIds = (group?.member_ids ?? []) as string[];
      if (memberIds.length === 0) return [];

      const { data: rows, error } = await this.client
        .from('agent_sessions')
        .select('user_id')
        .in('user_id', memberIds)
        .eq('status', 'online')
        .is('current_conversation_id', null);

      if (error) throw error;
      return (rows ?? []).map((r) => r.user_id);
    } catch (error) {
      logger.api.warn('[agent-assignment-repository] findAvailableAgentsForSkillGroup failed', { error: String(error) });
      return [];
    }
  }
}