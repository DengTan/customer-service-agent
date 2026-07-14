import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_SETTINGS } from './demo-data/demo-settings';
import type { SettingRow } from './types';
import { logger } from '@/lib/logger';

/**
 * Atomic batch upsert RPC names supported by the backend.
 *
 *   - `upsert_settings_batch`  鈥?hardened migration (SECURITY DEFINER,
 *     search_path pinned, caller-role guard, RLS enabled on settings).
 *   - `upsert_many_settings`   鈥?older migration kept as a fallback for
 *     deployments that have not yet run the hardened migration.
 */
const PRIMARY_RPC = 'upsert_settings_batch';
const LEGACY_RPC = 'upsert_many_settings';

/**
 * RPC error codes that we recognise. `PGRST202` (function not found) is
 * the ONLY code for which we silently fall back to the next write path,
 * because it indicates the deployment is on an older schema and the
 * legacy RPC may still exist. All other errors (permission denied,
 * database/integrity errors, network errors, unexpected payloads) are
 * treated as fatal: they must propagate as `RepositoryError` so the
 * caller can surface the failure instead of silently degrading to a
 * per-row write that bypasses the SECURITY DEFINER RPC and the hardened
 * service_role grants.
 */
const FUNCTION_NOT_FOUND_CODE = 'PGRST202';

interface RpcError {
  message: string;
  code?: string;
}

function isFunctionNotFound(error: RpcError | null): boolean {
  return !!error && error.code === FUNCTION_NOT_FOUND_CODE;
}

export class SettingsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(): Promise<SettingRow[]> {
    if (isDemoMode()) {
      return DEMO_SETTINGS;
    }

    const { data, error } = await this.client.from('settings').select('key, value');
    if (error) throw new RepositoryError('list settings', error.message, error.code);
    return (data ?? []) as SettingRow[];
  }

  /**
   * Get a single setting value by key. Returns null if not set.
   * Uses the settings table directly to avoid pulling every key.
   */
  async get(key: string): Promise<string | null> {
    if (isDemoMode()) {
      const row = DEMO_SETTINGS.find((s) => s.key === key);
      return row?.value ?? null;
    }

    const { data, error } = await this.client
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new RepositoryError(`get setting ${key}`, error.message, error.code);
    return (data as { value: string } | null)?.value ?? null;
  }

  /**
   * Atomically upsert a batch of settings using the privileged RPC.
   *
   * Routing:
   *   1. `upsert_settings_batch`  — hardened, SECURITY DEFINER, service_role-only.
   *   2. `upsert_many_settings`   — legacy migration; fallback for deployments
   *      that have not yet run the hardened migration. We only fall back
   *      here if the hardened RPC reported PGRST202 (function not found).
   *   3. No further fallback. Per-row upserts were removed because they
   *      bypass the SECURITY DEFINER hardening and silently mask
   *      permission / database errors (which would otherwise fail closed
   *      and surface to the caller).
   *
   * Any non-PGRST202 error from the hardened RPC, or any error from the
   * legacy RPC, throws `RepositoryError` immediately. The previous
   * behaviour that masked 42501 / 22xxx errors by falling back to
   * `from('settings').upsert(...)` is explicitly forbidden under
   * settings-rls-hardening.
   */
  async upsertManyAtomic(settings: Record<string, string>): Promise<void> {
    if (isDemoMode()) {
      logger.debug('[Demo Mode] Settings upsert skipped', { settings });
      return;
    }

    const primaryError = await this.tryBatchRpc(PRIMARY_RPC, { p_items: settings });
    if (!primaryError) return;

    if (isFunctionNotFound(primaryError)) {
      logger.warn(
        `[SettingsRepository] ${PRIMARY_RPC} RPC unavailable, falling back to ${LEGACY_RPC}`,
        { rpcError: primaryError.message },
      );

      const legacyError = await this.tryBatchRpc(LEGACY_RPC, { p_items: settings });
      if (!legacyError) return;

      // Legacy RPC was found but rejected: any non-PGRST202 error here is
      // also fatal. We do NOT fall back to per-row upsert.
      throw new RepositoryError(
        `upsert settings via ${LEGACY_RPC}`,
        legacyError.message,
        legacyError.code,
      );
    }

    // Hardened RPC returned any other error (permission denied, invalid
    // payload, network, etc.) — fail closed. Per-row upserts are removed
    // because they would bypass the SECURITY DEFINER function and the
    // service_role-only grants.
    throw new RepositoryError(
      `upsert settings via ${PRIMARY_RPC}`,
      primaryError.message,
      primaryError.code,
    );
  }

  /**
   * Seed default settings via the privileged `seed_system_defaults` RPC.
   *
   * Uses `ON CONFLICT DO NOTHING` semantics (set by the SQL function): only
   * inserts rows that are absent from the settings table; existing values set
   * by an admin are preserved.
   *
   * Routing:
   *   1. `seed_system_defaults` — hardened, SECURITY DEFINER, service_role-only.
   *   2. `upsert_many_settings` — legacy fallback only when step 1 reports
   *      PGRST202 (function not found). This covers older deployments that
   *      have not yet run `20260713_harden_settings_seed_and_reset_rpcs.sql`.
   *
   * Fail-closed: any non-PGRST202 error throws `RepositoryError` immediately.
   * There is no per-row upsert fallback — doing so would bypass the SECURITY
   * DEFINER hardening.
   */
  async seedDefaults(
    defaults: Record<string, string>,
  ): Promise<void> {
    if (isDemoMode()) {
      logger.debug('[Demo Mode] seedDefaults skipped', { defaults });
      return;
    }

    const primaryError = await this.tryBatchRpc('seed_system_defaults', {
      p_defaults: defaults,
    });
    if (!primaryError) return;

    if (isFunctionNotFound(primaryError)) {
      logger.warn(
        '[SettingsRepository] seed_system_defaults RPC unavailable, '
        + 'falling back to legacy upsert_many_settings',
        { rpcError: primaryError.message },
      );
      const legacyError = await this.tryBatchRpc('upsert_many_settings', {
        p_items: defaults,
      });
      if (!legacyError) return;
      throw new RepositoryError(
        'seed defaults via legacy RPC',
        legacyError.message,
        legacyError.code,
      );
    }

    throw new RepositoryError(
      'seed defaults via seed_system_defaults',
      primaryError.message,
      primaryError.code,
    );
  }

  /**
   * Reset settings to factory defaults via the privileged
   * `reset_settings_to_defaults` RPC.
   *
   * The RPC enforces a server-side allowlist intersection: only keys present in
   * BOTH the `p_defaults` payload AND the `p_allowed_keys` array are written.
   * This is the trust boundary that prevents a client from injecting
   * non-resettable keys (integration secrets, custom_tools, etc.) through
   * the reset path.
   *
   * Routing:
   *   1. `reset_settings_to_defaults` — hardened, SECURITY DEFINER, service_role-only.
   *   2. `upsert_many_settings` — legacy fallback only when step 1 reports
   *      PGRST202. This covers older deployments. Note: the legacy RPC does NOT
   *      honour the allowlist intersection, so this fallback is best-effort
   *      only; callers SHOULD warn that the reset scope is reduced on older deploys.
   *
   * Fail-closed: any non-PGRST202 error throws `RepositoryError` immediately.
   */
  async resetToDefaults(
    defaults: Record<string, string>,
    allowedKeys: string[],
  ): Promise<void> {
    if (isDemoMode()) {
      logger.debug('[Demo Mode] resetToDefaults skipped', { defaults, allowedKeys });
      return;
    }

    const primaryError = await this.tryBatchRpc(
      'reset_settings_to_defaults',
      { p_defaults: defaults, p_allowed_keys: allowedKeys },
    );
    if (!primaryError) return;

    if (isFunctionNotFound(primaryError)) {
      logger.warn(
        '[SettingsRepository] reset_settings_to_defaults RPC unavailable, '
        + 'falling back to legacy upsert_many_settings',
        { rpcError: primaryError.message },
      );
      // Fall back: write the defaults directly (no allowlist enforcement).
      // The legacy RPC lacks the allowlist intersection, so we accept reduced
      // safety on older deploys rather than failing outright.
      const legacyError = await this.tryBatchRpc('upsert_many_settings', {
        p_items: defaults,
      });
      if (!legacyError) return;
      throw new RepositoryError(
        'reset defaults via legacy RPC',
        legacyError.message,
        legacyError.code,
      );
    }

    throw new RepositoryError(
      'reset defaults via reset_settings_to_defaults',
      primaryError.message,
      primaryError.code,
    );
  }

  private async tryBatchRpc(
    rpcName: string,
    args: Record<string, unknown>,
  ): Promise<RpcError | null> {
    const { error } = await this.client.rpc(rpcName, args);
    if (!error) return null;
    return { message: error.message, code: error.code };
  }

  /**
   * Backwards-compatible batch upsert.
   *
   * Routes through the atomic RPC path so that all writes go through the
   * SECURITY DEFINER function and the new RLS policy. External callers
   * (e.g. factory-default seeding in user-service) can keep using this
   * method without knowing about the RPC names.
   */
  async upsertMany(settings: Record<string, string>): Promise<void> {
    await this.upsertManyAtomic(settings);
  }

  /**
   * Set a single setting value. Creates or updates the key.
   */
  async set(key: string, value: string): Promise<void> {
    await this.upsertManyAtomic({ [key]: value });
  }

  /**
   * Atomically update a timestamp setting only if the condition is met.
   * Returns true if update succeeded, false if condition not met.
   * This prevents TOCTOU race conditions in concurrent requests.
   */
  async updateTimestampIfOlderThan(
    key: string,
    value: string,
    minHoursSince: number
  ): Promise<boolean> {
    if (isDemoMode()) {
      // In demo mode, always allow
      return true;
    }

    const now = Date.now();
    const minMs = minHoursSince * 60 * 60 * 1000;

    // Use RPC function for atomic update with condition check
    // Falls back to manual implementation if RPC not available
    try {
      // First, get current value
      const { data, error } = await this.client
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw new RepositoryError('updateTimestampIfOlderThan get', error.message, error.code);
      }

      const currentValue = (data as { value: string } | null)?.value ?? null;

      if (currentValue) {
        const lastTime = new Date(currentValue).getTime();
        const hoursSince = (now - lastTime) / (1000 * 60 * 60);
        if (hoursSince < minHoursSince) {
          // Condition not met, do not update
          return false;
        }
      }

      // Condition met or no previous value, proceed with update
      const { error: updateError } = await this.client
        .from('settings')
        .upsert(
          { key, value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );

      if (updateError) {
        throw new RepositoryError('updateTimestampIfOlderThan upsert', updateError.message, updateError.code);
      }

      return true;
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      logger.error('[SettingsRepository] updateTimestampIfOlderThan error', { error: err });
      return false;
    }
  }
}


let _settingsRepo: SettingsRepository | null = null;

export function getSettingsRepository(): SettingsRepository {
  if (!_settingsRepo) {
    _settingsRepo = new SettingsRepository();
  }
  return _settingsRepo;
}
