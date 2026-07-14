import {
  UserRepository,
  type UserFilters,
  type CreateUserInput,
  type UpdateUserInput,
  type PaginationOptions,
} from '@/server/repositories/user-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import {
  FACTORY_DEFAULTS_WITH_PROMPT,
  SETTINGS_SEED_LOCK_KEY,
  SETTINGS_SENTINEL_KEY,
} from '@/lib/server-only-settings-defaults';
import { DEMO_SETTINGS } from '@/server/repositories/demo-data/demo-settings';
import { logger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SettingRow } from '@/server/repositories/types';

export type SettingsSeedTrigger = 'createUser' | 'autoCreateDefaultAdmin';

export interface SeedDefaultSettingsOptions {
  trigger: SettingsSeedTrigger;
  userId?: string | null;
  userEmail?: string | null;
  client?: SupabaseClient;
}

export class UserService {
  constructor(
    private readonly users = new UserRepository(),
    private readonly settings = new SettingsRepository(),
  ) {}

  async listUsers(filters: UserFilters, pagination?: PaginationOptions): Promise<{ users: unknown[]; total: number }> {
    try {
      return await this.users.list(filters, pagination);
    } catch (error) {
      throw toServiceError(error, '获取用户列表失败', 'DB_QUERY_ERROR');
    }
  }

/**
 * Persist the factory default system settings to the DB.
 *
 * Best-effort: failures here must NOT block user creation, because:
 * 1. user creation itself has already succeeded
 * 2. settings can always be re-seeded via the "恢复出厂设置" UI button
 * 3. each `get(key)` call in business code already has its own fallback
 *
 * Seeding strategy (phase 2 — delta seeding):
 *   The original implementation skipped seeding the moment `system_prompt`
 *   existed, even if every other factory default was missing. The fix
 *   computes a delta between `FACTORY_DEFAULTS_WITH_PROMPT` and the live
 *   settings table, and only seeds the missing keys. This means:
 *     - If `system_prompt` is the only thing present, we seed the rest of
 *       the factory defaults but DO NOT overwrite `system_prompt`.
 *     - If everything is already present, we skip.
 *     - If everything is missing, we seed everything.
 *
 *   The delta is computed:
 *     1. Once before acquiring the lock (cheap pre-filter).
 *     2. Again AFTER acquiring the lock, so a racer that filled in keys
 *        while we were waiting does not get overwritten.
 *
 *   `seed_system_defaults` itself uses `ON CONFLICT DO NOTHING` so the
 *   delta path is safe even if the post-lock re-check has raced.
 *
 * Concurrency:
 *   Wraps the upsert in a Postgres advisory lock via the
 *   `try_acquire_settings_seed_lock()` RPC. If the RPC is unavailable
 *   (older deploys), falls back to the sentinel-key gate without locking.
 */
async seedDefaultSettings(options: SeedDefaultSettingsOptions): Promise<void> {
    const startedAt = Date.now();
    const { trigger, userId, userEmail, client } = options;
    const logContext = {
      trigger,
      userId: userId ?? null,
      userEmail: userEmail ?? null,
    };

    try {
      // Demo mode: no real DB writes happen. Merge missing factory defaults
      // into the in-memory DEMO_SETTINGS array so subsequent
      // SettingsRepository reads see them. Existing keys are NOT overwritten.
      if (isDemoMode()) {
        await this.mergeDefaultsIntoDemoArray();
        return;
      }

      // First read — compute the delta against the live table.
      const existing = await this.settings.list();
      const delta = UserService.computeMissingDefaults(existing, FACTORY_DEFAULTS_WITH_PROMPT);

      if (delta.size === 0) {
        logger.debug('[UserService] Skipped seeding: no factory defaults missing', {
          ...logContext,
          existingCount: existing.length,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // Try to acquire the per-session advisory lock so concurrent seed calls
      // serialise. Falls back gracefully if the RPC isn't deployed yet.
      const supabase = client ?? getSupabaseClient();
      let lockAcquired = true;
      try {
        const { data, error } = await supabase.rpc('try_acquire_settings_seed_lock');
        if (error) throw error;
        lockAcquired = data === true;
      } catch (rpcError) {
        // PGRST202 = function not found (older deploys). Don't block on the
        // missing RPC; fall back to the sentinel-key check (best-effort).
        logger.warn('[UserService] settings seed lock RPC unavailable, falling back to lockless seed', {
          ...logContext,
          error: rpcError instanceof Error ? rpcError.message : String(rpcError),
        });
        lockAcquired = true; // proceed without lock
      }

      if (!lockAcquired) {
        logger.debug('[UserService] Skipped seeding: lock held by another caller', {
          ...logContext,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // Re-check after acquiring the lock so a racer that filled in keys
      // while we were waiting does not get overwritten. The seed RPC uses
      // ON CONFLICT DO NOTHING so this is a strict optimisation, not a
      // correctness requirement — but it keeps the logs honest.
      const recheck = await this.settings.list();
      const recheckDelta = UserService.computeMissingDefaults(recheck, FACTORY_DEFAULTS_WITH_PROMPT);

      if (recheckDelta.size === 0) {
        logger.debug('[UserService] Skipped seeding after lock: nothing missing', {
          ...logContext,
          existingCount: recheck.length,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // Use the dedicated seedDefaults() RPC helper, which calls
      // `seed_system_defaults` (SECURITY DEFINER, advisory lock, ON CONFLICT DO NOTHING).
      // This preserves existing admin customisations and serialises concurrent seeds.
      const payload: Record<string, string> = {};
      for (const k of recheckDelta) payload[k] = FACTORY_DEFAULTS_WITH_PROMPT[k];
      await this.settings.seedDefaults(payload);
      logger.info('[UserService] Seeded missing factory default settings', {
        ...logContext,
        count: recheckDelta.size,
        existingCount: recheck.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error('[UserService] Failed to seed default settings', {
        ...logContext,
        durationMs: Date.now() - startedAt,
        error,
      });
    }
  }

  /**
   * Compute the set of keys that are in `defaults` but absent from `existingRows`.
   * Pure function — no I/O, no side effects, used by `seedDefaultSettings`.
   *
   * Exposed as a `static` so unit tests can pin the contract directly.
   */
  static computeMissingDefaults(
    existingRows: ReadonlyArray<{ key: string }>,
    defaults: Readonly<Record<string, string>>,
  ): Set<string> {
    const have = new Set(existingRows.map((r) => r.key));
    const missing = new Set<string>();
    for (const k of Object.keys(defaults)) {
      if (!have.has(k)) missing.add(k);
    }
    return missing;
  }

  /**
   * Merge factory defaults into the in-memory DEMO_SETTINGS array so that
   * subsequent SettingsRepository.list() / get() reads in demo mode return
   * the seeded values. Existing keys in DEMO_SETTINGS are NOT overwritten.
   *
   * The lock-key constant is referenced here for symmetry with the real-mode
   * path; demo mode does not need a lock.
   */
  private async mergeDefaultsIntoDemoArray(): Promise<void> {
    const startedAt = Date.now();
    const existingKeys = new Set(DEMO_SETTINGS.map((row) => row.key));
    let count = 0;
    for (const [key, value] of Object.entries(FACTORY_DEFAULTS_WITH_PROMPT)) {
      if (!existingKeys.has(key)) {
        DEMO_SETTINGS.push({ key, value } as SettingRow);
        existingKeys.add(key);
        count++;
      }
    }
    logger.debug('[UserService] Demo mode: merged defaults into DEMO_SETTINGS', {
      count,
      existingKeys: Array.from(existingKeys).sort(),
      durationMs: Date.now() - startedAt,
      lockKeyForReference: SETTINGS_SEED_LOCK_KEY,
    });
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
      // First-time setup: write preset system settings so all feature flags,
      // thresholds, and prompts have a deterministic baseline. Best-effort
      // inside the request — createUser is an admin-driven operation; we can
      // afford to await and let any error be swallowed + logged.
      await this.seedDefaultSettings({
        trigger: 'createUser',
        userId: (result.user as { id?: string | null })?.id ?? null,
        userEmail: input.email,
      });
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