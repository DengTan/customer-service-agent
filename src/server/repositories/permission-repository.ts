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
      const roles = ['admin', 'agent', 'observer'] as const;
      const resources = ['conversations', 'knowledge', 'settings', 'team', 'customers', 'analytics', 'tickets', 'marketing'] as const;
      const actions = ['read', 'write', 'delete'] as const;
      const result: { role: string; resource: string; action: string; allowed: boolean }[] = [];
      for (const role of roles) {
        for (const resource of resources) {
          for (const action of actions) {
            const allowed =
              role === 'admin'
                ? true
                : role === 'agent'
                  ? action !== 'delete'
                  : action === 'read';
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

    const { role, resource, action, allowed } = permission;
    const now = new Date().toISOString();

    // Try to update existing row first
    const { data: existing } = await this.client
      .from('role_permissions')
      .select('id')
      .eq('role', role)
      .eq('resource', resource)
      .eq('action', action)
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data, error } = await this.client
        .from('role_permissions')
        .update({ allowed, updated_at: now })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new RepositoryError('upsert permission', error.message, error.code);
      return data;
    } else {
      // Insert new
      const { data, error } = await this.client
        .from('role_permissions')
        .insert({ role, resource, action, allowed, updated_at: now })
        .select()
        .single();

      if (error) throw new RepositoryError('upsert permission', error.message, error.code);
      return data;
    }
  }

  async findByRoleAndResource(
    role: string,
    resource: string,
    action: string,
  ): Promise<{ allowed: boolean } | null> {
    if (isDemoMode()) {
      // Demo mode: no DB query, return null to fall back to defaults
      return null;
    }
    const { data, error } = await this.client
      .from('role_permissions')
      .select('allowed')
      .eq('role', role)
      .eq('resource', resource)
      .eq('action', action)
      .limit(1)
      .maybeSingle();

    if (error) throw new RepositoryError('findByRoleAndResource', error.message, error.code);
    return data as { allowed: boolean } | null;
  }
}
