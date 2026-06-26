import {
  QuickReplyRepository,
  type QuickReplyFilters,
  type QuickReplyRow,
  type CreateQuickReplyInput,
  type UpdateQuickReplyInput,
} from '@/server/repositories/quick-reply-repository';
import { toServiceError } from './service-utils';

export class QuickReplyService {
  constructor(private readonly repo = new QuickReplyRepository()) {}

  async listReplies(filters: QuickReplyFilters = {}): Promise<QuickReplyRow[]> {
    try {
      return await this.repo.list(filters);
    } catch (error) {
      throw toServiceError(error, '获取话术列表失败', 'DB_ERROR');
    }
  }

  async createReply(input: CreateQuickReplyInput) {
    if (!input.title || !input.content) {
      throw toServiceError(
        new Error('validation'),
        '标题和内容不能为空',
        'VALIDATION_ERROR'
      );
    }

    try {
      return await this.repo.create(input);
    } catch (error) {
      throw toServiceError(error, '创建话术失败', 'DB_ERROR');
    }
  }

  async updateReply(input: UpdateQuickReplyInput) {
    if (!input.id) {
      throw toServiceError(
        new Error('validation'),
        '缺少话术ID',
        'VALIDATION_ERROR'
      );
    }

    try {
      return await this.repo.update(input);
    } catch (error) {
      throw toServiceError(error, '编辑话术失败', 'DB_ERROR');
    }
  }

  async deleteReply(id: string) {
    if (!id) {
      throw toServiceError(
        new Error('validation'),
        '缺少话术ID',
        'VALIDATION_ERROR'
      );
    }

    try {
      await this.repo.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除话术失败', 'DB_ERROR');
    }
  }
}
