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

  async createUser(input: CreateUserInput): Promise<{ user: unknown; tempPassword: string | null }> {
    if (!input.email || !input.name) {
      throw new ServiceError('邮箱和姓名不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const result = await this.users.create(input);
      return { user: result.user, tempPassword: result.tempPassword };
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

    // Check if trying to delete an admin
    const targetUser = await this.users.findById(id);
    if (targetUser?.role === 'admin') {
      // Count remaining admins
      const { users: admins } = await this.users.list({ role: 'admin' });
      if (admins.length <= 1) {
        throw new ServiceError('无法删除最后一个管理员，请先创建新管理员', {
          status: 403,
          code: 'LAST_ADMIN_PROTECTION',
        });
      }
    }

    try {
      await this.users.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除用户失败', 'DB_DELETE_ERROR');
    }
  }

  async deleteUsers(ids: string[]): Promise<{ deleted: number; protected: string[] }> {
    if (!ids.length) {
      throw new ServiceError('缺少用户 ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    // Get all admin users to check protection
    const { users: allAdmins } = await this.users.list({ role: 'admin' });
    const adminIds = new Set(allAdmins.map(u => u.id));

    // Separate deletable and protected IDs
    const deletableIds: string[] = [];
    const protectedIds: string[] = [];

    for (const id of ids) {
      if (adminIds.has(id) && adminIds.size <= 1) {
        // This is the last admin, protect it
        protectedIds.push(id);
      } else if (adminIds.has(id)) {
        // More than one admin, allow deletion
        deletableIds.push(id);
      } else {
        deletableIds.push(id);
      }
    }

    let deleted = 0;
    if (deletableIds.length > 0) {
      const result = await this.users.deleteMany(deletableIds);
      deleted = result.deleted;
    }

    return { deleted, protected: protectedIds };
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
