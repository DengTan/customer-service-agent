import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { UserRow, UserWithPassword } from './types';
import { toUserRow } from './types';

export interface UserFilters {
  role?: string;
  status?: string;
  search?: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role?: string;
  avatar?: string | null;
}

export interface UpdateUserInput {
  id: string;
  role?: string;
  status?: string;
  name?: string;
  avatar?: string | null;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export class UserRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: UserFilters = {}, pagination?: PaginationOptions): Promise<{ users: UserRow[]; total: number }> {
    if (isDemoMode()) {
      const demoUsers: UserRow[] = [
        { id: 'demo-user-1', email: 'admin@smartassist.com', name: '张经理', role: 'admin', status: 'active', avatar: null, last_active_at: '2026-06-10T08:00:00Z', created_at: '2026-01-01T00:00:00Z' } as UserRow,
        { id: 'demo-user-2', email: 'agent1@smartassist.com', name: '李小红', role: 'agent', status: 'active', avatar: null, last_active_at: '2026-06-10T09:30:00Z', created_at: '2026-02-15T00:00:00Z' } as UserRow,
        { id: 'demo-user-3', email: 'agent2@smartassist.com', name: '王大明', role: 'agent', status: 'active', avatar: null, last_active_at: '2026-06-09T17:00:00Z', created_at: '2026-03-01T00:00:00Z' } as UserRow,
        { id: 'demo-user-4', email: 'observer@smartassist.com', name: '赵观察', role: 'observer', status: 'inactive', avatar: null, last_active_at: '2026-05-20T10:00:00Z', created_at: '2026-04-10T00:00:00Z' } as UserRow,
      ];
      let filtered = demoUsers;
      if (filters.role) filtered = filtered.filter(u => u.role === filters.role);
      if (filters.status) filtered = filtered.filter(u => u.status === filters.status);
      if (filters.search) { const q = filters.search.toLowerCase(); filtered = filtered.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)); }
      
      // Apply pagination in demo mode
      if (pagination) {
        const start = (pagination.page - 1) * pagination.pageSize;
        const end = start + pagination.pageSize;
        filtered = filtered.slice(start, end);
      }
      return { users: filtered, total: demoUsers.length };
    }
    
    let query = this.client
      .from('users')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true });

    if (filters.role) {
      query = query.eq('role', filters.role);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.search) {
      const escaped = filters.search.replace(/[%_\\]/g, (ch) => `\\${ch}`);
      query = query.or(`name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
    }

    // Apply pagination
    if (pagination) {
      const from = (pagination.page - 1) * pagination.pageSize;
      const to = from + pagination.pageSize - 1;
      query = query.range(from, to);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new RepositoryError('list users', error.message, error.code);
    }

    return { users: data ?? [], total: count ?? 0 };
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    if (isDemoMode()) return { id: 'demo-user-new', email: input.email, name: input.name, role: input.role ?? 'agent', status: 'active', avatar: input.avatar ?? null, last_active_at: new Date().toISOString(), created_at: new Date().toISOString() } as UserRow;
    const { data, error } = await this.client
      .from('users')
      .insert({
        email: input.email,
        name: input.name,
        role: input.role ?? 'agent',
        avatar: input.avatar ?? null,
        status: 'active',
        last_active_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create user', error.message, error.code);
    }

    return toUserRow(data);
  }

  async update(input: UpdateUserInput): Promise<UserRow> {
    if (isDemoMode()) return { id: input.id, email: 'demo@demo.com', name: input.name ?? 'Demo', role: input.role ?? 'agent', status: input.status ?? 'active', avatar: input.avatar ?? null, last_active_at: new Date().toISOString(), created_at: '2026-01-01T00:00:00Z' } as UserRow;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.role !== undefined) updates.role = input.role;
    if (input.status !== undefined) updates.status = input.status;
    if (input.name !== undefined) updates.name = input.name;
    if (input.avatar !== undefined) updates.avatar = input.avatar;

    const { data, error } = await this.client
      .from('users')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('update user', error.message, error.code);
    }

    return toUserRow(data);
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('users').delete().eq('id', id);

    if (error) {
      throw new RepositoryError('delete user', error.message, error.code);
    }
  }

  async deleteMany(ids: string[]): Promise<{ deleted: number }> {
    if (isDemoMode()) return { deleted: ids.length };
    const { error, count } = await this.client
      .from('users')
      .delete()
      .in('id', ids);

    if (error) {
      throw new RepositoryError('delete many users', error.message, error.code);
    }

    return { deleted: count ?? ids.length };
  }

  async updateStatusMany(ids: string[], status: string): Promise<{ updated: number }> {
    if (isDemoMode()) return { updated: ids.length };
    const { error, count } = await this.client
      .from('users')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (error) {
      throw new RepositoryError('update many users status', error.message, error.code);
    }

    return { updated: count ?? ids.length };
  }

  async findById(id: string): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new RepositoryError('find user by id', error.message, error.code);
    }

    return data ? toUserRow(data) : null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find user by email', error.message, error.code);
    }

    return data ? toUserRow(data) : null;
  }

  /**
   * Find user by email including password_hash (for authentication)
   */
  async findByEmailWithPassword(email: string): Promise<UserWithPassword | null> {
    // First, try to find user in database
    const { data, error } = await this.client
      .from('users')
      .select('id, email, name, avatar, role, status, password_hash, last_active_at, created_at')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find user by email with password', error.message, error.code);
    }

    // If user exists in database, return it
    if (data) {
      return data as UserWithPassword | null;
    }

    // User not found in database - check if it's a predefined default user
    // This provides a seamless demo experience in production environments
    const defaultUsers: UserWithPassword[] = [
      { id: 'default-admin', email: 'admin@smartassist.com', name: '管理员', role: 'admin', status: 'active', avatar: null, password_hash: '$2b$12$msD8Rfc1NocnaeImZFvhuug0OpjVHusSp9wTjX5Vy4vnmqNunoiCS', last_active_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ];

    const defaultUser = defaultUsers.find(u => u.email === email);
    if (defaultUser) {
      // Auto-create this user in the database with the default password
      try {
        const { error: insertError } = await this.client
          .from('users')
          .insert({
            id: defaultUser.id,
            email: defaultUser.email,
            name: defaultUser.name,
            role: defaultUser.role,
            status: defaultUser.status,
            avatar: defaultUser.avatar,
            password_hash: defaultUser.password_hash,
            last_active_at: defaultUser.last_active_at,
            created_at: defaultUser.created_at,
          });
        
        if (!insertError) {
          return defaultUser;
        }
      } catch {
        // If auto-create fails, still return the default user for authentication
        return defaultUser;
      }
    }

    return null;
  }

  /**
   * Update user password hash
   */
  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const { error } = await this.client
      .from('users')
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      throw new RepositoryError('update password', error.message, error.code);
    }
  }
}
