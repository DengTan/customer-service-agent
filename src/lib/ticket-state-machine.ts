/**
 * Ticket lifecycle state machine.
 *
 * Sprint 4 (T-1, TS-1) replaces the ad-hoc `VALID_TRANSITIONS` map in
 * `ticket-service.ts` with a Sprint-1 `defineStateMachine` instance so the
 * `updateTicketStatus` flow is centralized, declarative, and easily testable.
 *
 * States and events are intentionally narrow:
 *
 *   open        → in_progress (assign | start)
 *   open        → resolved    (resolve, guard: assignee === operator OR operator is admin)
 *   in_progress → pending_customer (wait_customer)
 *   in_progress → resolved    (resolve)
 *   pending_customer → in_progress (resume)
 *   resolved    → closed      (close)
 *   resolved    → in_progress (reopen)
 *   closed      → in_progress (reopen, guard: operator role === admin)
 *
 * Notes:
 * - `pending_customer` is the wire string used by the existing UI/data layer;
 *   the event names are short verbs (`resolve`, `reopen`, …) and are *events*
 *   not states.
 * - `clearsFields` is exposed via the Sprint 1 TransitionResult so that the
 *   service can wipe `resolved_at` / `closed_at` when reopening if desired.
 *
 * @see ticket-service.ts `updateTicketStatus`
 * @see state-machine.ts
 */

import {
  defineStateMachine,
  type StateMachine,
  type StateTransition,
} from './state-machine';

export const TICKET_STATES = [
  'open',
  'in_progress',
  'pending_customer',
  'resolved',
  'closed',
] as const;
export type TicketState = (typeof TICKET_STATES)[number];

export const TICKET_EVENTS = [
  'assign',
  'start',
  'wait_customer',
  'resolve',
  'resume',
  'close',
  'reopen',
] as const;
export type TicketEventName = (typeof TICKET_EVENTS)[number];

export type TicketEvent = { type: TicketEventName };

export interface TicketTransitionPayload {
  /** User attempting the transition. Required for guards. */
  operatorId: string | null;
  /** Role claim of the user attempting the transition. */
  operatorRole: string | null;
  /** Current ticket assignee. Required for the `open → resolved` guard. */
  assigneeId: string | null;
}

/**
 * Build the canonical ticket state machine. Pure / idempotent: every call
 * yields an equivalent frozen machine, which lets test helpers reuse it.
 */
export function createTicketStateMachine(): Readonly<StateMachine<TicketState, TicketEvent>> {
  const transitions: StateTransition<TicketState, TicketEvent>[] = [
    // open → in_progress via either `assign` (preferred) or `start`.
    { from: 'open', to: 'in_progress', event: 'assign' },
    { from: 'open', to: 'in_progress', event: 'start' },

    // open → resolved is allowed but ONLY when the resolver is the current
    // assignee or an admin. The classic "creator closes own open ticket"
    // shortcut is on by default; admins always have the power to resolve.
    {
      from: 'open',
      to: 'resolved',
      event: 'resolve',
      guard: (_state, _event, data) => {
        const payload = data.payload as TicketTransitionPayload | undefined;
        if (!payload) return 'missing transition payload';
        const { operatorId, operatorRole, assigneeId } = payload;
        if (operatorRole === 'admin') return true;
        if (operatorId && assigneeId && operatorId === assigneeId) return true;
        return '仅指派人或管理员可以直接解决待处理工单';
      },
    },

    { from: 'in_progress', to: 'pending_customer', event: 'wait_customer' },
    { from: 'in_progress', to: 'resolved', event: 'resolve' },

    { from: 'pending_customer', to: 'in_progress', event: 'resume' },

    { from: 'resolved', to: 'closed', event: 'close' },
    { from: 'resolved', to: 'in_progress', event: 'reopen' },

    // Reopening a closed ticket is a privileged operation; only admins.
    {
      from: 'closed',
      to: 'in_progress',
      event: 'reopen',
      guard: (_state, _event, data) => {
        const payload = data.payload as TicketTransitionPayload | undefined;
        if (!payload) return 'missing transition payload';
        if (payload.operatorRole === 'admin') return true;
        return '仅管理员可以重新打开已关闭工单';
      },
    },
  ];

  return defineStateMachine<TicketState, TicketEvent>({ transitions });
}

/**
 * Module-level singleton. Construct once, share across requests.
 */
export const ticketStateMachine = createTicketStateMachine();
