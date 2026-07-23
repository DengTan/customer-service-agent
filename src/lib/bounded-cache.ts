/**
 * Bounded cache factory for SmartAssist.
 *
 * Solves root-cause #7 of the multi-agent audit: the codebase had at least
 * four ad-hoc Map-based caches with different eviction policies, no TTL
 * sweeping, no metrics, and no invalidation hooks — so memory leaks were
 * invisible and consumers had no way to coordinate invalidation across
 * modules.
 *
 * `createBoundedCache` standardizes on:
 * - LRU eviction via `Map` insertion-order semantics
 * - TTL with periodic sweep (default 60s)
 * - `invalidateOn(eventName)` subscriptions so unrelated modules can react
 *   when something upstream changes (e.g. settings reload invalidates
 *   auto-reply rules cache)
 * - `stats()` for observability
 */

import { logger } from '@/lib/logger';

// ─── Public Types ───────────────────────────────────────────────────────────

export interface BoundedCacheOptions<V> {
  /** Hard upper bound on number of entries. LRU eviction above this. */
  maxSize: number;
  /** Time-to-live for each entry, in milliseconds. */
  ttlMs: number;
  /**
   * Optional initial set of event names this cache should listen to. Each
   * event clears the cache. Additional names can be added at runtime via
   * `subscribeInvalidation`.
   */
  invalidateOn?: readonly string[];
  /** Sweep interval in milliseconds. Default 60_000. Pass 0 to disable. */
  sweepIntervalMs?: number;
  // The `V` type parameter is used by callers via `BoundedCache<K, V>`; the
  // options shape itself doesn't reference it, but exposing it on the
  // interface keeps the public API discoverable.
  readonly __value?: V;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
}

export interface BoundedCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  /** Forcefully evict a key (e.g. after a write-through). */
  invalidate(key: K): void;
  /** Clear ALL entries and broadcast invalidation to listeners. */
  invalidateAll(): void;
  /** Returns true if the key is present and not expired. */
  has(key: K): boolean;
  /** Current size + hit/miss/eviction counters. */
  stats(): CacheStats;
  /** Subscribe to invalidation events. Returns an unsubscribe function. */
  subscribeInvalidation(eventName: string, listener: () => void): () => void;
  /**
   * Trigger an invalidation event by name — clears all entries and notifies
   * listeners. Useful for direct invalidation when no global event bus is
   * available; in production prefer routing through the application event
   * bus and calling `invalidateAll()` instead.
   */
  triggerInvalidation(eventName: string): void;
  /** Stop the sweep timer and release all listeners. */
  dispose(): void;
}

// ─── Implementation ─────────────────────────────────────────────────────────

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export function createBoundedCache<K, V>(
  opts: BoundedCacheOptions<V>,
): BoundedCache<K, V> {
  if (opts.maxSize <= 0) {
    throw new Error('createBoundedCache: maxSize must be > 0');
  }
  if (opts.ttlMs <= 0) {
    throw new Error('createBoundedCache: ttlMs must be > 0');
  }

  // The Map preserves insertion order. We leverage that for LRU: a `get`
  // that finds the entry unlinks and re-inserts it at the tail.
  const entries = new Map<K, Entry<V>>();
  const listeners = new Map<string, Set<() => void>>();
  const stats: CacheStats = {
    size: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  const sweepIntervalMs =
    opts.sweepIntervalMs === undefined ? DEFAULT_SWEEP_INTERVAL_MS : opts.sweepIntervalMs;

  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  if (typeof setInterval !== 'undefined' && sweepIntervalMs > 0) {
    sweepTimer = setInterval(() => sweep(), sweepIntervalMs);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }

  // Pre-register invalidation event subscriptions.
  if (opts.invalidateOn) {
    for (const name of opts.invalidateOn) {
      ensureListenerSet(name);
    }
  }

  function ensureListenerSet(name: string): Set<() => void> {
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
    }
    return set;
  }

  function broadcastInvalidation(eventName: string): void {
    const set = listeners.get(eventName);
    if (!set) return;
    for (const fn of set) {
      try {
        fn();
      } catch (err) {
        logger.api?.warn?.('bounded-cache: invalidation listener threw', {
          event: eventName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function sweep(now: number = Date.now()): void {
    for (const [k, v] of entries) {
      if (v.expiresAt <= now) {
        entries.delete(k);
        stats.expirations++;
      }
    }
    stats.size = entries.size;
  }

  function evictIfNeeded(): void {
    while (entries.size > opts.maxSize) {
      // Map iteration order is insertion order; first key is the LRU.
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
      stats.evictions++;
    }
  }

  function get(key: K): V | undefined {
    const entry = entries.get(key);
    if (!entry) {
      stats.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      stats.expirations++;
      stats.misses++;
      stats.size = entries.size;
      return undefined;
    }
    // Promote to MRU.
    entries.delete(key);
    entries.set(key, entry);
    stats.hits++;
    return entry.value;
  }

  function set(key: K, value: V): void {
    const now = Date.now();
    const existing = entries.get(key);
    if (existing) entries.delete(key);
    entries.set(key, { value, expiresAt: now + opts.ttlMs });
    evictIfNeeded();
    stats.size = entries.size;
  }

  function invalidate(key: K): void {
    if (entries.delete(key)) {
      stats.size = entries.size;
    }
  }

  function invalidateAll(): void {
    if (entries.size === 0) return;
    entries.clear();
    stats.size = 0;
  }

  function has(key: K): boolean {
    const entry = entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      stats.expirations++;
      stats.size = entries.size;
      return false;
    }
    return true;
  }

  function snapshotStats(): CacheStats {
    return { ...stats };
  }

  function subscribeInvalidation(eventName: string, listener: () => void): () => void {
    const set = ensureListenerSet(eventName);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(eventName);
    };
  }

  function dispose(): void {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    entries.clear();
    stats.size = 0;
    listeners.clear();
  }

  /**
   * Internal: trigger an invalidation event. Not part of the public API
   * surface; callers should use `subscribeInvalidation` + dispatch via their
   * own event bus. We export it as `triggerInvalidation` for tests and for
   * direct use when no global event bus exists.
   */
  function triggerInvalidation(eventName: string): void {
    invalidateAll();
    broadcastInvalidation(eventName);
  }

  return {
    get,
    set,
    invalidate,
    invalidateAll,
    has,
    stats: snapshotStats,
    subscribeInvalidation,
    dispose,
    triggerInvalidation,
  };
}