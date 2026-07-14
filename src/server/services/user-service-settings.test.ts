/**
 * Unit tests for `UserService.seedDefaultSettings`.
 *
 * These tests mock the Supabase client + SettingsRepository (via vi.mock)
 * so we never touch the network. They cover the documented branches of
 * `seedDefaultSettings`:
 *   1. demo mode → merges into the in-memory DEMO_SETTINGS array, no throw
 *   2. real mode + sentinel-key already present → skips seedDefaults
 *   3. real mode + sentinel-key missing → seedDefaults(FACTORY_DEFAULTS_WITH_PROMPT) once
 *
 * The RPC advisory-lock fallback and double-check-after-lock are also exercised.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to control `isDemoMode()` per test. The vi.mock factory below
// reads `mockIsDemoMode` via a getter on a module-scoped object, so the
// factory remains hoisting-safe (no top-level variable captures).
const demoModeState = { value: false };

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: () => ({
    rpc: vi.fn(async (name: string) => {
      if (name === 'try_acquire_settings_seed_lock') {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    }),
  }),
  isDemoMode: () => demoModeState.value,
}));

// SettingsRepository is mocked by exposing a stable object with vi.fn()
// methods. We use module-level vi.fn() so the same spy persists across
// `vi.clearAllMocks()` resets. The class is declared inside the factory
// so vi.mock's hoisting doesn't capture a not-yet-initialized symbol.
const settingsList = vi.fn();
const settingsSeedDefaults = vi.fn();

vi.mock('@/server/repositories/settings-repository', () => {
  return {
    SettingsRepository: class MockSettingsRepository {
      list = settingsList;
      seedDefaults = settingsSeedDefaults;
    },
  };
});

vi.mock('@/server/repositories/user-repository', () => {
  return {
    UserRepository: class MockUserRepository {},
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { UserService } from './user-service';
import { DEMO_SETTINGS } from '@/server/repositories/demo-data/demo-settings';
import {
  FACTORY_DEFAULTS_WITH_PROMPT,
  SETTINGS_SENTINEL_KEY,
} from '@/lib/server-only-settings-defaults';

const baseOptions = {
  trigger: 'createUser' as const,
  userId: 'u1',
  userEmail: 'u1@example.com',
};

function resetDemoSettings() {
  while (DEMO_SETTINGS.length > 0) DEMO_SETTINGS.pop();
  DEMO_SETTINGS.push(
    { key: 'theme', value: 'light' } as never,
    { key: 'webhook_secret', value: 'demo' } as never,
  );
}

describe('UserService.seedDefaultSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    demoModeState.value = false;
    resetDemoSettings();
  });

  describe('demo mode', () => {
    it('merges FACTORY_DEFAULTS_WITH_PROMPT into DEMO_SETTINGS and does not throw', async () => {
      demoModeState.value = true;
      const service = new UserService();

      await expect(service.seedDefaultSettings(baseOptions)).resolves.toBeUndefined();

      const keysAfter = new Set(DEMO_SETTINGS.map((r) => r.key));
      for (const k of Object.keys(FACTORY_DEFAULTS_WITH_PROMPT)) {
        expect(keysAfter.has(k)).toBe(true);
      }
      // Existing keys must NOT be overwritten
      expect(DEMO_SETTINGS.find((r) => r.key === 'theme')?.value).toBe('light');
      expect(DEMO_SETTINGS.find((r) => r.key === 'webhook_secret')?.value).toBe('demo');
      expect(settingsList).not.toHaveBeenCalled();
      expect(settingsSeedDefaults).not.toHaveBeenCalled();
    });

    it('does not duplicate keys already present in DEMO_SETTINGS', async () => {
      demoModeState.value = true;
      DEMO_SETTINGS.push({ key: 'ai_model', value: 'custom-model' } as never);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      const aiModel = DEMO_SETTINGS.find((r) => r.key === 'ai_model');
      expect(aiModel?.value).toBe('custom-model');
      const aiModelCount = DEMO_SETTINGS.filter((r) => r.key === 'ai_model').length;
      expect(aiModelCount).toBe(1);
    });
  });

  describe('real mode', () => {
    it('skips seedDefaults when every factory default already exists (sentinel present + others present)', async () => {
      demoModeState.value = false;
      // Every factory default key is already present.
      const fullRows = Object.keys(FACTORY_DEFAULTS_WITH_PROMPT).map((k) => ({
        key: k,
        value: FACTORY_DEFAULTS_WITH_PROMPT[k],
      }));
      settingsList.mockResolvedValueOnce(fullRows);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsList).toHaveBeenCalledTimes(1);
      expect(settingsSeedDefaults).not.toHaveBeenCalled();
    });

    it('calls seedDefaults(delta) exactly once when sentinel is missing and no defaults exist', async () => {
      demoModeState.value = false;
      // First list() → nothing; second list() (post-lock re-check) → nothing
      settingsList.mockResolvedValueOnce([]);
      settingsList.mockResolvedValueOnce([]);
      settingsSeedDefaults.mockResolvedValueOnce(undefined);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsList).toHaveBeenCalledTimes(2);
      expect(settingsSeedDefaults).toHaveBeenCalledTimes(1);
      const payload = settingsSeedDefaults.mock.calls[0]![0] as Record<string, string>;
      // Delta == full FACTORY_DEFAULTS_WITH_PROMPT (everything missing).
      expect(payload).toEqual(FACTORY_DEFAULTS_WITH_PROMPT);
    });

    it('skips seedDefaults when the post-lock re-check shows nothing missing', async () => {
      demoModeState.value = false;
      // First list(): empty; second list(): everything present (racer filled in).
      settingsList.mockResolvedValueOnce([]);
      const fullRows = Object.keys(FACTORY_DEFAULTS_WITH_PROMPT).map((k) => ({
        key: k,
        value: FACTORY_DEFAULTS_WITH_PROMPT[k],
      }));
      settingsList.mockResolvedValueOnce(fullRows);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsSeedDefaults).not.toHaveBeenCalled();
    });

    it('falls back to lockless seeding when the advisory-lock RPC is unavailable', async () => {
      demoModeState.value = false;
      settingsList.mockResolvedValueOnce([{ key: 'webhook_secret', value: 'wh_secret' }]);
      settingsList.mockResolvedValueOnce([{ key: 'webhook_secret', value: 'wh_secret' }]);
      settingsSeedDefaults.mockResolvedValueOnce(undefined);

      // Override the rpc mock for this test only — simulate the missing
      // RPC. The first import already cached the mock, so we reach into
      // the singleton client and replace `.rpc` for the duration of this
      // test.
      const { getSupabaseClient } = await import('@/storage/database/supabase-client');
      const client = getSupabaseClient() as unknown as { rpc: ReturnType<typeof vi.fn> };
      const originalRpc = client.rpc;
      client.rpc = vi.fn(async (name: string) => {
        if (name === 'try_acquire_settings_seed_lock') {
          throw new Error('function try_acquire_settings_seed_lock() does not exist (PGRST202)');
        }
        return { data: null, error: null };
      });

      try {
        const service = new UserService();
        await expect(service.seedDefaultSettings(baseOptions)).resolves.toBeUndefined();
        expect(settingsSeedDefaults).toHaveBeenCalledTimes(1);
      } finally {
        client.rpc = originalRpc;
      }
    });

    // ── Phase 2: missing-keys delta-seeding ───────────────────────────────
    // The original implementation skipped seeding the moment `system_prompt`
    // existed, even if every other factory default was missing. The fix
    // computes a delta between FACTORY_DEFAULTS_WITH_PROMPT and the live
    // settings table, and only seeds the missing keys. These tests pin that.

    it('seeds only the missing delta when sentinel exists but other defaults are absent', async () => {
      demoModeState.value = false;
      // Pre-seed only `system_prompt` (sentinel) — every other factory
      // default is missing. The function must seed the delta, NOT bail.
      settingsList.mockResolvedValueOnce([
        { key: SETTINGS_SENTINEL_KEY, value: 'admin-customised prompt' },
      ]);
      settingsList.mockResolvedValueOnce([
        { key: SETTINGS_SENTINEL_KEY, value: 'admin-customised prompt' },
      ]);
      settingsSeedDefaults.mockResolvedValueOnce(undefined);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsSeedDefaults).toHaveBeenCalledTimes(1);
      const delta = settingsSeedDefaults.mock.calls[0]![0] as Record<string, string>;
      // system_prompt already exists — must NOT be in the delta.
      expect(delta).not.toHaveProperty(SETTINGS_SENTINEL_KEY);
      // Other factory defaults must be present in the delta.
      for (const k of Object.keys(FACTORY_DEFAULTS_WITH_PROMPT)) {
        if (k === SETTINGS_SENTINEL_KEY) continue;
        expect(delta).toHaveProperty(k);
        expect(delta[k]).toBe(FACTORY_DEFAULTS_WITH_PROMPT[k]);
      }
    });

    it('skips seeding entirely when every factory default already exists', async () => {
      demoModeState.value = false;
      // Build a "fully configured" settings table with every factory default.
      const fullKeys = Object.keys(FACTORY_DEFAULTS_WITH_PROMPT);
      const fullRows = fullKeys.map((k) => ({ key: k, value: FACTORY_DEFAULTS_WITH_PROMPT[k] }));
      settingsList.mockResolvedValueOnce(fullRows);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsSeedDefaults).not.toHaveBeenCalled();
    });

    it('recomputes the missing-keys set after acquiring the advisory lock', async () => {
      demoModeState.value = false;
      // First list(): system_prompt + some defaults missing.
      settingsList.mockResolvedValueOnce([
        { key: SETTINGS_SENTINEL_KEY, value: 'admin prompt' },
        { key: 'theme', value: 'dark' },
      ]);
      // Post-lock re-check: a racer filled in `welcome_message` while we
      // were waiting on the lock.
      settingsList.mockResolvedValueOnce([
        { key: SETTINGS_SENTINEL_KEY, value: 'admin prompt' },
        { key: 'theme', value: 'dark' },
        { key: 'welcome_message', value: 'racer-filled' },
      ]);
      settingsSeedDefaults.mockResolvedValueOnce(undefined);
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsSeedDefaults).toHaveBeenCalledTimes(1);
      const delta = settingsSeedDefaults.mock.calls[0]![0] as Record<string, string>;
      // The racer-filled key must NOT be in the delta.
      expect(delta).not.toHaveProperty('welcome_message');
      // system_prompt + theme must NOT be in the delta.
      expect(delta).not.toHaveProperty(SETTINGS_SENTINEL_KEY);
      expect(delta).not.toHaveProperty('theme');
      // The remaining missing factory defaults must still be seeded.
      const expectedDeltaKeys = Object.keys(FACTORY_DEFAULTS_WITH_PROMPT).filter(
        (k) => k !== SETTINGS_SENTINEL_KEY && k !== 'theme' && k !== 'welcome_message'
      );
      for (const k of expectedDeltaKeys) {
        expect(delta).toHaveProperty(k);
      }
    });

    it('skips seeding when the post-lock re-check shows nothing missing', async () => {
      demoModeState.value = false;
      // First list(): some keys missing.
      settingsList.mockResolvedValueOnce([
        { key: SETTINGS_SENTINEL_KEY, value: 'p' },
      ]);
      // Post-lock re-check: racer filled everything in.
      const fullKeys = Object.keys(FACTORY_DEFAULTS_WITH_PROMPT);
      settingsList.mockResolvedValueOnce(
        fullKeys.map((k) => ({ key: k, value: FACTORY_DEFAULTS_WITH_PROMPT[k] }))
      );
      const service = new UserService();

      await service.seedDefaultSettings(baseOptions);

      expect(settingsSeedDefaults).not.toHaveBeenCalled();
    });
  });
});
