/**
 * Sprint 3 — Retrieval recency utility (R-2).
 *
 * The retrieval orchestrator surfaces `recency` as a soft evidence-weighting
 * signal. It is NOT used to discard matches on its own — it is recorded as
 * trace metadata so downstream callers (LLM context injection, citation
 * ranking, governance) can downrank stale references when they choose to.
 *
 * Why a soft signal instead of a hard filter:
 * - A knowledge item that was created yesterday is still authoritative as long
 *   as no newer superseding version exists.
 * - The HTTP projection of `knowledge_items.updated_at` is the canonical
 *   freshness signal. We map recency to a [0, 1] score using a half-life of
 *   `RECENCY_HALF_LIFE_DAYS` (default 90 days), so brand-new items get a score
 *   close to 1 and items older than ~1 year decay to near-zero.
 *
 * The function is intentionally pure (no clock reads inside) so it can be
 * deterministic-tested by passing `now` explicitly.
 */

/** Number of days after which freshness halves. */
export const RECENCY_HALF_LIFE_DAYS = 90;

/** Maximum recency score returned for an item that has no timestamp. */
export const RECENCY_UNKNOWN_TIMESTAMP = 0.5;

interface RecencyInput {
  /** Last update timestamp (ISO string, epoch ms, or Date). */
  updatedAt?: string | number | Date | null;
  /** Last hit timestamp; falls back to updatedAt when present. */
  lastHitAt?: string | number | Date | null;
}

/**
 * Compute a recency score in [0, 1] for a knowledge item.
 *
 * - Returns `RECENCY_UNKNOWN_TIMESTAMP` (0.5) when no timestamp is available.
 * - Returns 1.0 for an item updated exactly at `now`.
 * - Returns ~0.5 for an item updated `RECENCY_HALF_LIFE_DAYS` ago.
 * - Returns ~0 when an item is older than ~5 half-lives.
 *
 * `lastHitAt` is preferred over `updatedAt` when both are set — recently-hit
 * items tend to be currently relevant even when the underlying content was
 * edited long ago.
 */
export function computeRecencyScore(
  result: RecencyInput,
  now: Date = new Date(),
): number {
  const ts = toEpochMs(result.lastHitAt) ?? toEpochMs(result.updatedAt);
  if (ts === null) return RECENCY_UNKNOWN_TIMESTAMP;
  const ageDays = (now.getTime() - ts) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  // Exponential decay with half-life H: score = 2^(-ageDays / H)
  return Math.max(0, Math.min(1, Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS)));
}

/**
 * Apply `computeRecencyScore` to every candidate in an array. The function
 * tolerates items that lack timestamps by returning the configured
 * `RECENCY_UNKNOWN_TIMESTAMP` floor.
 */
export function annotateRecency<T extends RecencyInput>(items: readonly T[], now: Date = new Date()): Array<T & { recency: number }> {
  return items.map(item => ({ ...item, recency: computeRecencyScore(item, now) }));
}

function toEpochMs(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
