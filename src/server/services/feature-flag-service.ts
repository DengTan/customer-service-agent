import assert from 'node:assert/strict';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { createBoundedCache, type BoundedCache } from '@/lib/bounded-cache';

// Feature flag key constants
export const FEATURE_FLAG_KEYS = [
  'EVAL_CALIBRATION',
  'EVAL_SHADOW',
  'EVAL_CANARY',
  'EVAL_AUTO_REGRESSION',
  'EVAL_CONTINUOUS',
  'EVAL_SHADOW_TRAFFIC_PCT',
] as const;

export type FeatureFlagKey = typeof FEATURE_FLAG_KEYS[number];

// Default flag values
const DEFAULT_FLAG_VALUES: Record<string, string> = {
  EVAL_CALIBRATION: 'false',
  EVAL_SHADOW: 'false',
  EVAL_CANARY: 'false',
  EVAL_AUTO_REGRESSION: 'false',
  EVAL_CONTINUOUS: 'false',
  EVAL_SHADOW_TRAFFIC_PCT: '10',
};

// V-1 FIX: Replace the hand-rolled `Map + _cacheLoadedAt + TTL` pattern
// with `createBoundedCache`. 60s TTL matches `customer-service.ts:listCustomers`.
// maxSize=200 covers the 6 known EVAL_* keys with room for growth.
// Invalidation is done via `cache.invalidateAll()` (not `_cacheLoadedAt = 0`).
const _flagCache: BoundedCache<string, string> = createBoundedCache<string, string>({
  maxSize: 200,
  ttlMs: 60_000,
  sweepIntervalMs: 60_000,
});

export interface FeatureFlagRow {
  key: string;
  value: string;
}

export class FeatureFlagService {
  private readonly settingsRepo: SettingsRepository;

  constructor() {
    this.settingsRepo = new SettingsRepository();
  }

  /**
   * Get flag value as boolean.
   * Returns true only if value === 'true'.
   * Returns false if key is missing or value is not 'true'.
   */
  static getFlag(key: FeatureFlagKey): boolean {
    const value = FeatureFlagService.getFlagValue(key);
    return value === 'true';
  }

  /**
   * Get traffic percentage as number (defaults to 10).
   */
  static getTrafficPct(key: 'EVAL_SHADOW_TRAFFIC_PCT'): number {
    const value = FeatureFlagService.getFlagValue(key);
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 10;
  }

  /**
   * Internal: get raw string value from cache.
   */
  private static getFlagValue(key: string): string {
    // V-1: try the cache first (TTL-driven expiry handled inside get())
    const cached = _flagCache.get(key);
    if (cached !== undefined) return cached;
    // Lazy load on first miss
    void FeatureFlagService.loadIntoCache();
    return _flagCache.get(key) ?? DEFAULT_FLAG_VALUES[key] ?? '';
  }

  /**
   * List all flags with their current values.
   */
  async listFlags(): Promise<FeatureFlagRow[]> {
    void FeatureFlagService.loadIntoCache();
    return Object.keys(DEFAULT_FLAG_VALUES).map(key => ({
      key,
      value: _flagCache.get(key) ?? DEFAULT_FLAG_VALUES[key] ?? '',
    }));
  }

  /**
   * Get shadow salt for deterministic grayscale routing.
   * Falls back to process.pid + SUPABASE_URL if not in DB.
   */
  async getShadowSalt(): Promise<string> {
    try {
      const salt = await this.settingsRepo.get('eval_shadow_salt');
      return salt ?? this.getDefaultShadowSalt();
    } catch {
      return this.getDefaultShadowSalt();
    }
  }

  /**
   * Generate default shadow salt from process ID and Supabase URL.
   */
  private getDefaultShadowSalt(): string {
    const pid = process.pid;
    const url = process.env.SUPABASE_URL ?? 'unknown';
    return `${pid}:${url}`;
  }

  /**
   * Rotate shadow salt by generating a new random salt.
   * Returns the new salt value.
   */
  async rotateShadowSalt(actor: string): Promise<string> {
    const newSalt = crypto.randomBytes(16).toString('hex');
    try {
      await this.settingsRepo.set('eval_shadow_salt', newSalt);
      FeatureFlagService.invalidateCache();
      logger.info('[FeatureFlagService] Shadow salt rotated', { actor, saltLength: newSalt.length });
      return newSalt;
    } catch (error) {
      throw toServiceError(error, 'Failed to rotate shadow salt');
    }
  }

  /**
   * Set a feature flag value.
   * Only allows specific EVAL_* keys.
   */
  async setFlag(key: string, value: string, actor: string): Promise<void> {
    if (!FEATURE_FLAG_KEYS.includes(key as FeatureFlagKey)) {
      throw new ServiceError(`Unknown or disallowed feature flag key: ${key}`, {
        status: 400,
        code: 'INVALID_FLAG_KEY',
      });
    }

    try {
      await this.settingsRepo.set(key, value);
      FeatureFlagService.invalidateCache();
      logger.info('[FeatureFlagService] Flag updated', { key, value, actor });
    } catch (error) {
      throw toServiceError(error, `Failed to set flag ${key}`);
    }
  }

  /**
   * V-1: Invalidate the cache via the bounded cache primitive.
   * Called by settings route when flags change.
   */
  static invalidateCache(): void {
    _flagCache.invalidateAll();
    logger.debug('[FeatureFlagService] Cache invalidated');
  }

  /**
   * V-1: Load EVAL_* flags from the DB into the bounded cache.
   * Defaults are pre-loaded first so the cache is never empty even when
   * the DB path is skipped (demo mode or DB error). All reload sites
   * now use this single primitive.
   */
  static loadIntoCache(): void {
    for (const [k, v] of Object.entries(DEFAULT_FLAG_VALUES)) {
      _flagCache.set(k, v);
    }
    assert(_flagCache.has(FEATURE_FLAG_KEYS[0]) || isDemoMode());

    if (isDemoMode()) {
      return;
    }

    // Fire-and-forget async DB load; defaults already set above.
    void (async () => {
      try {
        const client = getSupabaseClient();
        if (!client) return;
        const { data, error } = await client
          .from('settings')
          .select('key, value')
          .in('key', [...FEATURE_FLAG_KEYS]);

        if (error) {
          throw new Error(error.message);
        }

        if (data) {
          for (const row of data) {
            _flagCache.set(row.key, row.value);
          }
        }

        logger.info('[FeatureFlagService] Flag cache loaded', {
          count: Object.keys(DEFAULT_FLAG_VALUES).length,
        });
      } catch (err) {
        logger.warn('[FeatureFlagService] Failed to load flags from DB, using defaults', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Defaults already set above — nothing more to do
      }
    })();
  }

  /**
   * V-1: Eagerly initialise the cache synchronously at server startup.
   * Waits for the DB query to complete before returning.
   * Call this once from server.ts after app.prepare() resolves.
   */
  static async init(): Promise<void> {
    // V-1: always pre-load defaults so the cache is never empty
    for (const [k, v] of Object.entries(DEFAULT_FLAG_VALUES)) {
      _flagCache.set(k, v);
    }

    if (isDemoMode()) {
      logger.debug('[FeatureFlagService] Demo mode: skipping DB init');
      return;
    }

    try {
      const client = getSupabaseClient();
      if (!client) return;
      const response = await client
        .from('settings')
        .select('key, value')
        .in('key', [...FEATURE_FLAG_KEYS]);

      if (response.error) {
        throw new Error(response.error.message);
      }

      if (response.data) {
        for (const row of response.data) {
          _flagCache.set(row.key, row.value);
        }
      }

      logger.info('[FeatureFlagService] Flag cache initialised', {
        count: Object.keys(DEFAULT_FLAG_VALUES).length,
      });
    } catch (err) {
      logger.warn('[FeatureFlagService] Failed to initialise flags from DB, using defaults', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Defaults already set above
    }
  }
}

// Module-level initialization: defaults are pre-loaded so the cache is never empty.
// Call FeatureFlagService.init() from server.ts for eager DB-backed initialisation
// (avoids the fire-and-forget race on the first request after a cold start).
FeatureFlagService.loadIntoCache();
