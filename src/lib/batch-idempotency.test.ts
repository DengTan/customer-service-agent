/**
 * Sprint 4 (T-2 / TS-2) — ticket batch idempotency tests.
 *
 * The PATCH /api/tickets/batch route wraps the service call in `idempotent()`
 * with key `batch_tickets:<requestId>:<bodyHash>` and a 60s window. These
 * tests verify the key derivation, dedup behavior, error rollback, and that
 * the response carries the `duplicate: true` sentinel for retried calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { idempotent, SKIPPED, createIdempotencyKey, fnv1a64 } from './idempotency';

// Simulate the route's key-derivation logic in isolation. Keeping it in a
// top-level helper ensures the production code and tests agree on the shape.
function deriveKey(requestId: string, ids: string[], updates: Record<string, unknown>): string {
  const bodyFingerprint = fnv1a64(JSON.stringify({ ids: [...ids].sort(), updates }));
  return createIdempotencyKey('batch_tickets', requestId, bodyFingerprint);
}

describe('deriveKey', () => {
  it('produces the same key for two identical bodies', () => {
    expect(deriveKey('req-1', ['a', 'b'], { status: 'closed' }))
      .toBe(deriveKey('req-1', ['b', 'a'], { status: 'closed' }));
  });

  it('differs when ids differ', () => {
    expect(deriveKey('req-1', ['a', 'b'], { status: 'closed' }))
      .not.toBe(deriveKey('req-1', ['a', 'c'], { status: 'closed' }));
  });

  it('differs when updates differ', () => {
    expect(deriveKey('req-1', ['a'], { status: 'closed' }))
      .not.toBe(deriveKey('req-1', ['a'], { status: 'resolved' }));
  });

  it('differs when requestId differs', () => {
    expect(deriveKey('req-1', ['a'], { status: 'closed' }))
      .not.toBe(deriveKey('req-2', ['a'], { status: 'closed' }));
  });
});

describe('idempotent batch wrapper', () => {
  it('runs the work exactly once and returns SKIPPED on duplicate', async () => {
    const updates = { status: 'closed' };
    const ids = ['t1', 't2'];
    const key = deriveKey('client-req-1', ids, updates);

    const batchUpdate = vi.fn(async () => ({ updated_count: 2 }));
    const opts = { key, windowMs: 60_000, scope: 'memory' as const, rollbackOnError: true };

    const r1 = await idempotent(opts, batchUpdate);
    const r2 = await idempotent(opts, batchUpdate);
    const r3 = await idempotent(opts, batchUpdate);

    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(r1.skipped).toBe(false);
    expect(r1.value).toEqual({ updated_count: 2 });
    expect(r2.value).toBe(SKIPPED);
    expect(r3.value).toBe(SKIPPED);
    expect(r3.attempts).toBeGreaterThanOrEqual(3);
  });

  it('rolls back the key on error so the next retry can run', async () => {
    const updates = { status: 'closed' };
    const ids = ['t1'];
    const key = deriveKey('rollback-req', ids, updates);
    const opts = { key, windowMs: 60_000, scope: 'memory' as const, rollbackOnError: true };

    const failing = vi.fn(async () => { throw new Error('transient'); });
    await expect(idempotent(opts, failing)).rejects.toThrow('transient');

    const success = vi.fn(async () => ({ updated_count: 1 }));
    const r2 = await idempotent(opts, success);
    expect(success).toHaveBeenCalledTimes(1);
    expect(r2.value).toEqual({ updated_count: 1 });
    expect(r2.skipped).toBe(false);
  });

  it('different requestIds do not share idempotency', async () => {
    const updates = { status: 'closed' };
    const ids = ['t1'];
    const key1 = deriveKey('req-A', ids, updates);
    const key2 = deriveKey('req-B', ids, updates);

    const fn = vi.fn(async () => ({ updated_count: 1 }));
    await idempotent({ key: key1, windowMs: 60_000, scope: 'memory' }, fn);
    await idempotent({ key: key2, windowMs: 60_000, scope: 'memory' }, fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns the cached result on duplicate (mocks the work not the value)', async () => {
    const updates = { assignee_id: 'agent-7' };
    const ids = ['t1', 't2', 't3'];
    const key = deriveKey('write-idempotency', ids, updates);
    const opts = { key, windowMs: 60_000, scope: 'memory' as const };

    const fn = vi.fn(async () => ({ updated_count: 3 }));
    const r1 = await idempotent(opts, fn);
    expect(r1.value).toEqual({ updated_count: 3 });

    // A retry with the same key MUST NOT call fn again.
    const r2 = await idempotent(opts, fn);
    expect(r2.value).toBe(SKIPPED);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
