import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { QualityRule, QualityCheck, QualityRuleType } from '@/lib/types';
import { trimDemoArray } from '@/lib/api-utils';
import { DEMO_QUALITY_RULES } from './demo-data/demo-quality';
import { getLogger } from '@/lib/logger';

const logger = getLogger('QualityRepository');

export interface QualityFilters {
  is_enabled?: boolean | null;
  result?: string | null;
  rule_type?: string | null;
  limit?: number;
  offset?: number;
}

export interface QualityStatsParams {
  startDate?: string;
  endDate?: string;
}

export interface QualityStatRow {
  total: number;
  pass_count: number;
  fail_count: number;
  rule_type: string | null;
  rule_name: string | null;
  date: string;
}

export interface QualityStats {
  overall: {
    total: number;
    pass_count: number;
    fail_count: number;
    pass_rate: number;
  };
  by_date: Array<{
    date: string;
    total: number;
    pass_count: number;
    fail_count: number;
    pass_rate: number;
  }>;
  by_rule: Array<{
    rule_type: string | null;
    rule_name: string | null;
    total: number;
    pass_count: number;
    fail_count: number;
    pass_rate: number;
  }>;
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
      logger.error('Database query failed for listRules, falling back to demo data', { error });
      let rules = DEMO_QUALITY_RULES;
      if (filters.is_enabled !== null && filters.is_enabled !== undefined) {
        rules = rules.filter(r => r.is_enabled === filters.is_enabled);
      }
      return rules;
    }
  }

  async listCheckRecords(filters: QualityFilters): Promise<{ records: FlatQualityCheckRecord[]; total: number }> {
    if (isDemoMode()) {
      return { records: [], total: 0 };
    }

    try {
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;

      // Count query for total
      let countQuery = this.client
        .from('quality_checks')
        .select('id', { count: 'exact', head: true });

      if (filters.result) {
        countQuery = countQuery.eq('result', filters.result);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw new RepositoryError('count quality check records', countError.message, countError.code);
      const total = count ?? 0;

      let query = this.client
        .from('quality_checks')
        .select('*, quality_rules(name, type)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

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

      const mapped = (records as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        conversation_id: r.conversation_id as string,
        rule_id: r.rule_id as string,
        result: r.result as 'pass' | 'fail',
        detail: (r.detail as string) ?? null,
        created_at: r.created_at as string,
        rule_name: ((r.quality_rules as Record<string, unknown>)?.name as string) ?? null,
        rule_type: ((r.quality_rules as Record<string, unknown>)?.type as QualityRuleType) ?? null,
      }));

      return { records: mapped, total };
    } catch (error) {
      logger.error('Database query failed for listCheckRecords, falling back to empty', { error });
      return { records: [], total: 0 };
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

  async getStats(params: QualityStatsParams): Promise<QualityStatRow[]> {
    if (isDemoMode()) {
      return [];
    }

    try {
      const { startDate, endDate } = params;

      if (!startDate && !endDate) {
        const { data, error } = await this.client
          .from('quality_checks')
          .select(`
            result,
            created_at,
            quality_rules!inner(type, name)
          `)
          .order('created_at', { ascending: false });

        if (error) throw new RepositoryError('get quality stats', error.message, error.code);

        return this.aggregateStatsRows(data || []);
      }

      const query = this.client
        .from('quality_checks')
        .select(`
          result,
          created_at,
          quality_rules!inner(type, name)
        `)
        .gte('created_at', startDate || '1970-01-01')
        .lte('created_at', endDate || new Date().toISOString())
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw new RepositoryError('get quality stats', error.message, error.code);

      return this.aggregateStatsRows(data || []);
    } catch (error) {
      logger.error('Database query failed for getStats', { error });
      return [];
    }
  }

  private aggregateStatsRows(rows: Record<string, unknown>[]): QualityStatRow[] {
    const grouped = new Map<string, QualityStatRow>();

    for (const row of rows) {
      const rule = row.quality_rules as Record<string, unknown> | null;
      const ruleType = (rule?.type as string) || null;
      const ruleName = (rule?.name as string) || null;
      const createdAt = row.created_at as string;
      const date = createdAt ? new Date(createdAt).toISOString().split('T')[0] : '';
      const result = row.result as string;

      const key = `${date}|${ruleType || ''}|${ruleName || ''}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.total += 1;
        if (result === 'pass') existing.pass_count += 1;
        if (result === 'fail') existing.fail_count += 1;
      } else {
        grouped.set(key, {
          total: 1,
          pass_count: result === 'pass' ? 1 : 0,
          fail_count: result === 'fail' ? 1 : 0,
          rule_type: ruleType,
          rule_name: ruleName,
          date,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.date.localeCompare(a.date));
  }
}
