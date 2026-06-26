import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface PermissionEntry {
  role: string;
  resource: string;
  action: string;
  allowed: boolean;
}

export interface PermissionFilters {
  [key: string]: unknown;
}

export class PermissionRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(_filters: PermissionFilters = {}): Promise<unknown[]> {
    if (isDemoMode()) {
      const resources = ['conversations', 'knowledge', 'settings', 'customers', 'tickets', 'analytics'];
      const actions = ['view', 'create', 'update', 'delete'];
      const result: unknown[] = [];
      for (const role of ['admin', 'agent', 'observer']) {
        for (const resource of resources) {
          for (const action of actions) {
            const allowed = role === 'admin' ? true : role === 'agent' ? action !== 'delete' : action === 'view';
            result.push({ role, resource, action, allowed });
          }
        }
      }
      return result;
    }
    const { data, error } = await this.client
      .from('role_permissions')
      .select('*')
      .order('role', { ascending: true });

    if (error) throw new RepositoryError('list permissions', error.message, error.code);
    return data ?? [];
  }

  async upsert(permission: PermissionEntry): Promise<unknown> {
    if (isDemoMode()) return permission;
    const { data, error } = await this.client
      .from('role_permissions')
      .upsert(
        {
          role: permission.role,
          resource: permission.resource,
          action: permission.action,
          allowed: permission.allowed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'role,resource,action' }
      )
      .select()
      .single();

    if (error) throw new RepositoryError('upsert permission', error.message, error.code);
    return data;
  }
}
