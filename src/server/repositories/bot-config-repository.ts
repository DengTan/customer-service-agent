import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_MAIN_BOTS, DEMO_SUB_AGENTS } from './demo-data/demo-bots';

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
    return (data ?? []) as BotConfigRow[];
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
        created_at: new Date().toISOString(),
      };
    }
    if (input.is_default && !input.is_sub_agent) {
      await this.clearDefault();
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
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create bot config', error.message, error.code);
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
        created_at: existing?.created_at ?? '2026-01-01T00:00:00Z',
      };
    }
    if (input.is_default) {
      await this.clearDefault();
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.system_prompt !== undefined) updateData.system_prompt = input.system_prompt;
    if (input.tools !== undefined) updateData.tools = input.tools;
    if (input.knowledge_ids !== undefined) updateData.knowledge_ids = input.knowledge_ids;
    if (input.skill_group_id !== undefined) updateData.skill_group_id = input.skill_group_id;
    if (input.is_default !== undefined) updateData.is_default = input.is_default;
    if (input.parent_bot_id !== undefined) updateData.parent_bot_id = input.parent_bot_id;
    if (input.delegation_prompt !== undefined) updateData.delegation_prompt = input.delegation_prompt;
    if (input.collaboration_config !== undefined) updateData.collaboration_config = input.collaboration_config;
    if (input.is_sub_agent !== undefined) updateData.is_sub_agent = input.is_sub_agent;
    if (input.status !== undefined) updateData.status = input.status;

    const { data, error } = await this.client
      .from('bot_configs')
      .update(updateData)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update bot config', error.message, error.code);
    return data as BotConfigRow;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('bot_configs').delete().eq('id', id);
    if (error) throw new RepositoryError('delete bot config', error.message, error.code);
  }

  private async clearDefault(): Promise<void> {
    await this.client
      .from('bot_configs')
      .update({ is_default: false })
      .eq('is_default', true);
  }
}
