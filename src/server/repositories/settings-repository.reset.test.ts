/**
 * Tests for `SettingsRepository.seedDefaults()` and
 * `SettingsRepository.resetToDefaults()`.
 *
 * These cover the new atomic RPC helpers added in phase 1 of
 * `settings-rls-hardening_5c312208.plan.md`.
 *
 * Test strategy: unit tests with a fake Supabase client (vi.fn mocks).
 * No network I/O, no real database.
 *
 * Contract:
 *   seedDefaults()    → calls `seed_system_defaults` RPC, PGRST202 fallback
 *                        to `upsert_many_settings`, no per-row fallback.
 *   resetToDefaults() → calls `reset_settings_to_defaults` RPC, PGRST202
 *                        fallback to `upsert_many_settings` (conservative
 *                        for older deploys), no per-row fallback.
 *
 * Demo mode: `isDemoMode()` is controlled by process.env flags and is
 * evaluated at runtime. The demo mode guard is exercised by the
 * `user-service-settings.test.ts` integration suite (which manages a
 * shared `demoModeState` object that `isDemoMode` references). This
 * file tests the non-demo path only, since the module-level
 * `isDemoMode` is cached at module-load time and cannot be flipped
 * between test cases without module re-import.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSupabaseClient } from '@/storage/database/supabase-client';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { RepositoryError } from '@/server/repositories/repository-error';

type RpcResult = { data?: unknown; error: { message: string; code?: string } | null };
type RpcImpl = (name: string, args: Record<string, unknown>) => RpcResult;

function makeFakeClient(rpcImpl: RpcImpl) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args));
  const client = { rpc };
  (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);
  return { client, rpc };
}

// ─── seedDefaults tests ───────────────────────────────────────────────────────

describe('SettingsRepository.seedDefaults — RPC contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls seed_system_defaults RPC with FACTORY_DEFAULTS_WITH_PROMPT payload', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'seed_system_defaults') return { data: 3, error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await repo.seedDefaults({ ai_model: 'test-model', theme: 'dark' });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('seed_system_defaults', {
      p_defaults: { ai_model: 'test-model', theme: 'dark' },
    });
  });

  it('throws RepositoryError when seed_system_defaults fails with non-PGRST202 code', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'seed_system_defaults') {
        return { data: null, error: { message: 'forbidden', code: '42501' } };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await expect(repo.seedDefaults({ theme: 'dark' })).rejects.toBeInstanceOf(RepositoryError);
    expect(rpc).toHaveBeenCalledTimes(1); // no legacy fallback for seed
  });

  it('falls back to upsert_many_settings when seed_system_defaults reports PGRST202', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'seed_system_defaults') {
        return { data: null, error: { message: 'function not found', code: 'PGRST202' } };
      }
      if (name === 'upsert_many_settings') return { data: 2, error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await repo.seedDefaults({ theme: 'dark', font_size: '14' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'seed_system_defaults', expect.any(Object));
    expect(rpc).toHaveBeenNthCalledWith(2, 'upsert_many_settings', expect.any(Object));
  });

  it('throws when legacy upsert_many_settings also fails (no per-row fallback)', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'seed_system_defaults') {
        return { data: null, error: { message: 'function not found', code: 'PGRST202' } };
      }
      if (name === 'upsert_many_settings') {
        return { data: null, error: { message: 'permission denied', code: '42501' } };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await expect(repo.seedDefaults({ theme: 'dark' })).rejects.toBeInstanceOf(RepositoryError);
    expect(rpc).toHaveBeenCalledTimes(2); // no further fallback
  });

  // Demo mode is exercised by `user-service-settings.test.ts` which manages a
  // shared `demoModeState` object. Repository-level demo-mode behaviour is
  // covered by integration tests there. This test file focuses on the RPC
  // contract in non-demo mode.
});

// ─── resetToDefaults tests ────────────────────────────────────────────────────

describe('SettingsRepository.resetToDefaults — RPC contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls reset_settings_to_defaults with payload and allowed keys', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'reset_settings_to_defaults') return { data: 5, error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();
    const payload = { theme: 'system', font_size: '14' };
    const allowedKeys = ['theme', 'font_size'];

    await repo.resetToDefaults(payload, allowedKeys);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reset_settings_to_defaults', {
      p_defaults: payload,
      p_allowed_keys: allowedKeys,
    });
  });

  it('throws RepositoryError on non-PGRST202 error from reset_settings_to_defaults', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'reset_settings_to_defaults') {
        return { data: null, error: { message: 'forbidden', code: '42501' } };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await expect(
      repo.resetToDefaults({ theme: 'system' }, ['theme'])
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(rpc).toHaveBeenCalledTimes(1); // no fallback
  });

  it('falls back to upsert_many_settings when reset RPC reports PGRST202', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'reset_settings_to_defaults') {
        return { data: null, error: { message: 'function not found', code: 'PGRST202' } };
      }
      if (name === 'upsert_many_settings') return { data: 2, error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await repo.resetToDefaults({ theme: 'system' }, ['theme']);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(2, 'upsert_many_settings', {
      p_items: { theme: 'system' },
    });
  });

  it('throws when legacy fallback also fails', async () => {
    const { rpc } = makeFakeClient((name) => {
      if (name === 'reset_settings_to_defaults') {
        return { data: null, error: { message: 'function not found', code: 'PGRST202' } };
      }
      if (name === 'upsert_many_settings') {
        return { data: null, error: { message: 'invalid payload', code: '22023' } };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    const repo = new SettingsRepository();

    await expect(
      repo.resetToDefaults({ theme: 'system' }, ['theme'])
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
