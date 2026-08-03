import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { AutoReplyRule } from '@/lib/types';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { DEMO_AUTO_REPLY_RULES } from './demo-data/demo-auto-reply';

export interface UpdateAutoReplyRuleInput {
  keyword?: string;
  match_mode?: 'exact' | 'fuzzy';
  reply_content?: string;
  is_enabled?: boolean;
  priority?: number;
}

export interface CreateAutoReplyRuleInput {
  keyword: string;
  match_mode?: AutoReplyRule['match_mode'];
  reply_content: string;
  is_enabled?: boolean;
  priority?: number;
}

export interface UpdateAutoReplyRuleInput {
  keyword?: string;
  match_mode?: AutoReplyRule['match_mode'];
  reply_content?: string;
  is_enabled?: boolean;
  priority?: number;
}

export class AutoReplyRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(): Promise<AutoReplyRule[]> {
    if (isDemoMode()) {
      return DEMO_AUTO_REPLY_RULES;
    }
    
    const { data, error } = await this.client
      .from('auto_reply_rules')
      .select('*')
      .order('priority', { ascending: false });

    if (error) throw new RepositoryError('list auto reply rules', error.message, error.code);
    return (data ?? []) as AutoReplyRule[];
  }

  async listPaginated({ 
    limit, 
    offset,
    search,
    filterMode,
  }: { 
    page: number; 
    limit: number; 
    offset: number;
    search?: string;
    filterMode?: 'all' | 'enabled' | 'disabled';
  }): Promise<{ rules: AutoReplyRule[]; total: number }> {
    if (isDemoMode()) {
      let filtered = [...DEMO_AUTO_REPLY_RULES];
      
      // Apply filters
      if (filterMode === 'enabled') {
        filtered = filtered.filter(r => r.is_enabled);
      } else if (filterMode === 'disabled') {
        filtered = filtered.filter(r => !r.is_enabled);
      }
      
      // Apply search
      if (search) {
        const query = search.toLowerCase();
        filtered = filtered.filter(r => 
          r.keyword.toLowerCase().includes(query) ||
          r.reply_content.toLowerCase().includes(query)
        );
      }
      
      const sorted = filtered.sort((a, b) => b.priority - a.priority);
      return {
        rules: sorted.slice(offset, offset + limit),
        total: sorted.length,
      };
    }
    
    // Build filter conditions - chain directly on the base query builder
    const baseQuery = this.client.from('auto_reply_rules');
    let countQuery = baseQuery.select('*', { count: 'exact', head: true });
    let dataQuery = baseQuery.select('*');

    if (filterMode === 'enabled') {
      countQuery = countQuery.eq('is_enabled', true);
      dataQuery = dataQuery.eq('is_enabled', true);
    } else if (filterMode === 'disabled') {
      countQuery = countQuery.eq('is_enabled', false);
      dataQuery = dataQuery.eq('is_enabled', false);
    }
    if (search) {
      const searchPattern = `%${search}%`;
      countQuery = countQuery.or(`keyword.ilike.${searchPattern},reply_content.ilike.${searchPattern}`);
      dataQuery = dataQuery.or(`keyword.ilike.${searchPattern},reply_content.ilike.${searchPattern}`);
    }

    // Get total count
    const countResult = await countQuery;
    const count = 'count' in countResult ? countResult.count : null;
    const countError = 'error' in countResult ? countResult.error : null;
    if (countError) throw new RepositoryError('count auto reply rules', countError.message, countError.code);

    // Get paginated data
    const dataResult = await dataQuery.order('priority', { ascending: false }).range(offset, offset + limit - 1);
    const data = 'data' in dataResult ? dataResult.data : null;
    const error = 'error' in dataResult ? dataResult.error : null;

    if (error) throw new RepositoryError('list auto reply rules', error.message, error.code);
    return { rules: (data ?? []) as AutoReplyRule[], total: count ?? 0 };
  }

  async listEnabled(): Promise<AutoReplyRule[]> {
    if (isDemoMode()) {
      return DEMO_AUTO_REPLY_RULES.filter(r => r.is_enabled);
    }
    
    const { data, error } = await this.client
      .from('auto_reply_rules')
      .select('keyword, match_mode, reply_content, priority')
      .eq('is_enabled', true)
      .order('priority', { ascending: false });

    if (error) throw new RepositoryError('list enabled auto reply rules', error.message, error.code);
    return (data ?? []) as AutoReplyRule[];
  }

  async create(input: CreateAutoReplyRuleInput): Promise<AutoReplyRule> {
    if (isDemoMode()) {
      const newRule: AutoReplyRule = {
        id: `demo-${Date.now()}`,
        keyword: input.keyword,
        match_mode: input.match_mode ?? 'fuzzy',
        reply_content: input.reply_content,
        is_enabled: input.is_enabled ?? true,
        priority: input.priority ?? 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      DEMO_AUTO_REPLY_RULES.push(newRule);
      trimDemoArray(DEMO_AUTO_REPLY_RULES);
      return newRule;
    }
    
    const { data, error } = await this.client
      .from('auto_reply_rules')
      .insert({
        keyword: input.keyword,
        match_mode: input.match_mode ?? 'fuzzy',
        reply_content: input.reply_content,
        is_enabled: input.is_enabled ?? true,
        priority: input.priority ?? 0,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create auto reply rule', error.message, error.code);
    return data as AutoReplyRule;
  }

  async updateEnabled(id: string, isEnabled: boolean): Promise<AutoReplyRule | null> {
    if (isDemoMode()) {
      const rule = DEMO_AUTO_REPLY_RULES.find(r => r.id === id);
      if (rule) {
        rule.is_enabled = isEnabled;
        return rule;
      }
      return null;
    }
    
    const { data, error } = await this.client
      .from('auto_reply_rules')
      .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) throw new RepositoryError('update auto reply rule', error.message, error.code);
    return ((data ?? [])[0] as AutoReplyRule | undefined) ?? null;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = DEMO_AUTO_REPLY_RULES.findIndex(r => r.id === id);
      if (index !== -1) {
        DEMO_AUTO_REPLY_RULES.splice(index, 1);
      }
      return;
    }

    const { error } = await this.client.from('auto_reply_rules').delete().eq('id', id);
    if (error) throw new RepositoryError('delete auto reply rule', error.message, error.code);
  }

  async update(id: string, input: UpdateAutoReplyRuleInput): Promise<AutoReplyRule | null> {
    if (isDemoMode()) {
      const rule = DEMO_AUTO_REPLY_RULES.find(r => r.id === id);
      if (rule) {
        if (input.keyword !== undefined) rule.keyword = input.keyword;
        if (input.match_mode !== undefined) rule.match_mode = input.match_mode;
        if (input.reply_content !== undefined) rule.reply_content = input.reply_content;
        if (input.is_enabled !== undefined) rule.is_enabled = input.is_enabled;
        if (input.priority !== undefined) rule.priority = input.priority;
        rule.updated_at = new Date().toISOString();
        return rule;
      }
      return null;
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.keyword !== undefined) updates.keyword = input.keyword;
    if (input.match_mode !== undefined) updates.match_mode = input.match_mode;
    if (input.reply_content !== undefined) updates.reply_content = input.reply_content;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
    if (input.priority !== undefined) updates.priority = input.priority;

    const { data, error } = await this.client
      .from('auto_reply_rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update auto reply rule', error.message, error.code);
    return (data as AutoReplyRule) ?? null;
  }
}
