import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { hashPassword } from '@/lib/auth/password';
import crypto from 'crypto';
import type { UserRow, UserWithPassword } from './types';
import { toUserRow } from './types';
import { logger } from '@/lib/logger';

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
  password?: string; // Optional, will auto-generate if not provided
}

export interface CreateUserResult {
  user: UserRow;
  tempPassword: string | null; // Plain text password for new user, null in demo mode
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

/**
 * Result of `findByEmailWithPassword`. `wasAutoCreated` is true if the
 * caller should treat this as a first-time login (e.g. fire-and-forget
 * `UserService.seedDefaultSettings`). The default-admin path is the only
 * known auto-create case.
 */
export interface FindByEmailWithPasswordResult {
  user: UserWithPassword;
  wasAutoCreated: boolean;
}

/**
 * Built-in default user that should always be available even on a fresh DB.
 * Returned by `findByEmailWithPassword` and auto-inserted on first login.
 */
export const DEFAULT_ADMIN_ID = 'default-admin';
export const DEFAULT_ADMIN_EMAIL = 'admin@smartassist.com';

/**
 * Generate a secure random password that meets strength requirements
 * Requires: uppercase, lowercase, and digit
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Avoid confusing chars
  const lower = 'abcdefghjkmnpqrstuvwxyz';  // Avoid ambiguous chars
  const digits = '23456789';               // Avoid 0/O, 1/I confusion

  const randomUpper = upper[crypto.randomInt(upper.length)];
  const randomLower = lower[crypto.randomInt(lower.length)];
  const randomDigit = digits[crypto.randomInt(digits.length)];
  const randomRest = crypto.randomBytes(11).toString('base64url').slice(0, 11);

  // Shuffle characters
  const chars = [randomUpper, randomLower, randomDigit, ...randomRest];
  const shuffled = chars.sort(() => crypto.randomInt(2) - 0.5);
  return shuffled.join('');
}

export class UserRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: UserFilters = {}, pagination?: PaginationOptions): Promise<{ users: UserRow[]; total: number }> {
    if (isDemoMode()) {
      const demoUsers: UserRow[] = [
        { id: 'demo-user-1', email: 'admin@smartassist.com', name: '张经理', role: 'admin', status: 'active', avatar: null, last_active_at: '2026-06-10T08:00:00Z', created_at: '2026-01-01T00:00:00Z' } as UserRow,
        { id: 'demo-user-2', email: 'agent1@smartassist.com', name: '李小红', role: 'agent', status: 'active', avatar: null, last_active_at: '2026-06-10T09:30:00Z', created_at: '2026-02-15T00:00:00Z' } as UserRow,
        { id: 'demo-user-3', email: 'agent2@smartassist.com', name: '王大明', role: 'agent', status: 'active', avatar: null, last_active_at: '2026-06-09T17:00:00Z', created_at: '2026-03-01T00:00:00Z' } as UserRow,
        { id: 'demo-user-4', email: 'observer@smartassist.com', name: '赵观察', role: 'observer', status: 'disabled', avatar: null, last_active_at: '2026-05-20T10:00:00Z', created_at: '2026-04-10T00:00:00Z' } as UserRow,
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

  async create(input: CreateUserInput): Promise<CreateUserResult> {
    if (isDemoMode()) {
      const demoUser = { id: 'demo-user-new', email: input.email, name: input.name, role: input.role ?? 'agent', status: 'active', avatar: input.avatar ?? null, last_active_at: new Date().toISOString(), created_at: new Date().toISOString() } as UserRow;
      return { user: demoUser, tempPassword: null };
    }

    // Generate temporary password if not provided
    const tempPassword = input.password ?? generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const { data, error } = await this.client
      .from('users')
      .insert({
        email: input.email,
        name: input.name,
        role: input.role ?? 'agent',
        avatar: input.avatar ?? null,
        status: 'active',
        password_hash: passwordHash,
        last_active_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create user', error.message, error.code);
    }

    return { user: toUserRow(data), tempPassword };
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
   * Find user by email including password_hash (for authentication).
   *
   * If the user does not exist in the database but matches a built-in
   * default account (currently the default admin), it is auto-inserted so
   * that operators always have a way in on a fresh deploy. The returned
   * `wasAutoCreated` flag lets the caller (login route) trigger side-effects
   * like seeding default system settings without polluting this layer with
   * cross-repository dependencies.
   */
  async findByEmailWithPassword(email: string): Promise<FindByEmailWithPasswordResult | null> {
    // First, try to find user in database
    const { data, error } = await this.client
      .from('users')
      .select('id, email, name, avatar, role, status, password_hash, last_active_at, created_at')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find user by email with password', error.message, error.code);
    }

    // If user exists in database, return it (no auto-create happened)
    if (data) {
      return { user: data as UserWithPassword, wasAutoCreated: false };
    }

    // User not found in database - check if it's a predefined default user
    // This provides a seamless demo experience in production environments
    const defaultUsers: UserWithPassword[] = [
      { id: DEFAULT_ADMIN_ID, email: DEFAULT_ADMIN_EMAIL, name: '管理员', role: 'admin', status: 'active', avatar: null, password_hash: '$2b$12$msD8Rfc1NocnaeImZFvhuug0OpjVHusSp9wTjX5Vy4vnmqNunoiCS', last_active_at: new Date().toISOString(), created_at: new Date().toISOString() },
    ];

    const defaultUser = defaultUsers.find(u => u.email === email);
    if (!defaultUser) {
      return null;
    }

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
        return { user: defaultUser, wasAutoCreated: true };
      }
      // If the auto-create insert itself failed (e.g. unique violation from a
      // concurrent request that won the race), still authenticate using the
      // default credentials but report `wasAutoCreated: false` so the caller
      // doesn't double-seed.
      logger.warn('[UserRepository] Default admin auto-create insert failed', {
        email,
        error: insertError.message,
        code: insertError.code,
      });
      return { user: defaultUser, wasAutoCreated: false };
    } catch (err) {
      logger.error('[UserRepository] Default admin auto-create threw', {
        email,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall back to authenticating with the default credentials so the
      // operator is not locked out.
      return { user: defaultUser, wasAutoCreated: false };
    }
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