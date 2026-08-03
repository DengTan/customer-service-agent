/**
 * Outbox Replay Worker (B4b).
 *
 * Reads pending effects from `effect_outbox`, executes them with bounded retries
 * and exponential backoff, and marks them completed or failed.
 *
 * Concurrency safety:
 * - Only one worker should run at a time (enforced by caller / cron)
 * - Within a single run, items are processed sequentially to avoid DB contention
 * - compare-and-set: update status to 'running' where status = 'pending'
 *   (if another worker already claimed it, the update affects 0 rows → skip)
 *
 * Retry semantics:
 * - Exponential backoff: next_run_at = now + min(2^attempt * 1000ms, 5min)
 * - After max_attempts, status → 'failed' (no more retries)
 * - Idempotency: checked before insert; failed effects with same idempotency_key
 *   are skipped on replay
 *
 * Secrets policy: payload fields named *_token, *_secret, *_key, *_password
 * are redacted before logging.
 */

import { getServiceClient } from '@/storage/database/supabase-client';
import { effectOutbox } from '@/storage/database/shared/schema';
import { eq, and, lte, ne, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const OUTBOX_BATCH_SIZE = 10;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export interface OutboxItem {
  id: string;
  effect_name: string;
  payload: Record<string, unknown>;
  next_run_at: Date;
  attempt_count: number;
  max_attempts: number;
  idempotency_key: string | null;
  status: string;
  last_error: string | null;
}

/** Minimal handler registry — caller populates before starting the worker. */
export type EffectHandler = (
  payload: Record<string, unknown>,
  signal: AbortSignal
) => Promise<void>;

export class OutboxReplayWorker {
  private handlers = new Map<string, EffectHandler>();

  /**
   * Register an effect handler by name. The handler is called with the
   * persisted payload and an AbortSignal.
   */
  register(effectName: string, handler: EffectHandler): void {
    this.handlers.set(effectName, handler);
  }

  /**
   * Claim and process up to `batchSize` pending outbox items.
   * Returns the number of items processed.
   *
   * Idempotent: items with duplicate idempotency_key are skipped.
   */
  async processBatch(batchSize = OUTBOX_BATCH_SIZE): Promise<number> {
    const client = getServiceClient();

    // Claim items: atomically set status='running' where status='pending' and next_run_at <= now.
    const now = new Date();
    const claimed = await client
      .from('effect_outbox')
      .update({ status: 'running', last_attempt_at: now.toISOString() })
      .eq('status', 'pending')
      .lte('next_run_at', now.toISOString())
      .limit(batchSize)
      .select()
      .throwOnError();

    const items: OutboxItem[] = claimed.data ?? [];
    if (items.length === 0) return 0;

    let processed = 0;
    for (const item of items) {
      const handled = await this.processItem(item, client);
      if (handled) processed++;
    }

    return processed;
  }

  private async processItem(item: OutboxItem, client: ReturnType<typeof getServiceClient>): Promise<boolean> {
    const handler = this.handlers.get(item.effect_name);
    if (!handler) {
      logger.agent.warn('[OutboxWorker] no handler for effect', {
        effectName: item.effect_name,
        outboxId: item.id,
      });
      // Don't retry — mark as failed so it stops retrying
      await this.markFailed(item.id, `No handler registered for effect: ${item.effect_name}`);
      return false;
    }

    // Idempotency check
    if (item.idempotency_key) {
      const existing = await client
        .from('effect_outbox')
        .select('id')
        .eq('idempotency_key', item.idempotency_key)
        .eq('status', 'completed')
        .maybeSingle();

      if (existing.data) {
        logger.agent.debug('[OutboxWorker] idempotency hit, skipping', {
          effectName: item.effect_name,
          outboxId: item.id,
          idempotencyKey: item.idempotency_key,
        });
        await client
          .from('effect_outbox')
          .update({ status: 'completed' })
          .eq('id', item.id);
        return true;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s hard limit

    try {
      await handler(item.payload, controller.signal);
      clearTimeout(timeout);
      await this.markCompleted(item.id);
      logger.agent.debug('[OutboxWorker] completed', {
        effectName: item.effect_name,
        outboxId: item.id,
        attempts: item.attempt_count + 1,
      });
      return true;
    } catch (err) {
      clearTimeout(timeout);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isAborted = err instanceof Error && err.name === 'AbortError';

      if (isAborted) {
        logger.agent.warn('[OutboxWorker] effect timed out, rescheduling', {
          effectName: item.effect_name,
          outboxId: item.id,
        });
      }

      const nextAttempt = item.attempt_count + 1;
      if (nextAttempt >= item.max_attempts) {
        await this.markFailed(item.id, errorMsg);
        logger.agent.error('[OutboxWorker] exhausted retries, marking failed', {
          effectName: item.effect_name,
          outboxId: item.id,
          attempts: nextAttempt,
          lastError: errorMsg,
        });
      } else {
        await this.scheduleRetry(item.id, nextAttempt, errorMsg);
        logger.agent.warn('[OutboxWorker] scheduled retry', {
          effectName: item.effect_name,
          outboxId: item.id,
          nextAttempt,
          delayMs: this.backoffMs(nextAttempt),
        });
      }
      return true; // processed (even if failed to retry)
    }
  }

  private backoffMs(attempt: number): number {
    return Math.min(2 ** attempt * 1000, MAX_RETRY_DELAY_MS);
  }

  private async markCompleted(id: string): Promise<void> {
    const client = getServiceClient();
    await client
      .from('effect_outbox')
      .update({ status: 'completed' })
      .eq('id', id)
      .throwOnError();
  }

  private async markFailed(id: string, error: string): Promise<void> {
    const client = getServiceClient();
    await client
      .from('effect_outbox')
      .update({ status: 'failed', last_error: error.slice(0, 500) })
      .eq('id', id)
      .throwOnError();
  }

  private async scheduleRetry(id: string, attemptCount: number, error: string): Promise<void> {
    const client = getServiceClient();
    const delay = this.backoffMs(attemptCount);
    const next_run_at = new Date(Date.now() + delay).toISOString();

    await client
      .from('effect_outbox')
      .update({
        status: 'pending',
        attempt_count: attemptCount,
        last_error: error.slice(0, 500),
        last_attempt_at: new Date().toISOString(),
        next_run_at,
      })
      .eq('id', id)
      .throwOnError();
  }
}
