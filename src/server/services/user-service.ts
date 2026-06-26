import {
  UserRepository,
  type UserFilters,
  type CreateUserInput,
  type UpdateUserInput,
  type PaginationOptions,
} from '@/server/repositories/user-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class UserService {
  constructor(private readonly users = new UserRepository()) {}

  async listUsers(filters: UserFilters, pagination?: PaginationOptions): Promise<{ users: unknown[]; total: number }> {
    try {
      return await this.users.list(filters, pagination);
    } catch (error) {
      throw toServiceError(error, '获取用户列表失败', 'DB_QUERY_ERROR');
    }
  }

  async createUser(input: CreateUserInput): Promise<unknown> {
    if (!input.email || !input.name) {
      throw new ServiceError('邮箱和姓名不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.users.create(input);
    } catch (error) {
      if (error instanceof ServiceError) throw error;

      const repoError = error as { message?: string };
      if (repoError.message?.includes('23505')) {
        throw new ServiceError('该邮箱已存在', {
          status: 409,
          code: 'DUPLICATE',
        });
      }

      throw toServiceError(error, '创建用户失败', 'DB_INSERT_ERROR');
    }
  }

  async updateUser(input: UpdateUserInput): Promise<unknown> {
    if (!input.id) {
      throw new ServiceError('缺少用户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.users.update(input);
    } catch (error) {
      throw toServiceError(error, '更新用户失败', 'DB_UPDATE_ERROR');
    }
  }

  async deleteUser(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少用户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      await this.users.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除用户失败', 'DB_DELETE_ERROR');
    }
  }

  async deleteUsers(ids: string[]): Promise<{ deleted: number }> {
    if (!ids.length) {
      throw new ServiceError('缺少用户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.users.deleteMany(ids);
    } catch (error) {
      throw toServiceError(error, '批量删除用户失败', 'DB_DELETE_ERROR');
    }
  }

  async updateUsersStatus(ids: string[], status: string): Promise<{ updated: number }> {
    if (!ids.length) {
      throw new ServiceError('缺少用户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      return await this.users.updateStatusMany(ids, status);
    } catch (error) {
      throw toServiceError(error, '批量更新状态失败', 'DB_UPDATE_ERROR');
    }
  }

  async getUser(id: string): Promise<unknown | null> {
    try {
      return await this.users.findById(id);
    } catch (error) {
      throw toServiceError(error, '获取用户详情失败', 'DB_QUERY_ERROR');
    }
  }
}
