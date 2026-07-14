import {
  QualityRepository,
  type QualityFilters,
  type FlatQualityCheckRecord,
  type CreateQualityRuleInput,
  type UpdateQualityRuleInput,
  type QualityStats,
  type QualityStatsParams,
} from '@/server/repositories/quality-repository';
import type { QualityRule } from '@/lib/types';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

/**
 * Check if a keyword appears as a whole word (not as part of another word) in the text.
 * Uses word-boundary aware matching to avoid false positives like "不满意" matching "满意".
 */
function containsWholeWord(text: string, keyword: string): boolean {
  if (!keyword.trim()) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[\\s.,!?;:'"()\\[\\]{}])${escaped}(?=$|[\\s.,!?;:'"()\\[\\]{}]|$)`, 'i');
  return regex.test(text);
}

/**
 * Context passed to quality check rules.
 * Contains all information needed to evaluate conversation-level quality rules.
 */
export interface QualityCheckContext {
  conversationId: string;
  aiReplyContent: string;
  messageCount: number;
  aiReplyCreatedAt: string;
  conversationCreatedAt: string;
  /** Timestamp of the first assistant reply in this conversation (for first_response_timeout check). */
  firstAssistantReplyAt: string | null;
}

/**
 * Result of evaluating a single quality rule.
 */
export interface QualityCheckResult {
  ruleId: string;
  ruleType: string;
  ruleName: string;
  result: 'pass' | 'fail';
  detail: string | null;
}

export interface QualityRulesResult {
  rules: QualityRule[];
}

export interface QualityRecordsResult {
  records: FlatQualityCheckRecord[];
  total: number;
}

export class QualityService {
  constructor(private readonly repo = new QualityRepository()) {}

  async listRules(isEnabled?: boolean | null): Promise<QualityRulesResult> {
    try {
      const filters: QualityFilters = { is_enabled: isEnabled };
      const rules = await this.repo.listRules(filters);
      return { rules };
    } catch (error) {
      throw toServiceError(error, '获取质检规则失败', 'DB_ERROR');
    }
  }

  async listCheckRecords(
    result?: string | null,
    ruleType?: string | null,
    limit?: number,
    offset?: number,
  ): Promise<QualityRecordsResult> {
    try {
      const filters: QualityFilters = {
        result,
        rule_type: ruleType,
        limit: limit ?? 50,
        offset,
      };
      const { records, total } = await this.repo.listCheckRecords(filters);
      return { records, total };
    } catch (error) {
      throw toServiceError(error, '获取质检记录失败', 'DB_ERROR');
    }
  }

  async createRule(input: CreateQualityRuleInput): Promise<{ rule: QualityRule }> {
    if (!input.name || !input.type) {
      throw new ServiceError('规则名称和类型不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const rule = await this.repo.createRule(input);
      return { rule };
    } catch (error) {
      throw toServiceError(error, '创建质检规则失败', 'DB_ERROR');
    }
  }

  async updateRule(id: string, input: UpdateQualityRuleInput): Promise<{ rule: QualityRule }> {
    if (!id) {
      throw new ServiceError('缺少规则ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const rule = await this.repo.updateRule(id, input);
      return { rule };
    } catch (error) {
      throw toServiceError(error, '更新质检规则失败', 'DB_ERROR');
    }
  }

  async deleteRule(id: string): Promise<{ success: boolean }> {
    if (!id) {
      throw new ServiceError('缺少规则ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.deleteRule(id);
      return { success: true };
    } catch (error) {
      throw toServiceError(error, '删除质检规则失败', 'DB_ERROR');
    }
  }

  /**
   * Run all enabled quality rules against an AI reply.
   * For each rule, check if the content violates the rule and write a quality_checks record.
   *
   * Supported rule types:
   * - "negative_sentiment": checks for negative keywords in the reply
   * - "keyword_violation": checks if forbidden keywords appear in the reply
   * - "first_response_timeout": checks if first AI response took longer than threshold
   * - "high_turn_count": checks if conversation has exceeded message count threshold
   * - "satisfaction_below": always passes here (evaluated at rating time via checkSatisfactionBelow)
   *
   * @returns Array of quality check results with pass/fail status for each rule
   */
  async runQualityCheck(context: QualityCheckContext): Promise<QualityCheckResult[]> {
    const results: QualityCheckResult[] = [];

    try {
      const { rules } = await this.listRules(true);
      for (const rule of rules) {
        const config = (rule.config ?? {}) as Record<string, unknown>;
        let result: 'pass' | 'fail' = 'pass';
        let detail: string | null = null;

        if (rule.type === 'negative_sentiment') {
          const keywords = (config.negative_keywords as string[]) ?? [];
          const found = keywords.filter(kw => containsWholeWord(context.aiReplyContent, kw));
          if (found.length > 0) {
            result = 'fail';
            detail = `AI 回复包含负面关键词: ${found.join(', ')}`;
          }
        } else if (rule.type === 'keyword_violation') {
          const forbidden = (config.forbidden_keywords as string[]) ?? (config.keywords as string[]) ?? [];
          const found = forbidden.filter(kw => containsWholeWord(context.aiReplyContent, kw));
          if (found.length > 0) {
            result = 'fail';
            detail = `AI 回复包含禁止关键词: ${found.join(', ')}`;
          }
        } else if (rule.type === 'high_turn_count') {
          const threshold = (config.threshold as number) ?? 20;
          if (context.messageCount > threshold) {
            result = 'fail';
            detail = `对话轮次(${context.messageCount})超过阈值(${threshold})`;
          }
        } else if (rule.type === 'first_response_timeout') {
          const thresholdMinutes = (config.threshold_minutes as number) ?? 5;
          if (!context.firstAssistantReplyAt) {
            // No assistant reply found — skip this check
            result = 'pass';
            detail = null;
          } else {
            const convCreated = new Date(context.conversationCreatedAt);
            const firstReplyAt = new Date(context.firstAssistantReplyAt);
            const responseTimeMinutes = (firstReplyAt.getTime() - convCreated.getTime()) / 1000 / 60;
            if (responseTimeMinutes > thresholdMinutes) {
              result = 'fail';
              detail = `首响时间(${responseTimeMinutes.toFixed(1)}分钟)超过阈值(${thresholdMinutes}分钟)`;
            }
          }
        }
        // "satisfaction_below" is handled by checkSatisfactionBelow (evaluated at rating time)

        await this.repo.createCheckRecord({
          conversation_id: context.conversationId,
          rule_id: rule.id,
          result,
          detail,
        });

        results.push({
          ruleId: rule.id,
          ruleType: rule.type,
          ruleName: rule.name,
          result,
          detail,
        });
      }
    } catch (error) {
      // Quality check failure should not block message processing
      logger.error('[QualityService] runQualityCheck failed', { error: error instanceof Error ? error.message : String(error) });
    }

    return results;
  }

  /**
   * Check if satisfaction rating is below threshold.
   * This is evaluated at rating submission time (not at AI reply time).
   */
  async checkSatisfactionBelow(
    conversationId: string,
    rating: number,
  ): Promise<QualityCheckResult[]> {
    const results: QualityCheckResult[] = [];

    try {
      const { rules } = await this.listRules(true);

      for (const rule of rules) {
        if (rule.type !== 'satisfaction_below') continue;

        const config = (rule.config ?? {}) as Record<string, unknown>;
        const threshold = (config.threshold as number) ?? 3;
        const result: 'pass' | 'fail' = rating < threshold ? 'fail' : 'pass';
        const detail = result === 'fail'
          ? `满意度评分(${rating}分)低于阈值(${threshold}分)`
          : null;

        await this.repo.createCheckRecord({
          conversation_id: conversationId,
          rule_id: rule.id,
          result,
          detail,
        });

        results.push({
          ruleId: rule.id,
          ruleType: rule.type,
          ruleName: rule.name,
          result,
          detail,
        });
      }
    } catch (error) {
      logger.error('[QualityService] checkSatisfactionBelow failed', { error: error instanceof Error ? error.message : String(error) });
    }

    return results;
  }

  async getStats(params: QualityStatsParams): Promise<QualityStats> {
    try {
      const rawRows = await this.repo.getStats(params);

      const overall = {
        total: rawRows.reduce((sum, r) => sum + r.total, 0),
        pass_count: rawRows.reduce((sum, r) => sum + r.pass_count, 0),
        fail_count: rawRows.reduce((sum, r) => sum + r.fail_count, 0),
        pass_rate: 0,
      };
      overall.pass_rate = overall.total > 0 ? Math.round((overall.pass_count / overall.total) * 100) / 100 : 0;

      const byDateMap = new Map<string, { total: number; pass_count: number; fail_count: number }>();
      for (const r of rawRows) {
        const existing = byDateMap.get(r.date);
        if (existing) {
          existing.total += r.total;
          existing.pass_count += r.pass_count;
          existing.fail_count += r.fail_count;
        } else {
          byDateMap.set(r.date, { total: r.total, pass_count: r.pass_count, fail_count: r.fail_count });
        }
      }
      const by_date = Array.from(byDateMap.entries())
        .map(([date, stats]) => ({
          date,
          ...stats,
          pass_rate: stats.total > 0 ? Math.round((stats.pass_count / stats.total) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      const byRuleMap = new Map<string, { rule_type: string | null; rule_name: string | null; total: number; pass_count: number; fail_count: number }>();
      for (const r of rawRows) {
        const key = `${r.rule_type || ''}|${r.rule_name || ''}`;
        const existing = byRuleMap.get(key);
        if (existing) {
          existing.total += r.total;
          existing.pass_count += r.pass_count;
          existing.fail_count += r.fail_count;
        } else {
          byRuleMap.set(key, { rule_type: r.rule_type, rule_name: r.rule_name, total: r.total, pass_count: r.pass_count, fail_count: r.fail_count });
        }
      }
      const by_rule = Array.from(byRuleMap.values()).map(stats => ({
        ...stats,
        pass_rate: stats.total > 0 ? Math.round((stats.pass_count / stats.total) * 100) / 100 : 0,
      }));

      return { overall, by_date, by_rule };
    } catch (error) {
      throw toServiceError(error, '获取质检统计失败', 'DB_ERROR');
    }
  }
}
