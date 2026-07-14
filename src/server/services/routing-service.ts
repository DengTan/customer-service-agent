import {
  RoutingRepository,
  type RoutingRuleRow,
  type CreateRoutingRuleInput,
  type UpdateRoutingRuleInput,
} from '@/server/repositories/routing-repository';
import { BotConfigRepository, type BotConfigRow } from '@/server/repositories/bot-config-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

export interface RoutingMatchResult {
  matched: true;
  rule: RoutingRuleRow;
  bot: BotConfigRow;
}

export class RoutingService {
  constructor(
    private readonly repo = new RoutingRepository(),
    private readonly botRepo = new BotConfigRepository(),
  ) {}

  /**
   * Match user message against enabled routing rules (sorted by priority desc).
   * Returns the first matched rule + target bot config, or null if no match.
   *
   * Supported condition_type:
   * - "keyword": condition_config = { keywords: string[], match_mode?: "exact"|"fuzzy" }
   * - "default": always matches (lowest priority fallback)
   */
  async matchRule(userMessage: string): Promise<RoutingMatchResult | null> {
    try {
      const { rules } = await this.listRules();
      const enabledRules = rules.filter(r => r.is_enabled);

      for (const rule of enabledRules) {
        const config = (rule.condition_config ?? {}) as Record<string, unknown>;

        if (rule.condition_type === 'keyword') {
          const keywords = (config.keywords as string[]) ?? [];
          const matchMode = (config.match_mode as string) ?? 'fuzzy';

          const matched = keywords.some(kw => {
            if (!kw) return false;
            return matchMode === 'exact'
              ? userMessage === kw
              : userMessage.includes(kw);
          });

          if (matched) {
            const bot = await this.botRepo.findById(rule.target_bot_id);
            if (bot) return { matched: true, rule, bot };
          }
        } else if (rule.condition_type === 'default') {
          const bot = await this.botRepo.findById(rule.target_bot_id);
          if (bot) return { matched: true, rule, bot };
        }
      }

      return null;
    } catch (error) {
      // Routing match failure should not block message processing
      logger.error('[RoutingService] matchRule failed', { error });
      return null;
    }
  }

  async listRules(): Promise<{ rules: RoutingRuleRow[] }> {
    try {
      const rules = await this.repo.list();
      return { rules };
    } catch (error) {
      throw toServiceError(error, '获取路由规则列表失败', 'DB_ERROR');
    }
  }

  async createRule(input: CreateRoutingRuleInput): Promise<{ rule: RoutingRuleRow }> {
    if (!input.name || !input.target_bot_id) {
      throw new ServiceError('名称和目标Bot为必填项', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const rule = await this.repo.create(input);
      return { rule };
    } catch (error) {
      throw toServiceError(error, '创建路由规则失败', 'DB_ERROR');
    }
  }

  async updateRule(input: UpdateRoutingRuleInput): Promise<{ rule: RoutingRuleRow }> {
    if (!input.id) {
      throw new ServiceError('缺少规则ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repo.findById(input.id);
      if (!existing) {
        throw new ServiceError('路由规则不存在', { status: 404, code: 'NOT_FOUND' });
      }
      const rule = await this.repo.update(input);
      return { rule };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '更新路由规则失败', 'DB_ERROR');
    }
  }

  async deleteRule(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少规则ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const existing = await this.repo.findById(id);
      if (!existing) {
        throw new ServiceError('路由规则不存在', { status: 404, code: 'NOT_FOUND' });
      }
      await this.repo.delete(id);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '删除路由规则失败', 'DB_ERROR');
    }
  }
}
