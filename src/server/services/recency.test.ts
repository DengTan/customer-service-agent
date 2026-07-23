/**
 * Sprint 3 — R-2: recency utility tests.
 *
 * The recency utility is pure (takes `now` as an arg) so it can be tested
 * deterministically across all three orchestrator return paths (hit /
 * miss / partial).
 */
import { describe, it, expect } from 'vitest';
import { computeRecencyScore, annotateRecency, RECENCY_UNKNOWN_TIMESTAMP, RECENCY_HALF_LIFE_DAYS } from '@/server/services/recency';

describe('R-2: computeRecencyScore', () => {
  const NOW = new Date('2026-07-18T00:00:00Z');
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  it('returns ~1 for an item updated exactly at `now`', () => {
    expect(computeRecencyScore({ updatedAt: NOW }, NOW)).toBeCloseTo(1, 5);
  });

  it('returns ~0.5 for an item updated RECENCY_HALF_LIFE_DAYS ago (hit path)', () => {
    const longAgo = new Date(NOW.getTime() - RECENCY_HALF_LIFE_DAYS * ONE_DAY_MS);
    expect(computeRecencyScore({ updatedAt: longAgo }, NOW)).toBeCloseTo(0.5, 2);
  });

  it('returns ~0 for an item much older than half-life (partial path)', () => {
    const ancient = new Date(NOW.getTime() - 10 * RECENCY_HALF_LIFE_DAYS * ONE_DAY_MS);
    const score = computeRecencyScore({ updatedAt: ancient }, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(0.01);
  });

  it('prefers lastHitAt over updatedAt when both are set', () => {
    const recentlyHit = new Date(NOW.getTime() - ONE_DAY_MS);
    const ancientUpdate = new Date(NOW.getTime() - 365 * ONE_DAY_MS);
    expect(
      computeRecencyScore({ updatedAt: ancientUpdate, lastHitAt: recentlyHit }, NOW),
    ).toBeGreaterThan(0.99);
  });

  it('returns the unknown-timestamp sentinel when no timestamp is provided', () => {
    expect(computeRecencyScore({}, NOW)).toBe(RECENCY_UNKNOWN_TIMESTAMP);
    expect(computeRecencyScore({ updatedAt: null, lastHitAt: null }, NOW)).toBe(RECENCY_UNKNOWN_TIMESTAMP);
  });

  it('returns 1 for items with a future timestamp (clock skew tolerance)', () => {
    expect(computeRecencyScore({ updatedAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(1);
  });
});

describe('R-2: annotateRecency', () => {
  const NOW = new Date('2026-07-18T00:00:00Z');

  it('annotates each item with a recency field', () => {
    const items = [
      { id: 'a', updatedAt: NOW },
      { id: 'b', updatedAt: undefined },
    ];
    const out = annotateRecency(items, NOW);
    expect(out[0].recency).toBeCloseTo(1, 5);
    expect(out[1].recency).toBe(RECENCY_UNKNOWN_TIMESTAMP);
  });

  it('preserves all original fields on each item', () => {
    const items = [{ id: 'a', name: 'FAQ', updatedAt: NOW.toISOString() }];
    const out = annotateRecency(items, NOW);
    expect(out[0].id).toBe('a');
    expect(out[0].name).toBe('FAQ');
    expect(out[0].updatedAt).toBe(NOW.toISOString());
  });
});
