import { describe, it, expect, vi } from 'vitest';
import { createBoundedCache } from './bounded-cache';

describe('createBoundedCache', () => {
  it('throws on invalid options', () => {
    expect(() =>
      createBoundedCache({ maxSize: 0, ttlMs: 1000 }),
    ).toThrow(/maxSize/);
    expect(() =>
      createBoundedCache({ maxSize: 10, ttlMs: 0 }),
    ).toThrow(/ttlMs/);
  });

  it('stores and retrieves values', () => {
    const c = createBoundedCache<string, number>({ maxSize: 10, ttlMs: 60_000 });
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.has('a')).toBe(true);
    c.dispose();
  });

  it('evicts least-recently-used entries when full', () => {
    const c = createBoundedCache<string, number>({
      maxSize: 3,
      ttlMs: 60_000,
      sweepIntervalMs: 0,
    });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    // Touch `a` so it becomes MRU.
    c.get('a');
    // Insert one more — `b` should be evicted (now LRU).
    c.set('d', 4);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.has('d')).toBe(true);
    expect(c.stats().evictions).toBe(1);
    c.dispose();
  });

  it('expires entries past the TTL', () => {
    vi.useFakeTimers();
    try {
      const c = createBoundedCache<string, number>({
        maxSize: 10,
        ttlMs: 1000,
        sweepIntervalMs: 0,
      });
      c.set('a', 1);
      expect(c.get('a')).toBe(1);
      vi.advanceTimersByTime(2000);
      expect(c.get('a')).toBeUndefined();
      expect(c.stats().expirations).toBeGreaterThanOrEqual(1);
      c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates individual keys and all keys', () => {
    const c = createBoundedCache<string, number>({
      maxSize: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 0,
    });
    c.set('a', 1);
    c.set('b', 2);
    c.invalidate('a');
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    c.invalidateAll();
    expect(c.has('b')).toBe(false);
    c.dispose();
  });

  it('tracks hit/miss statistics', () => {
    const c = createBoundedCache<string, number>({
      maxSize: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 0,
    });
    c.set('a', 1);
    c.get('a'); // hit
    c.get('a'); // hit
    c.get('b'); // miss
    const s = c.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.size).toBe(1);
    c.dispose();
  });

  it('subscribes and broadcasts invalidation events', () => {
    const c = createBoundedCache<string, number>({
      maxSize: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 0,
      invalidateOn: ['settings:reloaded'],
    });
    const listener = vi.fn();
    c.subscribeInvalidation('settings:reloaded', listener);
    c.set('a', 1);
    c.triggerInvalidation('settings:reloaded');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(c.has('a')).toBe(false);
    c.dispose();
  });

  it('unsubscribe stops the listener from firing', () => {
    const c = createBoundedCache<string, number>({
      maxSize: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 0,
    });
    const listener = vi.fn();
    const off = c.subscribeInvalidation('evt', listener);
    c.triggerInvalidation('evt');
    off();
    c.triggerInvalidation('evt');
    expect(listener).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('dispose clears entries, resets size, and releases listeners', () => {
    const c = createBoundedCache<string, number>({
      maxSize: 10,
      ttlMs: 60_000,
      sweepIntervalMs: 0,
    });
    const listener = vi.fn();
    c.subscribeInvalidation('evt', listener);
    c.set('a', 1);
    c.dispose();
    expect(c.stats().size).toBe(0);
    // Triggering after dispose: the listener set was cleared, so nothing fires.
    c.triggerInvalidation('evt');
    expect(listener).toHaveBeenCalledTimes(0);
  });
});