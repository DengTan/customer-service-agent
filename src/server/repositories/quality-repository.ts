import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { QualityRule, QualityCheck, QualityRuleType } from '@/lib/types';
import { trimDemoArray } from '@/lib/api-utils';
import { DEMO_QUALITY_RULES } from './demo-data/demo-quality';

export interface QualityFilters {
  is_enabled?: boolean | null;
  result?: string | null;
  rule_type?: string | null;
  limit?: number;
}

export interface FlatQualityCheckRecord {
  id: string;
  conversation_id: string;
  rule_id: string;
  result: 'pass' | 'fail';
  detail: string | null;
  created_at: string;
  rule_name: string | null;
  rule_type: QualityRuleType | null;
}

export interface CreateQualityRuleInput {
  name: string;
  type: string;
  config?: Record<string, unknown>;
  is_enabled?: boolean;
}

export interface UpdateQualityRuleInput {
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
  is_enabled?: boolean;
}

export class QualityRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async listRules(filters: QualityFilters): Promise<QualityRule[]> {
    if (isDemoMode()) {
      let rules = DEMO_QUALITY_RULES;
      if (filters.is_enabled !== null && filters.is_enabled !== undefined) {
        rules = rules.filter(r => r.is_enabled === filters.is_enabled);
      }
      return rules;
    }
    
    try {
      let query = this.client
        .from('quality_rules')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.is_enabled !== null && filters.is_enabled !== undefined) {
        query = query.eq('is_enabled', filters.is_enabled);
      }

      const { data, error } = await query;
      if (error) throw new RepositoryError('list quality rules', error.message, error.code);
      return (data ?? []) as QualityRule[];
    } catch (error) {
      console.error('Database query failed for listRules, falling back to demo data:', error);
      let rules = DEMO_QUALITY_RULES;
      if (filters.is_enabled !== null && filters.is_enabled !== undefined) {
        rules = rules.filter(r => r.is_enabled === filters.is_enabled);
      }
      return rules;
    }
  }

  async listCheckRecords(filters: QualityFilters): Promise<FlatQualityCheckRecord[]> {
    if (isDemoMode()) {
      return [];
    }
    
    try {
      let query = this.client
        .from('quality_checks')
        .select('*, quality_rules(name, type)')
        .order('created_at', { ascending: false })
        .limit(filters.limit ?? 100);

      if (filters.result) {
        query = query.eq('result', filters.result);
      }

      const { data, error } = await query;
      if (error) throw new RepositoryError('list quality check records', error.message, error.code);

      let records = data || [];
      if (filters.rule_type) {
        records = (records as Record<string, unknown>[]).filter((r) => {
          const rule = r.quality_rules as Record<string, unknown> | null;
          return rule?.type === filters.rule_type;
        });
      }

      return (records as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        conversation_id: r.conversation_id as string,
        rule_id: r.rule_id as string,
        result: r.result as 'pass' | 'fail',
        detail: (r.detail as string) ?? null,
        created_at: r.created_at as string,
        rule_name: ((r.quality_rules as Record<string, unknown>)?.name as string) ?? null,
        rule_type: ((r.quality_rules as Record<string, unknown>)?.type as QualityRuleType) ?? null,
      }));
    } catch (error) {
      console.error('Database query failed for listCheckRecords, falling back to demo data:', error);
      return [];
    }
  }

  async createRule(input: CreateQualityRuleInput): Promise<QualityRule> {
    if (isDemoMode()) {
      const newRule: QualityRule = {
        id: `demo-rule-${Date.now()}`,
        name: input.name,
        type: input.type as QualityRuleType,
        config: input.config || {},
        is_enabled: input.is_enabled !== undefined ? input.is_enabled : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      DEMO_QUALITY_RULES.push(newRule);
      trimDemoArray(DEMO_QUALITY_RULES);
      return newRule;
    }
    
    const { data, error } = await this.client
      .from('quality_rules')
      .insert({
        name: input.name,
        type: input.type,
        config: input.config || {},
        is_enabled: input.is_enabled !== undefined ? input.is_enabled : true,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create quality rule', error.message, error.code);
    return data as QualityRule;
  }

  async updateRule(id: string, input: UpdateQualityRuleInput): Promise<QualityRule> {
    if (isDemoMode()) {
      const rule = DEMO_QUALITY_RULES.find(r => r.id === id);
      if (!rule) throw new RepositoryError('update quality rule', 'Rule not found');
      if (input.name !== undefined) rule.name = input.name;
      if (input.type !== undefined) rule.type = input.type as QualityRuleType;
      if (input.config !== undefined) rule.config = input.config;
      if (input.is_enabled !== undefined) rule.is_enabled = input.is_enabled;
      rule.updated_at = new Date().toISOString();
      return rule;
    }
    
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.type !== undefined) updates.type = input.type;
    if (input.config !== undefined) updates.config = input.config;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;

    const { data, error } = await this.client
      .from('quality_rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update quality rule', error.message, error.code);
    return data as QualityRule;
  }

  async deleteRule(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = DEMO_QUALITY_RULES.findIndex(r => r.id === id);
      if (index !== -1) DEMO_QUALITY_RULES.splice(index, 1);
      return;
    }
    
    const { error } = await this.client.from('quality_rules').delete().eq('id', id);
    if (error) throw new RepositoryError('delete quality rule', error.message, error.code);
  }

  async createCheckRecord(input: {
    conversation_id: string;
    rule_id: string;
    result: 'pass' | 'fail';
    detail?: string | null;
  }): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('quality_checks')
      .insert({
        conversation_id: input.conversation_id,
        rule_id: input.rule_id,
        result: input.result,
        detail: input.detail ?? null,
      });
    if (error) throw new RepositoryError('create quality check record', error.message, error.code);
  }
}
