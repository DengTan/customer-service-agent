import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_MAIN_BOTS, DEMO_SUB_AGENTS } from './demo-data/demo-bots';
import { getLogger } from '@/lib/logger';

const logger = getLogger('BotConfigRepository');

export interface BotConfigRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: unknown[];
  knowledge_ids: string[];
  skill_group_id: string | null;
  is_default: boolean;
  parent_bot_id: string | null;
  delegation_prompt: string | null;
  collaboration_config: Record<string, unknown> | null;
  is_sub_agent: boolean;
  status: string;
  platform_connection_id: string | null;  // 关联的店铺ID，每个店铺只能绑定一个Bot
  created_at: string;
  updated_at?: string;
}

export interface CreateBotConfigInput {
  name: string;
  description?: string;
  system_prompt: string;
  tools?: unknown[];
  knowledge_ids?: string[];
  skill_group_id?: string | null;
  is_default?: boolean;
  parent_bot_id?: string | null;
  delegation_prompt?: string | null;
  collaboration_config?: Record<string, unknown> | null;
  is_sub_agent?: boolean;
  platform_connection_id?: string | null;  // 关联的店铺ID
}

export interface UpdateBotConfigInput {
  id: string;
  name?: string;
  description?: string;
  system_prompt?: string;
  tools?: unknown[];
  knowledge_ids?: string[];
  skill_group_id?: string | null;
  is_default?: boolean;
  parent_bot_id?: string | null;
  delegation_prompt?: string | null;
  collaboration_config?: Record<string, unknown> | null;
  is_sub_agent?: boolean;
  status?: string;
  platform_connection_id?: string | null;  // 关联的店铺ID
  expected_updated_at?: string; // 乐观锁：若提供则只在 updated_at 匹配时更新
}

export class BotConfigRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(includeSubAgents: boolean = true): Promise<BotConfigRow[]> {
    if (isDemoMode()) {
      return includeSubAgents ? [...DEMO_MAIN_BOTS, ...DEMO_SUB_AGENTS] : DEMO_MAIN_BOTS;
    }

    let query = this.client
      .from('bot_configs')
      .select('*')
      .order('created_at', { ascending: true });

    if (!includeSubAgents) {
      query = query.eq('is_sub_agent', false);
    }

    const { data, error } = await query;

    if (error) throw new RepositoryError('list bot configs', error.message, error.code);
    return (data ?? []).map(row => ({
      ...row,
      platform_connection_id: (row as Record<string, unknown>).platform_connection_id as string | null,
    })) as BotConfigRow[];
  }

  async findById(id: string): Promise<BotConfigRow | null> {
    if (isDemoMode()) {
      const bots = await this.list();
      return bots.find(b => b.id === id) ?? null;
    }
    const { data, error } = await this.client
      .from('bot_configs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError('find bot config', error.message, error.code);
    return data as BotConfigRow | null;
  }

  /**
   * 根据店铺ID查找绑定的Bot
   */
  async findByShopId(shopId: string): Promise<BotConfigRow | null> {
    if (isDemoMode()) {
      const bots = await this.list();
      return bots.find(b => b.platform_connection_id === shopId) ?? null;
    }
    const { data, error } = await this.client
      .from('bot_configs')
      .select('*')
      .eq('platform_connection_id', shopId)
      .maybeSingle();

    if (error) throw new RepositoryError('find bot by shop', error.message, error.code);
    return data as BotConfigRow | null;
  }

  async listSubAgents(parentBotId: string): Promise<BotConfigRow[]> {
    if (isDemoMode()) {
      return DEMO_SUB_AGENTS.filter(a => a.parent_bot_id === parentBotId);
    }
    const { data, error } = await this.client
      .from('bot_configs')
      .select('*')
      .eq('parent_bot_id', parentBotId)
      .eq('is_sub_agent', true)
      .order('created_at', { ascending: true });

    if (error) throw new RepositoryError('list sub agents', error.message, error.code);
    return (data ?? []) as BotConfigRow[];
  }

  /**
   * Find multiple bots by ID in a single IN-query.
   * Used by handleCollaboration (P2-2) to avoid N round-trips.
   */
  async findByIds(ids: string[]): Promise<BotConfigRow[]> {
    if (ids.length === 0) return [];
    if (isDemoMode()) {
      const all = await this.list(true);
      const idSet = new Set(ids);
      return all.filter((b) => idSet.has(b.id));
    }
    const { data, error } = await this.client
      .from('bot_configs')
      .select('*')
      .in('id', ids);
    if (error) throw new RepositoryError('find bots by ids', error.message, error.code);
    return (data ?? []) as BotConfigRow[];
  }

  /**
   * Single-roundtrip alternative to listMainBots + N×listSubAgents.
   * Uses PostgREST's resource embedding to fetch each main bot with its
   * child count in one query (P2-1).
   */
  /**
   * Get all main bots with their sub-agent counts.
   * Primary path uses PostgREST embed (requires FK on parent_bot_id).
   * Fallback: two separate queries if embed fails (FK may not exist yet).
   */
  async listMainBotsWithCounts(): Promise<Array<BotConfigRow & { sub_agent_count: number }>> {
    if (isDemoMode()) {
      const main = (await this.list(false)) as BotConfigRow[];
      const counts = new Map<string, number>();
      for (const a of DEMO_SUB_AGENTS) {
        if (a.status === 'active') {
          counts.set(a.parent_bot_id!, (counts.get(a.parent_bot_id!) ?? 0) + 1);
        }
      }
      return main.map((b) => ({ ...b, sub_agent_count: counts.get(b.id) ?? 0 }));
    }
    // Always derive the active sub-agent count from a focused query — the
    // PostgREST embed `count` does not support a status filter, and the
    // quota gate only considers active sub-agents anyway.
    const [mainBots, activeSubAgents] = await Promise.all([
      this.listMainBots(),
      this.client
        .from('bot_configs')
        .select('parent_bot_id')
        .eq('is_sub_agent', true)
        .eq('status', 'active')
        .not('parent_bot_id', 'is', null),
    ]);
    const counts = new Map<string, number>();
    if (Array.isArray(activeSubAgents.data)) {
      for (const row of activeSubAgents.data as Array<{ parent_bot_id: string }>) {
        counts.set(row.parent_bot_id, (counts.get(row.parent_bot_id) ?? 0) + 1);
      }
    }
    return mainBots.map((b) => ({ ...b, sub_agent_count: counts.get(b.id) ?? 0 }));
  }

  async listMainBots(): Promise<BotConfigRow[]> {
    if (isDemoMode()) {
      return (await this.list(false));
    }
    const { data, error } = await this.client
      .from('bot_configs')
      .select('*')
      .eq('is_sub_agent', false)
      .order('created_at', { ascending: true });

    if (error) throw new RepositoryError('list main bots', error.message, error.code);
    return (data ?? []) as BotConfigRow[];
  }

  /** Count ACTIVE main bots. Matches the DB trigger (defense-in-depth). */
  async countMainBots(): Promise<number> {
    if (isDemoMode()) {
      const main = await this.list(false);
      return main.filter((b) => b.status === 'active').length;
    }
    const { count, error } = await this.client
      .from('bot_configs')
      .select('*', { count: 'exact', head: true })
      .eq('is_sub_agent', false)
      .eq('status', 'active');

    if (error) throw new RepositoryError('count main bots', error.message, error.code);
    return count ?? 0;
  }

  async create(input: CreateBotConfigInput): Promise<BotConfigRow> {
    if (isDemoMode()) {
      const newId = input.is_sub_agent ? `demo-sub-${Date.now()}` : `demo-bot-${Date.now()}`;
      return {
        id: newId,
        name: input.name,
        description: input.description ?? '',
        system_prompt: input.system_prompt,
        tools: input.tools ?? [],
        knowledge_ids: input.knowledge_ids ?? [],
        skill_group_id: input.skill_group_id ?? null,
        is_default: input.is_default ?? false,
        parent_bot_id: input.parent_bot_id ?? null,
        delegation_prompt: input.delegation_prompt ?? null,
        collaboration_config: input.collaboration_config ?? null,
        is_sub_agent: input.is_sub_agent ?? false,
        status: 'active',
        platform_connection_id: input.platform_connection_id ?? null,
        created_at: new Date().toISOString(),
      };
    }
    // NOTE: The create path also uses a 3-step pattern (clearDefault / clearShopBot / insert).
    // This is safe for INSERT because the new record doesn't exist yet — no TOCTOU with UPDATE.
    // The UPDATE path is migrated to the atomic upsert_bot_config RPC instead.
    if (input.is_default && !input.is_sub_agent) {
      await this.clearDefault();
    }
    // 如果指定了店铺，先清除该店铺的现有Bot绑定
    const shopId = input.platform_connection_id;
    if (shopId && shopId !== '') {
      await this.clearShopBot(shopId);
    }

    const { data, error } = await this.client
      .from('bot_configs')
      .insert({
        name: input.name,
        description: input.description ?? '',
        system_prompt: input.system_prompt,
        tools: input.tools ?? [],
        knowledge_ids: input.knowledge_ids ?? [],
        skill_group_id: input.skill_group_id ?? null,
        is_default: input.is_default ?? false,
        parent_bot_id: input.parent_bot_id ?? null,
        delegation_prompt: input.delegation_prompt ?? null,
        collaboration_config: input.collaboration_config ?? null,
        is_sub_agent: input.is_sub_agent ?? false,
        status: 'active',
        // 统一处理空字符串为 null
        platform_connection_id: shopId === '' ? null : (shopId || null),
      })
      .select()
      .single();

    if (error) {
      // Translate the database-level cap triggers (P0003) to typed
      // RepositoryError codes so the service layer can map them to
      // friendly 400s instead of a generic DB_ERROR. Two triggers exist:
      //   - bot_configs_sub_agent_cap  (子Agent 数量)
      //   - bot_configs_main_bot_cap   (主Bot 数量)
      const code = (error as { code?: string }).code;
      const message = error.message ?? '';
      if (code === 'P0003' || message.includes('主Bot') || message.includes('子Agent')) {
        throw new RepositoryError('create bot config', message, 'MAX_BOT_QUOTA_EXCEEDED');
      }
      throw new RepositoryError('create bot config', message, code ?? 'DB_ERROR');
    }
    return data as BotConfigRow;
  }

  async update(input: UpdateBotConfigInput): Promise<BotConfigRow> {
    if (isDemoMode()) {
      const existing = await this.findById(input.id);
      return {
        id: input.id,
        name: input.name ?? existing?.name ?? 'Bot',
        description: input.description ?? existing?.description ?? '',
        system_prompt: input.system_prompt ?? existing?.system_prompt ?? '',
        tools: input.tools ?? existing?.tools ?? [],
        knowledge_ids: input.knowledge_ids ?? existing?.knowledge_ids ?? [],
        skill_group_id: input.skill_group_id ?? existing?.skill_group_id ?? null,
        is_default: input.is_default ?? existing?.is_default ?? false,
        parent_bot_id: input.parent_bot_id ?? existing?.parent_bot_id ?? null,
        delegation_prompt: input.delegation_prompt ?? existing?.delegation_prompt ?? null,
        collaboration_config: input.collaboration_config ?? existing?.collaboration_config ?? null,
        is_sub_agent: input.is_sub_agent ?? existing?.is_sub_agent ?? false,
        status: input.status ?? existing?.status ?? 'active',
        platform_connection_id: input.platform_connection_id ?? existing?.platform_connection_id ?? null,
        created_at: existing?.created_at ?? '2026-01-01T00:00:00Z',
      };
    }
    // Use atomic RPC to prevent TOCTOU race between clearDefault / clearShopBot / update
    // (migration: 20260728_bot_update_rpc.sql)
    const rpcArgs = {
      p_id: input.id,
      p_name: input.name ?? null,
      p_description: input.description ?? null,
      p_system_prompt: input.system_prompt ?? null,
      p_tools: input.tools ?? null,
      p_knowledge_ids: input.knowledge_ids ?? null,
      p_skill_group_id: input.skill_group_id ?? null,
      p_is_default: input.is_default ?? null,
      p_parent_bot_id: input.parent_bot_id === undefined ? null : input.parent_bot_id,
      p_delegation_prompt: input.delegation_prompt === undefined ? null : input.delegation_prompt,
      p_collaboration_config: input.collaboration_config ?? null,
      p_is_sub_agent: input.is_sub_agent ?? null,
      p_status: input.status ?? null,
      p_platform_connection_id:
        input.platform_connection_id === undefined ? null : input.platform_connection_id,
      p_expected_updated_at: input.expected_updated_at ?? null,
    };

    const { data, error } = await this.client.rpc('upsert_bot_config', rpcArgs).single();

    if (error) {
      // Map known PostgREST error codes from the RPC to repository errors
      const code = (error as { code?: string }).code;
      const message = error.message ?? '';
      if (code === 'P0001' || message.includes('已被并发更新')) {
        throw new RepositoryError('update bot config', 'Bot 已被并发更新，请刷新后重试', 'CONCURRENT_UPDATE');
      }
      if (code === 'P0002' || message.includes('Bot 不存在')) {
        throw new RepositoryError('update bot config', 'Bot 不存在', 'NOT_FOUND');
      }
      if (code === 'P0003' || message.includes('主Bot') || message.includes('子Agent')) {
        throw new RepositoryError('update bot config', message, 'MAX_BOT_QUOTA_EXCEEDED');
      }
      throw new RepositoryError('update bot config', message, code ?? 'DB_ERROR');
    }
    return data as BotConfigRow;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('bot_configs').delete().eq('id', id);
    if (error) throw new RepositoryError('delete bot config', error.message, error.code);
  }

  /**
   * Count child items that reference this bot, used by the service layer
   * to warn the admin before deleting a bot that has sub-agents / delegations / routing rules.
   */
  async countReferences(botId: string): Promise<{
    subAgents: number;
    delegationsAsParent: number;
    delegationsAsChild: number;
    routingRules: number;
  }> {
    if (isDemoMode()) {
      return { subAgents: 0, delegationsAsParent: 0, delegationsAsChild: 0, routingRules: 0 };
    }
    const [subAgents, delegationsAsParent, delegationsAsChild, routingRules] = await Promise.all([
      this.countSubAgents(botId),
      this.client
        .from('agent_delegations')
        .select('*', { count: 'exact', head: true })
        .eq('parent_bot_id', botId),
      this.client
        .from('agent_delegations')
        .select('*', { count: 'exact', head: true })
        .eq('child_bot_id', botId),
      this.client
        .from('routing_rules')
        .select('*', { count: 'exact', head: true })
        .eq('target_bot_id', botId),
    ]);
    return {
      subAgents,
      delegationsAsParent: delegationsAsParent.count ?? 0,
      delegationsAsChild: delegationsAsChild.count ?? 0,
      routingRules: routingRules.count ?? 0,
    };
  }

  private async countSubAgents(parentBotId: string): Promise<number> {
    if (isDemoMode()) return 0;
    const { count } = await this.client
      .from('bot_configs')
      .select('*', { count: 'exact', head: true })
      .eq('parent_bot_id', parentBotId);
    return count ?? 0;
  }

  private async clearDefault(): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('bot_configs')
      .update({ is_default: false })
      .eq('is_default', true);
    if (error) throw new RepositoryError('clear default bot', error.message, error.code);
  }

  private async clearShopBot(shopId: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('bot_configs')
      .update({ platform_connection_id: null })
      .eq('platform_connection_id', shopId);
      if (error) throw new RepositoryError('clear shop bot binding', error.message, error.code);
  }
}

export const botConfigRepository = new BotConfigRepository();
