import {
  QualityRepository,
  type QualityFilters,
  type FlatQualityCheckRecord,
  type CreateQualityRuleInput,
  type UpdateQualityRuleInput,
} from '@/server/repositories/quality-repository';
import type { QualityRule } from '@/lib/types';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

export interface QualityRulesResult {
  rules: QualityRule[];
}

export interface QualityRecordsResult {
  records: FlatQualityCheckRecord[];
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
  ): Promise<QualityRecordsResult> {
    try {
      const filters: QualityFilters = {
        result,
        rule_type: ruleType,
        limit: 100,
      };
      const records = await this.repo.listCheckRecords(filters);
      return { records };
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
   * - "satisfaction_below": always passes for AI replies (evaluated at rating time)
   * - "first_response_timeout": always passes for AI replies (evaluated at message time)
   * - "keyword_forbidden": checks if forbidden keywords appear in the reply
   */
  async runQualityCheck(
    conversationId: string,
    aiReplyContent: string,
  ): Promise<void> {
    try {
      const { rules } = await this.listRules(true);
      for (const rule of rules) {
        const config = (rule.config ?? {}) as Record<string, unknown>;
        let result: 'pass' | 'fail' = 'pass';
        let detail: string | null = null;

        if (rule.type === 'negative_sentiment') {
          const keywords = (config.negative_keywords as string[]) ?? [];
          const found = keywords.filter(kw => aiReplyContent.includes(kw));
          if (found.length > 0) {
            result = 'fail';
            detail = `AI 回复包含负面关键词: ${found.join(', ')}`;
          }
        } else if (rule.type === 'keyword_violation') {
          const forbidden = (config.forbidden_keywords as string[]) ?? (config.keywords as string[]) ?? [];
          const found = forbidden.filter(kw => aiReplyContent.includes(kw));
          if (found.length > 0) {
            result = 'fail';
            detail = `AI 回复包含禁止关键词: ${found.join(', ')}`;
          }
        }
        // other rule types (first_response_timeout, satisfaction_below) are not applicable here

        await this.repo.createCheckRecord({
          conversation_id: conversationId,
          rule_id: rule.id,
          result,
          detail,
        });
      }
    } catch (error) {
      // Quality check failure should not block message processing
      logger.error('[QualityService] runQualityCheck failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
