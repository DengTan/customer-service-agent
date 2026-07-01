import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { ServiceError } from '@/server/services/service-error';
import { query, queryOne } from '@/lib/pg-direct';

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
  // Assignment Config CRUD (using pg-direct for PostgREST schema cache issue)
  // ==========================================

  async listConfigs(): Promise<AgentAssignmentConfigRow[]> {
    if (isDemoMode()) return [];

    try {
      const rows = await query<AgentAssignmentConfigRow>(
        `SELECT id, strategy, name, is_enabled, condition_config, created_at, updated_at 
         FROM agent_assignment_config 
         ORDER BY created_at DESC`
      );
      return rows;
    } catch (error) {
      throw new RepositoryError('list assignment configs', String(error), undefined);
    }
  }

  async getActiveConfig(): Promise<AgentAssignmentConfigRow | null> {
    if (isDemoMode()) return null;

    try {
      const row = await queryOne<AgentAssignmentConfigRow>(
        `SELECT id, strategy, name, is_enabled, condition_config, created_at, updated_at 
         FROM agent_assignment_config 
         WHERE is_enabled = true
         LIMIT 1`
      );
      return row;
    } catch (error) {
      throw new RepositoryError('get active config', String(error), undefined);
    }
  }

  async getConfigById(id: string): Promise<AgentAssignmentConfigRow | null> {
    if (isDemoMode()) return null;

    try {
      const row = await queryOne<AgentAssignmentConfigRow>(
        `SELECT id, strategy, name, is_enabled, condition_config, created_at, updated_at 
         FROM agent_assignment_config 
         WHERE id = $1`,
        [id]
      );
      return row;
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
      const row = await queryOne<AgentAssignmentConfigRow>(
        `INSERT INTO agent_assignment_config (strategy, name, is_enabled, condition_config)
         VALUES ($1, $2, $3, $4)
         RETURNING id, strategy, name, is_enabled, condition_config, created_at, updated_at`,
        [
          input.strategy,
          input.name,
          input.is_enabled ?? true,
          input.condition_config ?? null,
        ]
      );
      if (!row) throw new Error('Failed to insert config');
      return row;
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

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.strategy !== undefined) {
      updates.push(`strategy = $${paramIndex++}`);
      values.push(input.strategy);
    }
    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.is_enabled !== undefined) {
      updates.push(`is_enabled = $${paramIndex++}`);
      values.push(input.is_enabled);
    }
    if (input.condition_config !== undefined) {
      updates.push(`condition_config = $${paramIndex++}`);
      values.push(input.condition_config);
    }

    values.push(input.id);

    try {
      const row = await queryOne<AgentAssignmentConfigRow>(
        `UPDATE agent_assignment_config 
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, strategy, name, is_enabled, condition_config, created_at, updated_at`,
        values
      );
      if (!row) throw new Error('Config not found');
      return row;
    } catch (error) {
      throw new RepositoryError('update assignment config', String(error), undefined);
    }
  }

  async deleteConfig(id: string): Promise<void> {
    if (isDemoMode()) return;

    try {
      await query(`DELETE FROM agent_assignment_config WHERE id = $1`, [id]);
    } catch (error) {
      throw new RepositoryError('delete assignment config', String(error), undefined);
    }
  }

  // ==========================================
  // Shop Bindings CRUD (using pg-direct for PostgREST schema cache issue)
  // ==========================================

  async listShopBindings(filters?: { shop_id?: string; user_id?: string }): Promise<ShopAgentBindingWithDetails[]> {
    if (isDemoMode()) return [];

    let sql = `
      SELECT 
        sb.id, sb.shop_id, sb.user_id, sb.priority, sb.is_enabled, sb.created_at,
        s.name as shop_name,
        u.name as user_name, u.email as user_email
      FROM shop_agent_bindings sb
      LEFT JOIN shops s ON s.id = sb.shop_id
      LEFT JOIN users u ON u.id = sb.user_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.shop_id) {
      params.push(filters.shop_id);
      sql += ` AND sb.shop_id = $${params.length}`;
    }
    if (filters?.user_id) {
      params.push(filters.user_id);
      sql += ` AND sb.user_id = $${params.length}`;
    }

    sql += ' ORDER BY sb.priority ASC';

    try {
      return await query<ShopAgentBindingWithDetails>(sql, params);
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
      const row = await queryOne<ShopAgentBindingRow>(
        `INSERT INTO shop_agent_bindings (shop_id, user_id, priority, is_enabled)
         VALUES ($1, $2, $3, $4)
         RETURNING id, shop_id, user_id, priority, is_enabled, created_at`,
        [
          input.shop_id,
          input.user_id,
          input.priority ?? 0,
          input.is_enabled ?? true,
        ]
      );
      if (!row) throw new Error('Failed to insert shop binding');
      return row;
    } catch (error: unknown) {
      // Handle unique constraint violation (duplicate binding)
      if (String(error).includes('23505')) {
        throw new ServiceError('该店铺和坐席的绑定已存在', { status: 409, code: 'DUPLICATE_BINDING' });
      }
      throw new RepositoryError('create shop binding', String(error), undefined);
    }
  }

  async deleteShopBinding(id: string): Promise<void> {
    if (isDemoMode()) return;

    try {
      await query(`DELETE FROM shop_agent_bindings WHERE id = $1`, [id]);
    } catch (error) {
      throw new RepositoryError('delete shop binding', String(error), undefined);
    }
  }

  async deleteShopBindingsByShopAndUser(shopId: string, userId: string): Promise<void> {
    if (isDemoMode()) return;

    try {
      await query(
        `DELETE FROM shop_agent_bindings WHERE shop_id = $1 AND user_id = $2`,
        [shopId, userId]
      );
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
      // Get enabled bindings for the shop, ordered by priority
      const bindings = await query<{ user_id: string }>(
        `SELECT user_id FROM shop_agent_bindings 
         WHERE shop_id = $1 AND is_enabled = true 
         ORDER BY priority ASC`,
        [shopId]
      );

      if (bindings.length === 0) return null;

      const userIds = bindings.map(b => b.user_id);
      const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');

      // Get online agents from the bindings
      const onlineAgents = await query<{ user_id: string }>(
        `SELECT user_id FROM agent_sessions 
         WHERE user_id IN (${placeholders}) 
           AND status = 'online' 
           AND current_conversation_id IS NULL`,
        userIds
      );

      if (onlineAgents.length === 0) return null;

      // Return the first online agent (highest priority binding)
      const onlineUserIds = new Set(onlineAgents.map(a => a.user_id));
      for (const binding of bindings) {
        if (onlineUserIds.has(binding.user_id)) {
          return binding.user_id;
        }
      }

      return null;
    } catch (error) {
      throw new RepositoryError('find agents for shop', String(error), undefined);
    }
  }

  /**
   * Find available agents for a skill group
   */
  async findAvailableAgentsForSkillGroup(skillGroupId: string | null): Promise<string[]> {
    if (isDemoMode()) return [];

    try {
      if (!skillGroupId) {
        // If no skill group, return all online agents
        const rows = await query<{ user_id: string }>(
          `SELECT user_id FROM agent_sessions 
           WHERE status = 'online' AND current_conversation_id IS NULL`
        );
        return rows.map(r => r.user_id);
      }

      // Get skill group member IDs
      const group = await queryOne<{ member_ids: string[] }>(
        `SELECT member_ids FROM skill_groups WHERE id = $1`,
        [skillGroupId]
      );

      if (!group || !group.member_ids || group.member_ids.length === 0) return [];

      const memberIds = group.member_ids;
      const placeholders = memberIds.map((_, i) => `$${i + 1}`).join(',');

      // Get online agents from skill group members
      const rows = await query<{ user_id: string }>(
        `SELECT user_id FROM agent_sessions 
         WHERE user_id IN (${placeholders}) 
           AND status = 'online' 
           AND current_conversation_id IS NULL`,
        memberIds
      );

      return rows.map(r => r.user_id);
    } catch (error) {
      throw new RepositoryError('find skill group online agents', String(error), undefined);
    }
  }
}
