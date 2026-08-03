/**
 * Effect Bus (B4a).
 *
 * A typed, abortable side-effect queue for post-stream operations.
 *
 * Problem: LLM streaming responses need multiple side-effects (save message,
 * bump counter, update summary, alert, quality check, knowledge gap) that
 * must be skipped when the client disconnects. Currently these are fire-and-forget
 * calls scattered in the SSE handler, creating the risk of:
 *  - Writes completing AFTER the stream was aborted (RC-5)
 *  - No retry semantics when a write fails
 *  - No visibility into which effects ran or failed
 *
 * Solution: Register effects with an explicit mode and AbortSignal. The bus
 * coordinates their execution, propagates abort, and optionally persists failed
 * effects to an outbox for replay.
 *
 * Usage:
 * ```ts
 * const bus = new EffectBus();
 *
 * // Critical: must eventually succeed (e.g., save assistant message)
 * bus.register('saveMessage', {
 *   mode: 'critical',
 *   execute: async (ctx) => { await messageRepository.insert(ctx.message); },
 * });
 *
 * // Best-effort: can fail silently (e.g., quality check, alerts)
 * bus.register('qualityCheck', {
 *   mode: 'best-effort',
 *   execute: async (ctx) => { await qualityService.run(...); },
 * });
 *
 * // Execute all effects with abort propagation
 * await bus.dispatch(context, signal);
 *
 * // Abort all in-flight effects
 * bus.abort();
 * ```
 *
 * The outbox integration (B4b) stores failed 'critical' effects so they can
 * be replayed by the OutboxReplayWorker.
 */

import { logger } from '@/lib/logger';

export type EffectMode = 'critical' | 'best-effort';

export interface EffectContext {
  conversationId: string;
  [key: string]: unknown;
}

export interface EffectOptions {
  /** 'critical' effects are persisted to the outbox on failure and retried. */
  mode: EffectMode;
  /**
   * The effect function. Receives the shared context and an AbortSignal.
   * Throw to signal failure (triggers outbox for critical effects).
   */
  execute: (ctx: EffectContext, signal: AbortSignal) => Promise<void>;
  /** Human-readable name for logs. */
  name?: string;
}

interface RegisteredEffect {
  key: string;
  options: EffectOptions;
}

/**
 * A registry + dispatcher for typed side-effects.
 *
 * Effects are registered with a string key. The same key can be registered
 * multiple times (all handlers fire); use unique keys per logical effect.
 */
export class EffectBus {
  private effects = new Map<string, RegisteredEffect>();

  /**
   * Register an effect. Idempotent for the same key (later registrations
   * overwrite earlier ones).
   */
  register(key: string, options: EffectOptions): void {
    this.effects.set(key, { key, options });
    logger.agent.debug('[EffectBus] registered', { key, mode: options.mode });
  }

  /** Unregister an effect by key. */
  unregister(key: string): void {
    this.effects.delete(key);
  }

  /**
   * Execute all registered effects with the given context.
   *
   * @param ctx - Shared context passed to every effect.
   * @param signal - AbortSignal to propagate. All effects check this before/during execution.
   * @param onCriticalFailure - Called when a critical effect fails. Implementations
   *   should persist the effect to the outbox table.
   *
   * Best-effort failures are logged but do not throw.
   * Critical failures invoke onCriticalFailure and re-throw.
   */
  async dispatch(
    ctx: EffectContext,
    signal: AbortSignal,
    onCriticalFailure?: (key: string, ctx: EffectContext, err: unknown) => Promise<void>
  ): Promise<void> {
    const entries = Array.from(this.effects.values());

    for (const { key, options } of entries) {
      if (signal.aborted) {
        logger.agent.debug('[EffectBus] skipping (signal aborted)', { key });
        continue;
      }

      try {
        logger.agent.debug('[EffectBus] executing', { key, mode: options.mode });
        await options.execute(ctx, signal);
        logger.agent.debug('[EffectBus] completed', { key });
      } catch (err) {
        if (signal.aborted) {
          logger.agent.warn('[EffectBus] aborted during execution', { key });
          return;
        }

        if (options.mode === 'best-effort') {
          logger.agent.warn('[EffectBus] best-effort effect failed (ignoring)', {
            key,
            error: err instanceof Error ? err.message : String(err),
          });
        } else {
          logger.agent.error('[EffectBus] critical effect failed', {
            key,
            error: err instanceof Error ? err.message : String(err),
          });
          if (onCriticalFailure) {
            await onCriticalFailure(key, ctx, err).catch((e) => {
              logger.agent.error('[EffectBus] critical failure handler threw', {
                key,
                error: e instanceof Error ? e.message : String(e),
              });
            });
          }
          throw err; // propagate so caller knows critical failed
        }
      }
    }
  }

  /** Remove all registered effects. */
  clear(): void {
    this.effects.clear();
  }

  /** Number of registered effects. */
  get size(): number {
    return this.effects.size;
  }

  /** List registered effect keys. */
  keys(): IterableIterator<string> {
    return this.effects.keys();
  }
}
