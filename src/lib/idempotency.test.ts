import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MemoryIdempotencyStore,
  SKIPPED,
  createIdempotencyKey,
  fnv1a64,
  idempotent,
  type SupabaseClientLike,
} from './idempotency';
import { toGorgiasTicketId } from './repository-errors';

describe('MemoryIdempotencyStore', () => {
  let store: MemoryIdempotencyStore;
  beforeEach(() => {
    store = new MemoryIdempotencyStore(0); // disable timer in tests
  });

  it('returns true on first acquire and false on duplicate within window', () => {
    expect(store.tryAcquire('k1', 60_000)).toBe(true);
    expect(store.tryAcquire('k1', 60_000)).toBe(false);
    expect(store.peek('k1')?.attempts).toBe(2);
  });

  it('releases keys correctly', () => {
    expect(store.tryAcquire('k', 60_000)).toBe(true);
    store.release('k');
    expect(store.peek('k')).toBeUndefined();
    expect(store.tryAcquire('k', 60_000)).toBe(true);
  });

  it('expires keys past the window', () => {
    const t0 = 1_000_000;
    expect(store.tryAcquire('k', 100, t0)).toBe(true);
    expect(store.tryAcquire('k', 100, t0 + 50)).toBe(false);
    expect(store.tryAcquire('k', 100, t0 + 200)).toBe(true);
  });

  it('dispose stops the timer and clears entries', () => {
    const realStore = new MemoryIdempotencyStore(10_000);
    realStore.tryAcquire('k', 60_000);
    realStore.dispose();
    expect(realStore.size()).toBe(0);
  });
});

describe('fnv1a64', () => {
  it('is deterministic', () => {
    expect(fnv1a64('a')).toBe(fnv1a64('a'));
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a64('a')).not.toBe(fnv1a64('b'));
    expect(fnv1a64('abc')).not.toBe(fnv1a64('cba'));
  });

  it('produces 16-char hex output', () => {
    expect(fnv1a64('hello')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('createIdempotencyKey', () => {
  it('embeds the prefix and a hash of the parts', () => {
    const k = createIdempotencyKey('webhook', 'ticket-1', 'created');
    expect(k).toMatch(/^webhook:[0-9a-f]{16}$/);
  });

  it('is stable across retries', () => {
    const a = createIdempotencyKey('webhook', 'ticket-1', 'created');
    const b = createIdempotencyKey('webhook', 'ticket-1', 'created');
    expect(a).toBe(b);
  });

  it('differs when any part differs', () => {
    expect(createIdempotencyKey('webhook', 'ticket-1', 'created')).not.toBe(
      createIdempotencyKey('webhook', 'ticket-1', 'updated'),
    );
    expect(createIdempotencyKey('webhook', 'ticket-1', 'created')).not.toBe(
      createIdempotencyKey('webhook', 'ticket-2', 'created'),
    );
  });

  it('accepts branded GorgiasTicketId', () => {
    const id = toGorgiasTicketId(68790392);
    const k = createIdempotencyKey('gorgias', id, 'message');
    expect(k).toMatch(/^gorgias:[0-9a-f]{16}$/);
  });
});

describe('idempotent (memory scope)', () => {
  it('returns SKIPPED on duplicate within window', async () => {
    const key = createIdempotencyKey('test', 'k');
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      return 'value';
    });

    const r1 = await idempotent(
      { key, windowMs: 60_000, scope: 'memory' },
      fn,
    );
    const r2 = await idempotent(
      { key, windowMs: 60_000, scope: 'memory' },
      fn,
    );
    expect(r1.value).toBe('value');
    expect(r1.skipped).toBe(false);
    expect(r2.value).toBe(SKIPPED);
    expect(r2.skipped).toBe(true);
    expect(r2.attempts).toBeGreaterThanOrEqual(2);
    expect(calls).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rolls back the key on error when rollbackOnError=true', async () => {
    const key = createIdempotencyKey('test', 'rollback');
    const fn1 = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      idempotent(
        { key, windowMs: 60_000, scope: 'memory', rollbackOnError: true },
        fn1,
      ),
    ).rejects.toThrow('boom');

    // Second call should run because the key was released.
    const fn2 = vi.fn(async () => 'ok');
    const r = await idempotent(
      { key, windowMs: 60_000, scope: 'memory', rollbackOnError: true },
      fn2,
    );
    expect(r.value).toBe('ok');
  });

  it('keeps the key on error when rollbackOnError=false', async () => {
    const key = createIdempotencyKey('test', 'keep');
    const fn1 = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      idempotent(
        { key, windowMs: 60_000, scope: 'memory', rollbackOnError: false },
        fn1,
      ),
    ).rejects.toThrow('boom');

    const fn2 = vi.fn(async () => 'ok');
    const r = await idempotent(
      { key, windowMs: 60_000, scope: 'memory', rollbackOnError: false },
      fn2,
    );
    expect(r.value).toBe(SKIPPED);
  });
});

describe('idempotent (persistent scope)', () => {
  function makeFakeStore(): {
    store: import('./idempotency').IdempotencyStore;
    inserts: number;
    deletes: number;
  } {
    const inserted = new Set<string>();
    const inserts = { value: 0 };
    const deletes = { value: 0 };
    const store: import('./idempotency').IdempotencyStore = {
      async tryAcquire(key) {
        if (inserted.has(key)) return false;
        inserted.add(key);
        inserts.value++;
        return true;
      },
      async release(key) {
        inserted.delete(key);
        deletes.value++;
      },
    };
    return { store, inserts: inserts.value, deletes: deletes.value };
  }

  it('throws when persistentStore is missing', async () => {
    await expect(
      idempotent(
        { key: 'x', windowMs: 1000, scope: 'persistent' },
        async () => 'v',
      ),
    ).rejects.toThrow(/requires .persistentStore/);
  });

  it('runs once across concurrent calls', async () => {
    const { store } = makeFakeStore();
    let calls = 0;
    const fn = async () => {
      calls++;
      return 'done';
    };
    const opts = {
      key: createIdempotencyKey('persistent', 'k'),
      windowMs: 60_000,
      scope: 'persistent' as const,
      persistentStore: store,
    };
    const r1 = await idempotent(opts, fn);
    const r2 = await idempotent(opts, fn);
    expect(r1.value).toBe('done');
    expect(r2.value).toBe(SKIPPED);
    expect(calls).toBe(1);
  });

  it('PersistentIdempotencyStore (Supabase) treats 23505 as already-acquired', async () => {
    const fake: SupabaseClientLike = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      from(_table: string) {
        return {
          async insert() {
            return {
              error: { code: '23505', message: 'duplicate key' },
            };
          },
          delete() {
            return {
              async eq() {
                return { error: null };
              },
            };
          },
        };
      },
    };
    const store = new (await import('./idempotency')).PersistentIdempotencyStore(fake);
    expect(await store.tryAcquire('k', 1000)).toBe(false);
  });

  it('PersistentIdempotencyStore (Supabase) throws on non-23505 error from tryAcquire', async () => {
    const fake: SupabaseClientLike = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      from(_table: string) {
        return {
          async insert() {
            return { error: { code: '42P01', message: 'relation missing' } };
          },
          delete() {
            return {
              async eq() {
                return { error: null };
              },
            };
          },
        };
      },
    };
    const store = new (await import('./idempotency')).PersistentIdempotencyStore(fake);
    await expect(store.tryAcquire('k', 1000)).rejects.toThrow(/persistent idempotency acquire failed/);
  });
});