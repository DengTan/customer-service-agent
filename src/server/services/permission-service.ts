import {
  PermissionRepository,
  type PermissionEntry,
  type PermissionFilters,
} from '@/server/repositories/permission-repository';
import { toServiceError } from './service-utils';
import type { UserRole, PermissionResource, PermissionAction } from '@/lib/types';
import { DEFAULT_PERMISSIONS } from '@/config/default-permissions';

export { DEFAULT_PERMISSIONS } from '@/config/default-permissions';

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

  async checkPermission(
    role: UserRole,
    resource: PermissionResource,
    action: PermissionAction,
  ): Promise<boolean> {
    try {
      const row = await this.repo.findByRoleAndResource(role, resource, action);
      if (row !== null) return row.allowed;
      // Fall back to defaults when no DB row exists
      return DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false;
    } catch {
      // On DB error, deny by default (fail-secure)
      return false;
    }
  }
}
