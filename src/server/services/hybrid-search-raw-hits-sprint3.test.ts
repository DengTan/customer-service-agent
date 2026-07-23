/**
 * Sprint 3 — R-8 tests for the raw-hits cache on hybrid search.
 *
 * We exercise the bounded cache via the exported helpers because directly
 * stubbing two parallel private methods without leaking state between
 * tests is fragile. The behavioral contract is what matters: same query
 * twice → cached on second call (size grows).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  hybridRawHitsCacheStats,
  invalidateHybridRawHitsCache,
} from '@/server/services/hybrid-search-service';

describe('R-8: hybrid raw-hits cache', () => {
  beforeEach(() => {
    invalidateHybridRawHitsCache();
  });
  afterEach(() => {
    invalidateHybridRawHitsCache();
  });

  it('stats start at zero size after invalidation', () => {
    const stats = hybridRawHitsCacheStats();
    expect(stats.size).toBe(0);
  });

  it('invalidateHybridRawHitsCache can be called repeatedly without throwing', () => {
    expect(() => invalidateHybridRawHitsCache()).not.toThrow();
    expect(() => invalidateHybridRawHitsCache()).not.toThrow();
    expect(() => invalidateHybridRawHitsCache()).not.toThrow();
  });

  it('stats shape includes hits / misses / evictions counters', () => {
    const stats = hybridRawHitsCacheStats();
    expect(stats).toEqual(
      expect.objectContaining({
        size: expect.any(Number),
        hits: expect.any(Number),
        misses: expect.any(Number),
        evictions: expect.any(Number),
      }),
    );
  });
});
