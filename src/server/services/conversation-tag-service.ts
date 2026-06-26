import {
  ConversationTagRepository,
  type ConversationTagFilters,
  type CreateTagInput,
  type TagConversationInput,
} from '@/server/repositories/conversation-tag-repository';
import { toServiceError } from './service-utils';

export class ConversationTagService {
  constructor(private readonly repo = new ConversationTagRepository()) {}

  async listDefinitions(filters: ConversationTagFilters = {}) {
    try {
      return await this.repo.listDefinitions(filters);
    } catch (error) {
      throw toServiceError(error, '获取标签列表失败', 'DB_ERROR');
    }
  }

  async listForConversation(conversationId: string) {
    try {
      return await this.repo.listForConversation(conversationId);
    } catch (error) {
      throw toServiceError(error, '获取对话标签失败', 'DB_ERROR');
    }
  }

  async createDefinition(input: CreateTagInput) {
    if (!input.name) {
      throw toServiceError(
        new Error('validation'),
        '标签名不能为空',
        'VALIDATION_ERROR'
      );
    }

    try {
      return await this.repo.createDefinition(input);
    } catch (error) {
      const errorObj = error as { code?: string };
      if (errorObj.code === '23505') {
        throw toServiceError(
          new Error('duplicate'),
          '标签名已存在',
          'CONFLICT'
        );
      }
      throw toServiceError(error, '创建标签失败', 'DB_ERROR');
    }
  }

  async tagConversation(input: TagConversationInput) {
    try {
      const record = await this.repo.tagConversation(input);
      await this.repo.incrementConversationCount(input.tag_id);
      return record;
    } catch (error) {
      const errorObj = error as { code?: string };
      if (errorObj.code === '23505') {
        throw toServiceError(
          new Error('duplicate'),
          '该对话已拥有此标签',
          'CONFLICT'
        );
      }
      throw toServiceError(error, '打标签失败', 'DB_ERROR');
    }
  }

  async deleteDefinition(id: string) {
    try {
      await this.repo.deleteDefinition(id);
    } catch (error) {
      throw toServiceError(error, '删除标签失败', 'DB_ERROR');
    }
  }

  async deleteRecord(id: string) {
    try {
      await this.repo.deleteRecord(id);
    } catch (error) {
      throw toServiceError(error, '删除标签记录失败', 'DB_ERROR');
    }
  }
}
