/**
 * Tests for the fail-closed behaviour of
 * `SettingsRepository.upsertManyAtomic()`.
 *
 * Background:
 *   The repository may attempt three write paths in order:
 *     1. `upsert_settings_batch` (hardened, SECURITY DEFINER, service_role-only)
 *     2. `upsert_many_settings` (legacy migration; older deploys)
 *     3. Per-row `from('settings').upsert(...)` as a deployment-safety fallback.
 *
 * The previous behaviour was: ANY error from path #1, including permission
 * errors (42501) and database errors (22xxx), silently fell back to path #3.
 * That violated "fail closed" — a service_role permission error should not
 * be quietly masked by raw client writes.
 *
 * Phase 0 (settings-rls-hardening) tightens this:
 *   - `PGRST202` (function not found) is allowed to fall back to the legacy RPC.
 *   - Permission errors (42501), database/integrity errors (22xxx) and any
 *     other unexpected failure must throw `RepositoryError` immediately. They
 *     must NOT trigger the per-row fallback path.
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

type RpcResult = { error: { message: string; code?: string } | null };
type RpcCall = (name: string, args: Record<string, unknown>) => RpcResult;

interface FakeClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: any;
}

function buildClient(rpcImpl: RpcCall, fromUpsertImpl?: (() => RpcResult) | undefined): FakeClient {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args)),
    from: vi.fn((table: string) => {
      if (table !== 'settings') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upsert: vi.fn(async () => fromUpsertImpl ? fromUpsertImpl() : { error: null }) as any,
      };
    }),
  };
}

describe('SettingsRepository.upsertManyAtomic — fail-closed RPC routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the primary hardened RPC when it succeeds', async () => {
    const client = buildClient((name) => {
      if (name === 'upsert_settings_batch') return { error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const repo = new SettingsRepository();
    await expect(repo.upsertManyAtomic({ theme: 'dark' })).resolves.toBeUndefined();

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('upsert_settings_batch', { p_items: { theme: 'dark' } });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('falls back to the legacy RPC only when primary RPC reports PGRST202 (function not found)', async () => {
    const client = buildClient((name) => {
      if (name === 'upsert_settings_batch') {
        return { error: { message: 'function upsert_settings_batch() does not exist', code: 'PGRST202' } };
      }
      if (name === 'upsert_many_settings') return { error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const repo = new SettingsRepository();
    await expect(repo.upsertManyAtomic({ theme: 'dark' })).resolves.toBeUndefined();

    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'upsert_settings_batch', { p_items: { theme: 'dark' } });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'upsert_many_settings', { p_items: { theme: 'dark' } });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws immediately on a 42501 permission error — does NOT fall back to per-row upsert', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fromUpsertSpy: any = vi.fn(async () => ({ error: null }));
    const client = buildClient(
      (name) => {
        if (name === 'upsert_settings_batch') {
          return { error: { message: 'forbidden: upsert_settings_batch requires service_role', code: '42501' } };
        }
        throw new Error(`unexpected RPC: ${name}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fromUpsertSpy as any,
    );
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const repo = new SettingsRepository();

    await expect(repo.upsertManyAtomic({ theme: 'dark' })).rejects.toBeInstanceOf(RepositoryError);
    expect(fromUpsertSpy).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    // Legacy RPC must not be silently attempted for permission errors either —
    // it would also lack the service_role check on older deployments.
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on a 22xxx database/integrity error — does NOT fall back to per-row upsert', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fromUpsertSpy: any = vi.fn(async () => ({ error: null }));
    const client = buildClient(
      (name) => {
        if (name === 'upsert_settings_batch') {
          return { error: { message: 'invalid payload: p_items must be a jsonb object', code: '22023' } };
        }
        throw new Error(`unexpected RPC: ${name}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fromUpsertSpy as any,
    );
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const repo = new SettingsRepository();
    await expect(repo.upsertManyAtomic({ theme: 'dark' })).rejects.toBeInstanceOf(RepositoryError);
    expect(fromUpsertSpy).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws on an unexpected non-PGRST202 error from the primary RPC — does NOT fall back to per-row upsert', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fromUpsertSpy: any = vi.fn(async () => ({ error: null }));
    const client = buildClient(
      (name) => {
        if (name === 'upsert_settings_batch') {
          return { error: { message: 'connection reset', code: '08006' } };
        }
        throw new Error(`unexpected RPC: ${name}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fromUpsertSpy as any,
    );
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const repo = new SettingsRepository();
    await expect(repo.upsertManyAtomic({ theme: 'dark' })).rejects.toBeInstanceOf(RepositoryError);
    expect(fromUpsertSpy).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws when both the primary and legacy RPCs fail', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fromUpsertSpy: any = vi.fn(async () => ({ error: null }));
    const client = buildClient(
      (name) => {
        if (name === 'upsert_settings_batch') {
          return { error: { message: 'not found', code: 'PGRST202' } };
        }
        if (name === 'upsert_many_settings') {
          return { error: { message: 'still missing', code: 'PGRST202' } };
        }
        throw new Error(`unexpected RPC: ${name}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fromUpsertSpy as any,
    );
    (getSupabaseClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(client);

    const repo = new SettingsRepository();
    await expect(repo.upsertManyAtomic({ theme: 'dark' })).rejects.toBeInstanceOf(RepositoryError);
    // Both legacy fallbacks exhausted without a writable path. The repository
    // must NOT silently degrade to per-row upsert; doing so would bypass the
    // SECURITY DEFINER hardening of the migration.
    expect(fromUpsertSpy).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
});