import {
  PermissionRepository,
  type PermissionEntry,
  type PermissionFilters,
} from '@/server/repositories/permission-repository';
import { toServiceError } from './service-utils';

export class PermissionService {
  constructor(private readonly repo = new PermissionRepository()) {}

  async listPermissions(_filters: PermissionFilters = {}) {
    try {
      return await this.repo.list();
    } catch (error) {
      throw toServiceError(error, '获取权限列表失败', 'DB_ERROR');
    }
  }

  async updatePermissions(permissions: PermissionEntry[]) {
    if (!permissions || !Array.isArray(permissions)) {
      throw toServiceError(
        new Error('validation'),
        '权限数据格式无效',
        'VALIDATION_ERROR'
      );
    }

    try {
      const results = [];
      for (const perm of permissions) {
        const result = await this.repo.upsert(perm);
        results.push(result);
      }
      return results;
    } catch (error) {
      throw toServiceError(error, '更新权限失败', 'DB_ERROR');
    }
  }
}
