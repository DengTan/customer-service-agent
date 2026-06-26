import {
  CustomerTagRepository,
  type CustomerTagFilters,
  type CreateCustomerTagInput,
  type UpdateCustomerTagInput,
} from '@/server/repositories/customer-tag-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class CustomerTagService {
  constructor(private readonly tags = new CustomerTagRepository()) {}

  async listTags(_filters: CustomerTagFilters = {}): Promise<unknown[]> {
    try {
      return await this.tags.list(_filters);
    } catch (error) {
      throw toServiceError(error, '获取标签列表失败', 'DB_QUERY_ERROR');
    }
  }

  async createTag(input: CreateCustomerTagInput): Promise<unknown> {
    if (!input.name) {
      throw new ServiceError('标签名称不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.tags.create(input);
    } catch (error) {
      if (error instanceof ServiceError) throw error;

      const repoError = error as { message?: string };
      if (repoError.message?.includes('23505')) {
        throw new ServiceError('标签名称已存在', {
          status: 409,
          code: 'DUPLICATE',
        });
      }

      throw toServiceError(error, '创建标签失败', 'DB_INSERT_ERROR');
    }
  }

  async updateTag(input: UpdateCustomerTagInput): Promise<unknown> {
    if (!input.id) {
      throw new ServiceError('缺少标签 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.tags.update(input);
    } catch (error) {
      throw toServiceError(error, '更新标签失败', 'DB_UPDATE_ERROR');
    }
  }

  async deleteTag(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少标签 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const isSystem = await this.tags.isSystemTag(id);
      if (isSystem) {
        throw new ServiceError('系统内置标签不可删除', {
          status: 403,
          code: 'FORBIDDEN',
        });
      }

      await this.tags.delete(id);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '删除标签失败', 'DB_DELETE_ERROR');
    }
  }
}
