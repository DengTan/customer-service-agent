import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { AutoReplyRule } from '@/lib/types';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { DEMO_AUTO_REPLY_RULES } from './demo-data/demo-auto-reply';

export interface CreateAutoReplyRuleInput {
  keyword: string;
  match_mode?: AutoReplyRule['match_mode'];
  reply_content: string;
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
}
