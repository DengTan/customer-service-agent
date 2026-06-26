import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface SkillGroupFilters {
  [key: string]: unknown;
}

export interface CreateSkillGroupInput {
  name: string;
  description?: string | null;
  member_ids?: string[];
  is_default?: boolean;
}

export interface UpdateSkillGroupInput {
  id: string;
  name?: string;
  description?: string | null;
  member_ids?: string[];
  is_default?: boolean;
}

export class SkillGroupRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(_filters: SkillGroupFilters = {}): Promise<unknown[]> {
    if (isDemoMode()) {
      return [
        { id: 'demo-sg-1', name: '售前咨询组', description: '处理产品咨询和售前问题', member_ids: ['demo-user-2', 'demo-user-3'], is_default: true, member_count: 2, created_at: '2026-01-01T00:00:00Z' },
        { id: 'demo-sg-2', name: '售后组', description: '处理退货、退款、售后问题', member_ids: ['demo-user-2'], is_default: false, member_count: 1, created_at: '2026-02-01T00:00:00Z' },
      ];
    }
    const { data, error } = await this.client
      .from('skill_groups')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw new RepositoryError('list skill groups', error.message, error.code);

    return (data || []).map((group: { member_ids: unknown[] }) => ({
      ...group,
      member_count: Array.isArray(group.member_ids) ? group.member_ids.length : 0,
    }));
  }

  async create(input: CreateSkillGroupInput): Promise<unknown> {
    if (isDemoMode()) return { id: 'demo-sg-new', name: input.name, description: input.description, member_ids: input.member_ids || [], is_default: input.is_default ?? false, member_count: (input.member_ids || []).length };
    const { data, error } = await this.client
      .from('skill_groups')
      .insert({
        name: input.name,
        description: input.description ?? null,
        member_ids: input.member_ids || [],
        is_default: input.is_default ?? false,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create skill group', error.message, error.code);
    return {
      ...data,
      member_count: (data.member_ids as string[]).length,
    };
  }

  async update(input: UpdateSkillGroupInput): Promise<unknown> {
    if (isDemoMode()) return { id: input.id, name: input.name, description: input.description, member_ids: input.member_ids || [], is_default: input.is_default, member_count: (input.member_ids || []).length };
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.member_ids !== undefined) updates.member_ids = input.member_ids;
    if (input.is_default !== undefined) updates.is_default = input.is_default;

    const { data, error } = await this.client
      .from('skill_groups')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update skill group', error.message, error.code);
    return {
      ...data,
      member_count: (data.member_ids as string[]).length,
    };
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('skill_groups')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete skill group', error.message, error.code);
  }
}
