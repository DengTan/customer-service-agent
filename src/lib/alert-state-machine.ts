/**
 * Alert lifecycle state machine (Sprint 5 / AL-2).
 *
 * Replaces the unchecked UPDATE in `AlertService.resolveAlert` /
 * `dismissAlert` (which only flipped the `is_resolved` boolean) with a
 * Sprint-1 `defineStateMachine` instance so every transition is declarative,
 * auditable, and unit-testable.
 *
 * Design notes — see Sprint 5 decision log:
 *
 * 1. States mirror the canonical lifecycle: `open` → `resolved` or
 *    `dismissed`. There is intentionally NO `closed` state — `is_resolved=true`
 *    is the database's terminal flag and we keep both resolve and dismiss
 *    mapping to it because the UI distinguishes the two via a separate
 *    `metadata.dismissed_by` field. The state alphabet stays minimal so
 *    existing read paths remain unchanged.
 *
 * 2. Allowed transitions:
 *      open      → resolved   (event='resolve')
 *      open      → dismissed  (event='dismiss')
 *      resolved  → open       (event='reopen', guard: operator role === admin)
 *
 * 3. Explicitly disallowed (rejected with UnknownTransitionError):
 *      resolved  → dismissed   (already-resolved alerts cannot be dismissed;
 *                               the operator must reopen first or operate on
 *                               a fresh alert)
 *      dismissed → resolved    (symmetric to the above)
 *      dismissed → open        (dismissal is a final ack-of-noise verdict;
 *                               reopening a dismissed alert would re-create
 *                               the same notification noise the operator just
 *                               silenced)
 *      self-loops               (no-op transitions raise UnknownTransition)
 *
 * 4. The reopen guard mirrors ticket-state-machine.ts: only admins can
 *    reopen a resolved alert because resolved means "the operator who was
 *    paged confirmed this is actionable", and we don't want agents to
 *    silently un-resolve alerts they weren't allowed to resolve in the first
 *    place.
 *
 * The accompanying `transitionAlertState()` helper centralizes the
 * (state, event, payload) → next-state computation; repository code is
 * responsible for applying the new state to the row, clearing `resolved_at`
 * when needed, and writing any audit metadata.
 *
 * @see state-machine.ts (Sprint 1)
 * @see alert-service.ts
 */
import {
  applyTransition,
  defineStateMachine,
  type StateMachine,
  type StateTransition,
} from './state-machine';

export const ALERT_STATES = ['open', 'resolved', 'dismissed'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_EVENTS = ['resolve', 'dismiss', 'reopen'] as const;
export type AlertEventName = (typeof ALERT_EVENTS)[number];

export type AlertEvent = { type: AlertEventName };

export interface AlertTransitionPayload {
  /** User attempting the transition. */
  operatorId: string | null;
  /** Role claim of the user attempting the transition. */
  operatorRole: string | null;
}

/**
 * Build the canonical alert state machine. Pure / idempotent so test helpers
 * can re-instantiate it without sharing mutable state.
 */
export function createAlertStateMachine(): Readonly<StateMachine<AlertState, AlertEvent>> {
  const transitions: StateTransition<AlertState, AlertEvent>[] = [
    { from: 'open', to: 'resolved', event: 'resolve' },
    { from: 'open', to: 'dismissed', event: 'dismiss' },

    // Reopening a resolved alert is privileged. Mirrors the ticket closed →
    // in_progress rule: only an admin may move a resolved alert back to
    // open. Agents who want to act on it should create a new alert path.
    {
      from: 'resolved',
      to: 'open',
      event: 'reopen',
      guard: (_state, _event: AlertEvent, data) => {
        const payload = data.payload as AlertTransitionPayload | undefined;
        if (!payload) return 'missing transition payload';
        if (payload.operatorRole === 'admin') return true;
        return '仅管理员可以重新打开已解决的告警';
      },
      clearsFields: ['resolved_at'],
    },
  ];

  return defineStateMachine<AlertState, AlertEvent>({ transitions });
}

/**
 * Module-level singleton. Construct once, share across requests.
 */
export const alertStateMachine = createAlertStateMachine();

/**
 * Convenience wrapper for callers that prefer a typed, narrow surface over
 * the generic `applyTransition`. Re-exported here so the alert service can
 * stay domain-flavored.
 */
export async function transitionAlertState(
  current: AlertState,
  event: AlertEvent,
  payload: AlertTransitionPayload,
): Promise<{ nextState: AlertState; clearedFields: readonly string[] }> {
  const result = await applyTransition(alertStateMachine, current, event, {
    payload: payload as unknown as Record<string, unknown>,
  });
  return {
    nextState: result.nextState,
    clearedFields: result.clearedFields,
  };
}