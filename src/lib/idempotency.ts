/**
 * Idempotency wrapper for SmartAssist.
 *
 * Solves the root-cause #2 of the multi-agent audit: the same webhook event
 * or side-effect-prone operation can be retried by Supabase / Gorgias / our
 * own queue, leading to duplicate AI replies, double-decrements, and
 * double-inserts.
 *
 * Two scopes are provided:
 * - `memory`: in-process `Map` with TTL sliding window. Cheap, but not
 *   shared between instances. Suitable for development and short-lived
 *   operations.
 * - `persistent`: external store backed by the `webhook_event_processed`
 *   table (or a caller-supplied compatible interface). Cross-instance safe.
 *
 * IMPORTANT: when `rollbackOnError: true`, a thrown error will clear the
 * idempotency key so the next retry can re-run the operation. Use this for
 * "rate-limited retry on next attempt" semantics (e.g. lastAIReplyTime).
 */

import { logger } from '@/lib/logger';
import type { GorgiasTicketId } from '@/lib/repository-errors';

// ─── Sentinel ───────────────────────────────────────────────────────────────

/**
 * Sentinel returned by `idempotent()` when a duplicate is detected. Use a
 * `===` check to detect the skipped path; do NOT use truthy/falsy because
 * valid results may legitimately be falsy (0, '', false, null).
 */
export const SKIPPED: unique symbol = Symbol('idempotent.skipped');
export type SkippedResult = typeof SKIPPED;

// ─── Core Types ─────────────────────────────────────────────────────────────

export interface IdempotencyOptions {
  /**
   * Pre-built key (e.g. `createIdempotencyKey(...)`). Must be stable across
   * retries — never include timestamps or random values.
   */
  key: string;
  /**
   * Sliding window length in milliseconds. After this many ms the key
   * expires and the operation can run again.
   */
  windowMs: number;
  /**
   * `memory`: process-local. `persistent`: external store.
   */
  scope: 'persistent' | 'memory';
  /**
   * When true, a thrown error removes the key so the next retry can run.
   * Defaults to `true` for `persistent` scope (idempotent retries must work)
   * and `false` for `memory` scope (sliding TTL handles expiry naturally).
   */
  rollbackOnError?: boolean;
  /**
   * Required for `persistent` scope. The `key` itself is treated as the
   * caller-asserted dedup key — no implicit hashing is applied.
   */
  persistentStore?: IdempotencyStore;
}

export interface IdempotencyResult<T> {
  /** The function's return value, or SKIPPED if a duplicate was detected. */
  value: T | SkippedResult;
  /** True if the operation was skipped because the key was already in-flight. */
  skipped: boolean;
  /** Number of attempts suppressed within the current window (>= 1 if skipped). */
  attempts: number;
}

// ─── In-Memory Store ────────────────────────────────────────────────────────

interface MemoryEntry {
  /** Number of times this key was hit within the window. */
  attempts: number;
  /** Timestamp when this entry expires. */
  expiresAt: number;
}

export class MemoryIdempotencyStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly sweepIntervalMs: number = 60_000) {
    if (typeof setInterval !== 'undefined' && this.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
      // Don't keep the Node.js event loop alive just for this sweep.
      if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
    }
  }

  /** Returns true if the key was newly added (not seen before in this window). */
  tryAcquire(key: string, windowMs: number, now: number = Date.now()): boolean {
    this.purgeExpired(now);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      existing.attempts++;
      return false;
    }
    this.entries.set(key, { attempts: 1, expiresAt: now + windowMs });
    return true;
  }

  /** Forcibly remove a key, e.g. when an operation failed and should be retryable. */
  release(key: string): void {
    this.entries.delete(key);
  }

  /** Read-only view, primarily for tests / stats. */
  peek(key: string): MemoryEntry | undefined {
    return this.entries.get(key);
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.entries.clear();
  }

  private purgeExpired(now: number): void {
    for (const [k, v] of this.entries) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
  }

  private sweep(): void {
    this.purgeExpired(Date.now());
  }
}

// ─── Persistent Store ───────────────────────────────────────────────────────

export interface IdempotencyStore {
  /**
   * Atomically reserve the key. Returns `true` if this caller now owns the
   * slot (and the operation may proceed), or `false` if the key is already
   * reserved/completed by another caller.
   *
   * Implementations MUST be atomic across concurrent invocations. For
   * Supabase this is typically a unique-constraint INSERT.
   */
  tryAcquire(key: string, windowMs: number): Promise<boolean>;
  /** Remove the reservation, allowing the next retry to acquire. */
  release(key: string): Promise<void>;
}

/**
 * Default concrete implementation of `PersistentIdempotencyStore`, backed
 * by the Supabase `webhook_event_processed` table.
 *
 * This table already exists in the remote database (see
 * SECURITY_MIGRATION_BASELINE.md — RLS enabled, service_role policy).
 * Schema:
 *   event_id      text primary key
 *   event_type    text
 *   processed_at  timestamptz
 *
 * `tryAcquire` performs an INSERT with `ON CONFLICT DO NOTHING` (driven by
 * the PK violation 23505). If a row was inserted, the caller owns the slot.
 * `release` deletes the row.
 */
export class PersistentIdempotencyStore implements IdempotencyStore {
  constructor(private readonly supabase: SupabaseClientLike) {}

  async tryAcquire(key: string, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = new Date(now + windowMs).toISOString();
    const { error } = await this.supabase
      .from('webhook_event_processed')
      .insert({
        event_id: key,
        event_type: 'idempotency_reservation',
        processed_at: expiresAt,
      });

    if (!error) return true;

    // 23505 = unique_violation: someone else already holds the slot.
    if (error.code === '23505') return false;

    // Any other error — fail closed (do not execute the operation; the
    // caller should treat this as "not idempotent" and avoid running).
    logger.api?.warn?.('idempotency: persistent acquire failed', {
      key,
      code: error.code,
      message: error.message,
    });
    throw new Error(`persistent idempotency acquire failed: ${error.message}`);
  }

  async release(key: string): Promise<void> {
    const { error } = await this.supabase
      .from('webhook_event_processed')
      .delete()
      .eq('event_id', key);
    if (error) {
      logger.api?.warn?.('idempotency: persistent release failed', {
        key,
        code: error.code,
        message: error.message,
      });
    }
  }
}

/**
 * Minimal Supabase client shape used by `SupabaseWebhookEventStore`.
 * Decouples this module from the SDK version.
 */
export interface SupabaseClientLike {
  from(table: string): {
    insert(row: Record<string, unknown>): Promise<{ error: { code?: string; message?: string } | null }>;
    delete(): {
      eq(col: string, val: string): Promise<{ error: { code?: string; message?: string } | null }>;
    };
  };
}

// (PersistentIdempotencyStore is defined above as a class; no re-export.)

// ─── Idempotent Wrapper ─────────────────────────────────────────────────────

const DEFAULT_MEMORY_STORE = new MemoryIdempotencyStore();

/**
 * Run `fn` exactly once within the given window for the given key.
 *
 * @example
 * ```ts
 * const result = await idempotent(
 *   { key: createIdempotencyKey('webhook', ticketId, eventType), windowMs: 30_000, scope: 'persistent' },
 *   async () => syncMessages(ticketId),
 * );
 * if (result.value === SKIPPED) {
 *   return apiSuccess({ duplicate: true });
 * }
 * ```
 */
export async function idempotent<T>(
  options: IdempotencyOptions,
  fn: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  const { key, windowMs, scope } = options;
  const rollbackOnError =
    options.rollbackOnError ?? (scope === 'persistent');

  if (scope === 'memory') {
    const acquired = DEFAULT_MEMORY_STORE.tryAcquire(key, windowMs);
    if (!acquired) {
      const entry = DEFAULT_MEMORY_STORE.peek(key);
      return { value: SKIPPED, skipped: true, attempts: entry?.attempts ?? 1 };
    }
    return runWithOptionalRollback(fn, key, rollbackOnError, async () => {
      DEFAULT_MEMORY_STORE.release(key);
    });
  }

  // Persistent scope — caller MUST provide a store.
  if (!options.persistentStore) {
    throw new Error(
      'idempotent(): scope="persistent" requires `persistentStore` to be provided',
    );
  }
  const acquired = await options.persistentStore.tryAcquire(key, windowMs);
  if (!acquired) {
    return { value: SKIPPED, skipped: true, attempts: 1 };
  }
  return runWithOptionalRollback(fn, key, rollbackOnError, async () => {
    await options.persistentStore!.release(key);
  });
}

async function runWithOptionalRollback<T>(
  fn: () => Promise<T>,
  key: string,
  rollbackOnError: boolean,
  rollback: () => Promise<void>,
): Promise<IdempotencyResult<T>> {
  try {
    const value = await fn();
    return { value, skipped: false, attempts: 1 };
  } catch (err) {
    if (rollbackOnError) {
      try {
        await rollback();
      } catch (releaseErr) {
        logger.api?.warn?.('idempotency: rollback after error failed', {
          key,
          error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      }
    }
    throw err;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a stable idempotency key from a logical prefix and one or more
 * stringifiable parts. The output is `{prefix}:{hash(parts)}` so it is
 * safe to log and to query.
 *
 * IMPORTANT: callers must NOT include timestamps, request IDs, or anything
 * that changes between retries — otherwise idempotency silently breaks.
 */
export function createIdempotencyKey(
  prefix: string,
  ...parts: Array<string | number | GorgiasTicketId>
): string {
  const normalized = parts.map((p) => String(p)).join('|');
  return `${prefix}:${fnv1a64(normalized)}`;
}

/**
 * FNV-1a 64-bit hash. Stable across runtimes, no Node-only deps, and
 * deterministic — required so that retries compute the same key as the
 * initial attempt.
 *
 * We expose this function primarily so tests can pre-compute expected keys.
 */
export function fnv1a64(input: string): string {
  // 64-bit FNV-1a using two 32-bit halves. BigInt is available in Node and
  // modern browsers (we target es2017+).
  let hash = BigInt('0xcbf29ce484222325');
  const prime = BigInt('0x100000001b3');
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  // Render as 16-char lowercase hex.
  return hash.toString(16).padStart(16, '0');
}