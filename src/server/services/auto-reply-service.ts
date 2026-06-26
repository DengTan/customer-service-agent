import type { AutoReplyRule } from '@/lib/types';
import {
  AutoReplyRepository,
  type CreateAutoReplyRuleInput,
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

  async matchReply(message: string): Promise<MatchedAutoReply | null> {
    try {
      const rules = await this.autoReplies.listEnabled();
      for (const rule of rules) {
        const matched =
          rule.match_mode === 'exact' ? message.trim() === rule.keyword : message.includes(rule.keyword);

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
