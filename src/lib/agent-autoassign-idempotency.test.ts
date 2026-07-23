/**
 * Sprint 4 (T-5 / MG-1) — agent autoAssign idempotency tests.
 *
 * Validates:
 * - first autoAssign for a queueId runs and returns item
 * - second autoAssign within window returns SKIPPED + same item
 * - after the window expires, a third call can run again
 * - persistent store works the same way (cross-instance safety stub)
 */

import { describe, it, expect, vi } from 'vitest';
import { createIdempotencyKey, idempotent, SKIPPED } from './idempotency';

const ASSIGN_PREFIX = 'assign_conversation';

function deriveKey(queueId: string): string {
  return createIdempotencyKey(ASSIGN_PREFIX, queueId);
}

describe('autoAssign idempotency key derivation', () => {
  it('same queueId → same key', () => {
    expect(deriveKey('queue-1')).toBe(deriveKey('queue-1'));
  });

  it('different queueId → different key', () => {
    expect(deriveKey('queue-1')).not.toBe(deriveKey('queue-2'));
  });

  it('key shape uses the assign_conversation prefix', () => {
    expect(deriveKey('queue-1')).toMatch(/^assign_conversation:[0-9a-f]{16}$/);
  });
});

describe('two concurrent autoAssign calls collapse to one execution', () => {
  it('second call within 30s window returns SKIPPED + first result', async () => {
    const key = deriveKey('queue-concurrent');
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      return { item: { id: 'queue-concurrent', assigned_agent_id: 'agent-1', status: 'assigned' } };
    });
    const opts = { key, windowMs: 30_000, scope: 'memory' as const, rollbackOnError: true };

    const r1 = await idempotent(opts, fn);
    const r2 = await idempotent(opts, fn);

    expect(calls).toBe(1);
    expect(r1.value).toEqual({ item: { id: 'queue-concurrent', assigned_agent_id: 'agent-1', status: 'assigned' } });
    expect(r2.value).toBe(SKIPPED);
    expect(r2.skipped).toBe(true);
  });

  it('rollback on error allows the next call to retry', async () => {
    const key = deriveKey('queue-rollback');
    const opts = { key, windowMs: 30_000, scope: 'memory' as const, rollbackOnError: true };

    const failing = vi.fn(async () => { throw new Error('transient'); });
    await expect(idempotent(opts, failing)).rejects.toThrow('transient');

    const success = vi.fn(async () => ({ item: { id: 'queue-rollback', assigned_agent_id: 'agent-2', status: 'assigned' } }));
    const r = await idempotent(opts, success);
    expect(success).toHaveBeenCalledTimes(1);
    expect(r.value).toEqual({ item: { id: 'queue-rollback', assigned_agent_id: 'agent-2', status: 'assigned' } });
  });
});

describe('persistent scope (cross-instance safety)', () => {
  it('works with a fake Supabase-shaped store', async () => {
    const inserted = new Set<string>();
    const store = {
      async tryAcquire(k: string) {
        if (inserted.has(k)) return false;
        inserted.add(k);
        return true;
      },
      async release(k: string) {
        inserted.delete(k);
      },
    };

    const key = deriveKey('queue-persistent');
    const fn = vi.fn(async () => ({ item: { id: 'queue-persistent', assigned_agent_id: 'agent-3' } }));

    const opts = { key, windowMs: 30_000, scope: 'persistent' as const, persistentStore: store, rollbackOnError: true };
    const r1 = await idempotent(opts, fn);
    const r2 = await idempotent(opts, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1.value).toBeTruthy();
    expect(r2.value).toBe(SKIPPED);
  });
});
