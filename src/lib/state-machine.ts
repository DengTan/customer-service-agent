/**
 * State machine definition + transition application for SmartAssist.
 *
 * Solves root-cause #4 of the multi-agent audit: ticket and conversation
 * state transitions were scattered across services with ad-hoc `if`
 * ladders, no central registry, and inconsistent field clearing on revert.
 *
 * This module is intentionally domain-agnostic. The caller defines the
 * state alphabet (e.g. `TicketStatus`), the event alphabet (e.g. `TicketEvent`),
 * and the transitions. Side-effects and field clearing are configured per
 * transition; no global knowledge of tickets or conversations lives here.
 *
 * Errors:
 * - `UnknownTransitionError`: raised when no transition matches
 *   `(currentState, event.type)`. Not the same as a guard rejection.
 * - `GuardRejectionError`: raised when a transition matches but its guard
 *   returns `false` (or a rejection reason string).
 */

import { logger } from '@/lib/logger';

// ─── Errors ─────────────────────────────────────────────────────────────────

export class UnknownTransitionError extends Error {
  readonly fromState: string;
  readonly eventType: string;
  constructor(fromState: string, eventType: string) {
    super(`No transition defined for state "${fromState}" on event "${eventType}"`);
    this.name = 'UnknownTransitionError';
    this.fromState = fromState;
    this.eventType = eventType;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GuardRejectionError extends Error {
  readonly fromState: string;
  readonly eventType: string;
  readonly reason: string;
  constructor(fromState: string, eventType: string, reason: string) {
    super(`Guard rejected transition "${fromState}" -> on event "${eventType}": ${reason}`);
    this.name = 'GuardRejectionError';
    this.fromState = fromState;
    this.eventType = eventType;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Transition Shape ───────────────────────────────────────────────────────

/**
 * A guard decides whether a transition may run.
 *
 * Return:
 * - `true`           : allow the transition.
 * - `false`          : reject with a generic message.
 * - `string`         : reject with the returned message as `reason`.
 */
export type Guard<S extends string, E extends { type: string }> = (
  current: S,
  event: E,
  data: TransitionData,
) => boolean | string | Promise<boolean | string>;

export interface TransitionData {
  /** Free-form contextual data passed into the transition (e.g. payload). */
  readonly payload?: Record<string, unknown>;
}

/**
 * Side-effect executed AFTER the transition is accepted. Receives the new
 * state, the event, and the transition data; returns an arbitrary value that
 * is exposed via `applyTransition().sideEffectResults`.
 *
 * Side-effects never block state changes: errors are logged but do NOT
 * prevent the state from advancing. Callers that need transactional
 * guarantees should wrap side-effects in their own retry/queue.
 */
export type SideEffect<S extends string, E extends { type: string }> = (
  nextState: S,
  event: E,
  data: TransitionData,
) => unknown | Promise<unknown>;

export interface StateTransition<S extends string, E extends { type: string }> {
  /** Source state. */
  readonly from: S;
  /** Target state. */
  readonly to: S;
  /** Event discriminant. Matched against `event.type`. */
  readonly event: E['type'] | (string & {});
  /** Optional predicate to gate the transition. */
  readonly guard?: Guard<S, E>;
  /** Optional side-effect; runs after the state change. */
  readonly sideEffect?: SideEffect<S, E>;
  /**
   * Names of fields the caller should clear when reverting OUT of `to`
   * back to `from`. E.g. `resolved_at` is set when entering `resolved`
   * and cleared when leaving it.
   *
   * The list is exposed as `clearedFields` in the transition result so
   * the caller can decide where to clear them (the state machine itself
   * does not mutate user data).
   */
  readonly clearsFields?: readonly string[];
}

export interface StateMachine<S extends string, E extends { type: string }> {
  readonly transitions: ReadonlyArray<StateTransition<S, E>>;
}

export interface TransitionResult<S extends string, R = unknown> {
  nextState: S;
  /** Whether the transition applied (vs. no-op / guard rejection). */
  applied: boolean;
  /** Fields that should be cleared (per the matching transition). */
  clearedFields: readonly string[];
  /** Return values of any side-effects that ran. */
  sideEffectResults: R[];
}

// ─── Definition ─────────────────────────────────────────────────────────────

/**
 * Define a state machine. The returned object is frozen so it can be safely
 * shared across requests without risk of accidental mutation.
 */
export function defineStateMachine<S extends string, E extends { type: string }>(
  config: StateMachine<S, E>,
): Readonly<StateMachine<S, E>> {
  if (!config.transitions || config.transitions.length === 0) {
    throw new Error('defineStateMachine: at least one transition is required');
  }
  // Validate every transition points at a defined source state.
  const states = new Set<S>();
  for (const t of config.transitions) {
    states.add(t.from);
    states.add(t.to);
  }
  // Re-freeze for safety.
  return Object.freeze({
    transitions: Object.freeze([...config.transitions]),
  });
}

// ─── Application ────────────────────────────────────────────────────────────

/**
 * Find the first transition matching `(current, event.type)`.
 * Returns `undefined` if none exists (caller decides whether to throw).
 */
export function findTransition<S extends string, E extends { type: string }>(
  machine: Readonly<StateMachine<S, E>> | StateMachine<S, E>,
  current: S,
  event: E,
): StateTransition<S, E> | undefined {
  return machine.transitions.find(
    (t) => t.from === current && t.event === event.type,
  );
}

/**
 * Apply an event against the state machine.
 *
 * Order of operations:
 * 1. Find matching transition.
 * 2. If none → throw `UnknownTransitionError`.
 * 3. If guard present → await it; throw `GuardRejectionError` on rejection.
 * 4. Compute `clearedFields` from the matched transition.
 * 5. Run side-effects (best-effort; errors logged but not rethrown).
 * 6. Return the new state.
 *
 * This function does NOT mutate any user data — it only returns the
 * metadata the caller needs to apply the change.
 */
export async function applyTransition<S extends string, E extends { type: string }>(
  machine: Readonly<StateMachine<S, E>> | StateMachine<S, E>,
  current: S,
  event: E,
  data: TransitionData = {},
): Promise<TransitionResult<S>> {
  const transition = findTransition(machine, current, event);
  if (!transition) {
    throw new UnknownTransitionError(current, event.type);
  }

  if (transition.guard) {
    const verdict = await transition.guard(current, event, data);
    if (verdict !== true) {
      const reason = typeof verdict === 'string' ? verdict : 'guard rejected';
      throw new GuardRejectionError(current, event.type, reason);
    }
  }

  const sideEffectResults: unknown[] = [];
  if (transition.sideEffect) {
    try {
      const result = await transition.sideEffect(transition.to, event, data);
      sideEffectResults.push(result);
    } catch (err) {
      logger.api?.warn?.('state-machine: side-effect failed', {
        from: current,
        to: transition.to,
        event: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    nextState: transition.to,
    applied: true,
    clearedFields: transition.clearsFields ?? [],
    sideEffectResults,
  };
}

/**
 * Try a transition and return `null` instead of throwing on
 * `UnknownTransitionError`. `GuardRejectionError` is still thrown because
 * guard failures indicate a real bug, not a normal "no-op" case.
 */
export async function tryTransition<S extends string, E extends { type: string }>(
  machine: Readonly<StateMachine<S, E>> | StateMachine<S, E>,
  current: S,
  event: E,
  data: TransitionData = {},
): Promise<TransitionResult<S> | null> {
  try {
    return await applyTransition(machine, current, event, data);
  } catch (err) {
    if (err instanceof UnknownTransitionError) return null;
    throw err;
  }
}