/**
 * Agent session presence state machine.
 *
 * Single source of truth for the agent presence state machine: every
 * `(from, to)` pair — including self-loops — is modelled as an explicit
 * transition with a named event. Callers ask "what event takes me from
 * `from` to `to`?" via `findAgentEvent(from, to)` and route the answer
 * to `applyTransition` / `tryTransition` to confirm.
 *
 * Why centralise event selection here:
 *   1. The previous design derived the event from `target` alone, which
 *      silently returned `'login'` for any `target=online` and broke
 *      `away → online` (whose real event is `'back'`). Modelling the
 *      table as `from × to` makes that mismatch syntactically
 *      impossible.
 *   2. Self-loops are first-class transitions (`noop`), so the service
 *      layer no longer short-circuits them inline. Any code path that
 *      hits `agentStateMachine` — directly or via the service —
 *      observes the same semantics.
 *   3. The exhaustive edge table can be checked by a test (see
 *      `agent-state-machine.test.ts`); if anyone drops or duplicates
 *      an edge, CI catches it before it hits production.
 *
 * Allowed transitions (with the event that drives each):
 *
 *              | online              | away                | offline
 *   -----------+---------------------+---------------------+------------------
 *   online     | 'noop'              | 'away'              | 'logout'
 *   away       | 'back'              | 'noop'              | 'logout'
 *   offline    | 'login'             | 'away'              | 'noop'
 *
 * The `(offline → away)` edge intentionally uses the `'away'` event
 * rather than `'login'`. The state machine keys transitions by
 * `(from, event)`; a single event cannot disambiguate two different
 * target states from the same source. Using `'away'` keeps the table
 * deterministic without forcing the service layer to second-guess the
 * machine.
 */

import {
  defineStateMachine,
  type StateMachine,
} from './state-machine';

export const AGENT_STATES = ['online', 'away', 'offline'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export const AGENT_EVENTS = ['away', 'back', 'logout', 'login', 'noop'] as const;
export type AgentEventName = (typeof AGENT_EVENTS)[number];

export type AgentEvent = { type: AgentEventName };

/**
 * Edge definition for the agent presence state machine. The `event`
 * column carries the unique event name; `(from, to)` is the edge key.
 */
interface AgentEdge {
  readonly from: AgentState;
  readonly to: AgentState;
  readonly event: AgentEventName;
}

/**
 * Exhaustive edge table. Every `(from, to)` pair — including self-loops
 * (`noop`) — has exactly one entry. Adding or removing a transition
 * requires changing this table AND updating `findAgentEvent`'s tests
 * so the exhaustiveness invariant test still passes.
 */
const TRANSITION_TABLE: readonly AgentEdge[] = [
  // self-loops
  { from: 'online',  to: 'online',  event: 'noop' },
  { from: 'away',    to: 'away',    event: 'noop' },
  { from: 'offline', to: 'offline', event: 'noop' },
  // real edges
  { from: 'online',  to: 'away',    event: 'away' },
  { from: 'online',  to: 'offline', event: 'logout' },
  { from: 'away',    to: 'online',  event: 'back' },
  { from: 'away',    to: 'offline', event: 'logout' },
  { from: 'offline', to: 'online',  event: 'login' },
  { from: 'offline', to: 'away',    event: 'away' },
];

export function createAgentStateMachine(): Readonly<StateMachine<AgentState, AgentEvent>> {
  return defineStateMachine<AgentState, AgentEvent>({
    transitions: TRANSITION_TABLE.map(({ from, to, event }) => ({ from, to, event })),
  });
}

export const agentStateMachine = createAgentStateMachine();

/**
 * Look up the event that drives an `(from → to)` transition. Always
 * returns an event name (or `null` only if `(from, to)` is missing
 * from the table). Self-loops resolve to the explicit `'noop'` event,
 * so callers can route the answer through `tryTransition` and let the
 * machine own the semantics.
 */
export function findAgentEvent(from: AgentState, to: AgentState): AgentEventName | null {
  const edge = TRANSITION_TABLE.find((e) => e.from === from && e.to === to);
  return edge?.event ?? null;
}
