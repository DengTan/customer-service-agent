import type { AutoReplyRule } from '@/lib/types';
import {
  AutoReplyRepository,
  type CreateAutoReplyRuleInput,
  type UpdateAutoReplyRuleInput,
} from '@/server/repositories/auto-reply-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export interface MatchedAutoReply {
  content: string;
  rule: AutoReplyRule;
}

export class AutoReplyService {
  constructor(private readonly autoReplies = new AutoReplyRepository()) {}

  async listRules(): Promise<AutoReplyRule[]> {
    try {
      return await this.autoReplies.list();
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch auto reply rules');
    }
  }

  async createRule(input: CreateAutoReplyRuleInput): Promise<AutoReplyRule> {
    if (!input.keyword || !input.reply_content) {
      throw new ServiceError('Keyword and reply content are required', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    // 禁止空关键词（会导致 fuzzy 模式全匹配）
    if (input.keyword.trim() === '') {
      throw new ServiceError('Keyword cannot be empty', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.autoReplies.create(input);
    } catch (error) {
      throw toServiceError(error, 'Failed to create auto reply rule');
    }
  }

  async updateRuleEnabled(id: string, isEnabled: boolean): Promise<AutoReplyRule> {
    if (!id || isEnabled === undefined) {
      throw new ServiceError('Rule id and enabled status are required', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const rule = await this.autoReplies.updateEnabled(id, isEnabled);
      if (!rule) {
        throw new ServiceError('Rule not found', { status: 404, code: 'NOT_FOUND' });
      }

      return rule;
    } catch (error) {
      throw toServiceError(error, 'Failed to update auto reply rule');
    }
  }

  async updateRulePartial(id: string, input: {
    keyword?: string;
    match_mode?: 'exact' | 'fuzzy';
    reply_content?: string;
    is_enabled?: boolean;
    priority?: number;
  }): Promise<AutoReplyRule> {
    if (!id) {
      throw new ServiceError('Rule id is required', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const rule = await this.autoReplies.update(id, {
        keyword: input.keyword,
        match_mode: input.match_mode,
        reply_content: input.reply_content,
        priority: input.priority,
        is_enabled: input.is_enabled,
      });
      if (!rule) {
        throw new ServiceError('Rule not found', { status: 404, code: 'NOT_FOUND' });
      }

      return rule;
    } catch (error) {
      throw toServiceError(error, 'Failed to update auto reply rule');
    }
  }

  async deleteRule(id: string | null): Promise<void> {
    if (!id) {
      throw new ServiceError('Rule id is required', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.autoReplies.delete(id);
    } catch (error) {
      throw toServiceError(error, 'Failed to delete auto reply rule');
    }
  }

  async updateRule(id: string, input: UpdateAutoReplyRuleInput): Promise<AutoReplyRule> {
    if (!id) {
      throw new ServiceError('Rule id is required', { status: 400, code: 'VALIDATION_ERROR' });
    }

    // 校验：keyword 和 reply_content 不能同时为空
    if (input.keyword !== undefined && input.keyword.trim() === '') {
      throw new ServiceError('Keyword cannot be empty', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (input.reply_content !== undefined && input.reply_content.trim() === '') {
      throw new ServiceError('Reply content cannot be empty', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const rule = await this.autoReplies.update(id, input);
      if (!rule) {
        throw new ServiceError('Rule not found', { status: 404, code: 'NOT_FOUND' });
      }

      return rule;
    } catch (error) {
      throw toServiceError(error, 'Failed to update auto reply rule');
    }
  }

  async matchReply(message: string): Promise<MatchedAutoReply | null> {
    try {
      const rules = await this.autoReplies.listEnabled();
      // Sort by priority descending (higher priority first)
      const sortedRules = rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      const lowerMessage = message.toLowerCase();

      for (const rule of sortedRules) {
        const lowerKeyword = rule.keyword.toLowerCase();
        const matched =
          rule.match_mode === 'exact'
            ? message.trim().toLowerCase() === lowerKeyword
            : lowerMessage.includes(lowerKeyword);

        if (matched) {
          return { content: rule.reply_content, rule };
        }
      }

      return null;
    } catch (error) {
      throw toServiceError(error, 'Failed to match auto reply rules');
    }
  }
}
