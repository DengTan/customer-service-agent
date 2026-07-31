import {
  PermissionRepository,
  type PermissionEntry,
  type PermissionFilters,
} from '@/server/repositories/permission-repository';
import { toServiceError } from './service-utils';
import type { UserRole, PermissionResource, PermissionAction, RolePermission } from '@/lib/types';
import { DEFAULT_PERMISSIONS } from '@/config/default-permissions';
import { logger } from '@/lib/logger';
import { PERMISSION } from '@/lib/constants';

export { DEFAULT_PERMISSIONS } from '@/config/default-permissions';

// Permission cache with version-based invalidation for better concurrency handling
interface CacheEntry {
  value: boolean;
  expiresAt: number;
  version: number;
}
const permissionCache = new Map<string, CacheEntry>();
let cacheVersion = 0;

// Permission cache key format: `${role}:${resource}:${action}`
function getCacheKey(role: string, resource: string, action: string): string {
  return `${role}:${resource}:${action}`;
}

function clearPermissionCache(): void {
  permissionCache.clear();
  cacheVersion++;
}

export class PermissionService {
  constructor(private readonly repo = new PermissionRepository()) {}

  async listPermissions(_filters: PermissionFilters = {}): Promise<RolePermission[]> {
    try {
      return await this.repo.list() as RolePermission[];
    } catch (error) {
      throw toServiceError(error, '获取权限列表失败', 'DB_ERROR');
    }
  }

  async updatePermissions(permissions: PermissionEntry[]): Promise<unknown[]> {
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
      // Only clear cache after all permissions are successfully updated
      clearPermissionCache();
      return results;
    } catch (error) {
      // Do NOT clear cache on error - DB transaction rolled back, cache still valid
      throw toServiceError(error, '更新权限失败', 'DB_ERROR');
    }
  }

  async checkPermission(
    role: UserRole,
    resource: PermissionResource,
    action: PermissionAction,
  ): Promise<boolean> {
    const cacheKey = getCacheKey(role, resource, action);
    const now = Date.now();
    const currentVersion = cacheVersion;

    // Check cache first (with version validation)
    const cached = permissionCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.version === currentVersion) {
      return cached.value;
    }

    try {
      const row = await this.repo.findByRoleAndResource(role, resource, action);
      const allowed = row !== null ? row.allowed : (DEFAULT_PERMISSIONS[role]?.[resource]?.[action] ?? false);

      // Cache the result with current version
      permissionCache.set(cacheKey, {
        value: allowed,
        expiresAt: now + PERMISSION.CACHE_TTL_MS,
        version: currentVersion,
      });

      return allowed;
    } catch {
      // On DB error, deny by default (fail-secure)
      return false;
    }
  }

  /** Invalidate all cached permissions (call after permission updates) */
  clearCache(): void {
    clearPermissionCache();
  }
}
