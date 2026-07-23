/**
 * Batch operation orchestrator for SmartAssist.
 *
 * Solves root-cause #3 of the multi-agent audit: nine P0/P1/P2 issues stem
 * from the same pattern — `Promise.all` over an unbounded list of items,
 * each of which can independently fail or duplicate. The orchestrator
 * unifies these into a single API with explicit error and dedup semantics.
 *
 * Capabilities:
 * - `onError: 'fail-fast'`     — short-circuit on first error (sequential).
 * - `onError: 'best-effort'`   — run all, collect errors (parallel).
 * - `dedupeBy`                 — group by key, process only the first.
 * - `chunkSize`                — process the (deduped) list in chunks.
 * - `rollback(ctx)`            — optional best-effort cleanup invoked when
 *                                `transactional: true` and at least one
 *                                failure occurred.
 */

import { logger } from '@/lib/logger';

// ─── Public API ─────────────────────────────────────────────────────────────

export interface BatchOptions<T, R> {
  /** Arbitrary context for logs / tracing. */
  context?: Record<string, unknown>;
  /** Items per chunk. `0` / `undefined` means no chunking. */
  chunkSize?: number;
  /**
   * - `'fail-fast'`   : stop at first error and re-throw.
   * - `'best-effort'` : continue, collect errors in `result.errors`.
   */
  onError: 'fail-fast' | 'best-effort';
  /**
   * Optional key extractor. Items that produce the same key are grouped;
   * only the FIRST item in each group is processed.
   */
  dedupeBy?: (item: T, index: number) => string;
  /**
   * When true and any error occurred, invoke `rollback` after the batch
   * completes (or short-circuits). Best-effort — rollback errors are
   * logged but do not replace the original errors.
   */
  transactional?: boolean;
  /**
   * Best-effort cleanup. Receives each successfully-processed item so the
   * caller can undo its side effects.
   */
  rollback?: (item: T, result: R) => Promise<void> | void;
}

export interface BatchResult<T, R> {
  results: Array<{ item: T; result: R }>;
  errors: Array<{ item: T; error: unknown }>;
  /** Number of items removed by `dedupeBy` (i.e. not processed). */
  deduped: number;
  /** Total items the caller passed in. */
  total: number;
  /** Items actually processed (= `total - deduped`). */
  processed: number;
}

export type BatchProcessor<T, R> = (
  item: T,
  index: number,
) => Promise<R> | R;

// ─── Implementation ─────────────────────────────────────────────────────────

export async function runBatch<T, R>(
  items: readonly T[],
  processor: BatchProcessor<T, R>,
  options: BatchOptions<T, R>,
): Promise<BatchResult<T, R>> {
  const total = items.length;
  const ctx = options.context ?? {};

  // 1. Dedup pass (in-place grouping by key).
  const dedupMap = new Map<string, { item: T; index: number }>();
  const deduped: Array<{ item: T; index: number }> = [];
  let dropped = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    if (!options.dedupeBy) {
      deduped.push({ item, index: i });
      continue;
    }
    const key = options.dedupeBy(item, i);
    if (!dedupMap.has(key)) {
      dedupMap.set(key, { item, index: i });
      deduped.push({ item, index: i });
    } else {
      dropped++;
    }
  }

  logger.api?.debug?.('tx.runBatch: starting', {
    total,
    deduped: dropped,
    onError: options.onError,
    chunkSize: options.chunkSize,
    ...ctx,
  });

  const chunkSize = options.chunkSize && options.chunkSize > 0 ? options.chunkSize : deduped.length;
  const results: BatchResult<T, R>['results'] = [];
  const errors: BatchResult<T, R>['errors'] = [];
  const successes: Array<{ item: T; result: R }> = [];

  if (options.onError === 'fail-fast') {
    // Sequential: stop on first error.
    outer: for (let i = 0; i < deduped.length; i += chunkSize) {
      const chunk = deduped.slice(i, i + chunkSize);
      for (let j = 0; j < chunk.length; j++) {
        const { item, index } = chunk[j] as { item: T; index: number };
        try {
          const result = await processor(item, index);
          const entry = { item, result };
          results.push(entry);
          successes.push(entry);
        } catch (err) {
          errors.push({ item, error: err });
          await maybeRollback(options, successes);
          logger.api?.error?.('tx.runBatch: fail-fast error', {
            error: err instanceof Error ? err.message : String(err),
            index,
            ...ctx,
          });
          throw err;
          // Use of labelled `break outer` keeps tsc happy when chunkSize>1.
          break outer;
        }
      }
    }
  } else {
    // Best-effort: parallel within chunks, sequential across chunks so we
    // can observe progress and stay within memory / connection limits.
    for (let i = 0; i < deduped.length; i += chunkSize) {
      const chunk = deduped.slice(i, i + chunkSize);
      const settled = await Promise.allSettled(
        chunk.map(({ item, index }) => Promise.resolve().then(() => processor(item, index))),
      );
      for (let j = 0; j < chunk.length; j++) {
        const { item } = chunk[j] as { item: T; index: number };
        const s = settled[j] as PromiseSettledResult<R>;
        if (s.status === 'fulfilled') {
          const entry = { item, result: s.value };
          results.push(entry);
          successes.push(entry);
        } else {
          errors.push({ item, error: s.reason });
        }
      }
    }

    if (errors.length > 0) {
      await maybeRollback(options, successes);
    }
  }

  return {
    results,
    errors,
    deduped: dropped,
    total,
    processed: deduped.length,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function maybeRollback<T, R>(
  options: BatchOptions<T, R>,
  successes: ReadonlyArray<{ item: T; result: R }>,
): Promise<void> {
  if (!options.transactional || !options.rollback) return;
  if (successes.length === 0) return;

  // Roll back in reverse order so dependents undo first.
  for (let i = successes.length - 1; i >= 0; i--) {
    const { item, result } = successes[i] as { item: T; result: R };
    try {
      await options.rollback(item, result);
    } catch (err) {
      logger.api?.warn?.('tx.runBatch: rollback step failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}