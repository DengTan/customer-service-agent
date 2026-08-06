import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

// Demo mode mock data
const DEMO_TAGS = [
  { id: 'demo-tag-1', name: '产品咨询', color: '#2F6BFF', category: 'question_type', conversation_count: 45, created_at: new Date().toISOString() },
  { id: 'demo-tag-2', name: '售后问题', color: '#F59E0B', category: 'question_type', conversation_count: 23, created_at: new Date().toISOString() },
  { id: 'demo-tag-3', name: '投诉', color: '#EF4444', category: 'sentiment', conversation_count: 8, created_at: new Date().toISOString() },
  { id: 'demo-tag-4', name: '正面', color: '#10B981', category: 'sentiment', conversation_count: 67, created_at: new Date().toISOString() },
];

export interface ConversationTagFilters {
  category?: string | null;
  conversation_id?: string | null;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  category?: string;
}

export interface UpdateTagInput {
  id: string;
  name?: string;
  color?: string;
  category?: string;
}

export interface TagConversationInput {
  conversation_id: string;
  tag_id: string;
  tagged_by?: string;
}

export class ConversationTagRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async listDefinitions(filters: ConversationTagFilters = {}): Promise<unknown[]> {
    if (isDemoMode()) {
      let tags = DEMO_TAGS;
      if (filters.category) {
        tags = tags.filter(t => t.category === filters.category);
      }
      return tags;
    }
    
    try {
      let query = this.client
        .from('conversation_tags_def')
        .select('*')
        .order('category')
        .order('name');

      if (filters.category) query = query.eq('category', filters.category);

      const { data, error } = await query;
      if (error) throw new RepositoryError('list conversation tag definitions', error.message, error.code);
      return data ?? [];
    } catch (error) {
      logger.error('Database query failed for listDefinitions, falling back to demo data', { error });
      let tags = DEMO_TAGS;
      if (filters.category) {
        tags = tags.filter(t => t.category === filters.category);
      }
      return tags;
    }
  }

  async listDefinitionsPaginated(opts: {
    category?: string | null;
    search?: string | null;
    page: number;
    limit: number;
  }): Promise<{ tags: unknown[]; total: number }> {
    const { category, search, page, limit } = opts;
    const offset = (page - 1) * limit;

    if (isDemoMode()) {
      let all = [...DEMO_TAGS];
      if (category) all = all.filter(t => t.category === category);
      if (search) {
        const q = search.toLowerCase();
        all = all.filter((t) => t.name.toLowerCase().includes(q) || ((t as { description?: string }).description ?? '').toLowerCase().includes(q));
      }
      const sorted = all.sort((a, b) => {
        const catDiff = a.category.localeCompare(b.category);
        return catDiff !== 0 ? catDiff : a.name.localeCompare(b.name);
      });
      return { tags: sorted.slice(offset, offset + limit), total: sorted.length };
    }

    let countQuery = this.client
      .from('conversation_tags_def')
      .select('id', { count: 'exact', head: true });

    let dataQuery = this.client
      .from('conversation_tags_def')
      .select('*', { count: 'exact' })
      .order('category')
      .order('name');

    if (category) {
      countQuery = countQuery.eq('category', category);
      dataQuery = dataQuery.eq('category', category);
    }
    if (search) {
      const pattern = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      countQuery = countQuery.or(`name.ilike.${pattern},description.ilike.${pattern}`);
      dataQuery = dataQuery.or(`name.ilike.${pattern},description.ilike.${pattern}`);
    }

    const [{ count, error: countError }, { data, error: dataError }] = await Promise.all([
      countQuery,
      dataQuery.range(offset, offset + limit - 1),
    ]);

    if (countError) throw new RepositoryError('count conversation tag definitions', countError.message, countError.code);
    if (dataError) throw new RepositoryError('list conversation tag definitions', dataError.message, dataError.code);
    return { tags: data ?? [], total: count ?? 0 };
  }

  async listForConversation(conversationId: string): Promise<unknown[]> {
    if (isDemoMode()) {
      return [];
    }
    
    const { data, error } = await this.client
      .from('conversation_tag_records')
      .select('*, conversation_tags_def(name, color, category)')
      .eq('conversation_id', conversationId);

    if (error) throw new RepositoryError('list conversation tags', error.message, error.code);

    return (data || []).map((r: Record<string, unknown>) => ({
      id: r.id,
      conversation_id: r.conversation_id,
      tag_id: r.tag_id,
      tagged_by: r.tagged_by,
      created_at: r.created_at,
      tag_name: (r.conversation_tags_def as Record<string, unknown>)?.name,
      tag_color: (r.conversation_tags_def as Record<string, unknown>)?.color,
    }));
  }

  async createDefinition(input: CreateTagInput): Promise<unknown> {
    if (isDemoMode()) {
      const newTag = {
        id: `demo-tag-${Date.now()}`,
        name: input.name,
        color: input.color || '#2F6BFF',
        category: input.category || 'question_type',
        conversation_count: 0,
        created_at: new Date().toISOString(),
      };
      DEMO_TAGS.push(newTag);
      trimDemoArray(DEMO_TAGS);
      return newTag;
    }
    
    const { data, error } = await this.client
      .from('conversation_tags_def')
      .insert({
        name: input.name,
        color: input.color || '#2F6BFF',
        category: input.category || 'question_type',
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create conversation tag', error.message, error.code);
    return data;
  }

  async tagConversation(input: TagConversationInput): Promise<unknown> {
    if (isDemoMode()) {
      return { id: `demo-record-${Date.now()}`, ...input, created_at: new Date().toISOString() };
    }
    
    const { data, error } = await this.client
      .from('conversation_tag_records')
      .insert({
        conversation_id: input.conversation_id,
        tag_id: input.tag_id,
        tagged_by: input.tagged_by,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('tag conversation', error.message, error.code);
    return data;
  }

  async incrementConversationCount(tagId: string): Promise<void> {
    if (isDemoMode()) {
      const tag = DEMO_TAGS.find(t => t.id === tagId);
      if (tag) tag.conversation_count++;
      return;
    }
    
    const { data: currentTag } = await this.client
      .from('conversation_tags_def')
      .select('conversation_count')
      .eq('id', tagId)
      .single();

    if (currentTag) {
      const { error } = await this.client
        .from('conversation_tags_def')
        .update({ conversation_count: (currentTag.conversation_count || 0) + 1 })
        .eq('id', tagId);

      if (error) throw new RepositoryError('increment conversation count', error.message, error.code);
    }
  }

  async updateDefinition(input: UpdateTagInput): Promise<unknown> {
    if (isDemoMode()) {
      const tag = DEMO_TAGS.find(t => t.id === input.id);
      if (tag) {
        if (input.name !== undefined) tag.name = input.name;
        if (input.color !== undefined) tag.color = input.color;
        if (input.category !== undefined) tag.category = input.category;
      }
      return tag;
    }

    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.color !== undefined) updates.color = input.color;
    if (input.category !== undefined) updates.category = input.category;

    const { data, error } = await this.client
      .from('conversation_tags_def')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update conversation tag', error.message, error.code);
    return data;
  }

  async deleteDefinition(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = DEMO_TAGS.findIndex(t => t.id === id);
      if (index !== -1) DEMO_TAGS.splice(index, 1);
      return;
    }
    
    const { error } = await this.client
      .from('conversation_tags_def')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete conversation tag definition', error.message, error.code);
  }

  async deleteRecord(id: string): Promise<void> {
    if (isDemoMode()) {
      return;
    }
    
    const { error } = await this.client
      .from('conversation_tag_records')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete conversation tag record', error.message, error.code);
  }
}
