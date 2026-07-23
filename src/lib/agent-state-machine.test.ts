/**
 * Agent presence state machine tests.
 *
 * The table on `agent-state-machine.ts` is the single source of truth for
 * which `(from, to)` edges exist and which event drives each. These tests
 * verify:
 *   - every edge in the table resolves through `findAgentEvent` and
 *     `applyTransition` to the expected target;
 *   - the table is *exhaustive* over `AgentState × AgentState`: every
 *     pair appears exactly once. If a future change drops or duplicates
 *     an edge, this invariant catches it before it reaches production;
 *   - self-loops resolve to the explicit `'noop'` event, so callers can
 *     route through `tryTransition` rather than special-casing inline;
 *   - any `(from, event)` pair *not* in the table raises
 *     `UnknownTransitionError` from the machine.
 */

import { describe, it, expect } from 'vitest';
import {
  agentStateMachine,
  createAgentStateMachine,
  findAgentEvent,
  AGENT_STATES,
  AGENT_EVENTS,
  type AgentState,
  type AgentEvent,
} from './agent-state-machine';
import {
  applyTransition,
  UnknownTransitionError,
} from './state-machine';

const apply = applyTransition as unknown as (
  m: typeof agentStateMachine,
  current: AgentState,
  event: AgentEvent,
) => Promise<{ nextState: AgentState; applied: boolean }>;

describe('agentStateMachine - factory', () => {
  it('produces an equivalent machine on repeat calls', () => {
    const a = createAgentStateMachine();
    expect(a.transitions.length).toBeGreaterThan(0);
    expect(a.transitions.map((t) => `${t.from}->${t.to}:${t.event}`).sort()).toEqual(
      createAgentStateMachine().transitions.map((t) => `${t.from}->${t.to}:${t.event}`).sort(),
    );
  });
});

describe('TRANSITION_TABLE exhaustiveness invariant', () => {
  it('contains every (from, to) pair exactly once (no gaps, no duplicates)', () => {
    const pairs = new Set<string>();
    let noopCount = 0;
    for (const t of agentStateMachine.transitions) {
      const key = `${t.from}->${t.to}`;
      expect(pairs.has(key), `duplicate transition ${key}`).toBe(false);
      pairs.add(key);
      if (t.event === 'noop') noopCount += 1;
    }
    // full Cartesian product: |states|² entries including self-loops.
    expect(pairs.size).toBe(AGENT_STATES.length * AGENT_STATES.length);
    expect(noopCount).toBe(AGENT_STATES.length);
  });

  it('only declares events from AGENT_EVENTS', () => {
    for (const t of agentStateMachine.transitions) {
      expect(AGENT_EVENTS as readonly string[]).toContain(t.event);
    }
  });
});

describe('agentStateMachine - legal transitions through findAgentEvent', () => {
  const legalEdges: Array<{ from: AgentState; to: AgentState; event: AgentEvent['type'] }> = [
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

  for (const edge of legalEdges) {
    it(`(${edge.from} → ${edge.to}) resolves to event '${edge.event}'`, async () => {
      expect(findAgentEvent(edge.from, edge.to)).toBe(edge.event);
      const r = await apply(agentStateMachine, edge.from, { type: edge.event });
      expect(r.nextState).toBe(edge.to);
    });
  }
});

describe('agentStateMachine - illegal (from, event) pairs raise UnknownTransitionError', () => {
  // These cases guard against silent drift — if the table ever loses an
  // edge or renames an event, the corresponding machine-level lookup
  // must raise. Keeping the same wording the machine uses keeps logs
  // comparable.
  const illegalCases: Array<{ from: AgentState; event: AgentEvent['type']; label: string }> = [
    { from: 'away',    event: 'login',  label: '(away, login) → not an edge (use "back")' },
    { from: 'offline', event: 'logout', label: '(offline, logout) → not an edge (self-loop is noop)' },
    { from: 'online',  event: 'back',   label: '(online, back) → not an edge (back is away → online only)' },
  ];

  for (const c of illegalCases) {
    it(c.label, async () => {
      await expect(apply(agentStateMachine, c.from, { type: c.event })).rejects.toBeInstanceOf(UnknownTransitionError);
    });
  }

  it('(online, logout) still moves to offline (logout is a real edge from online)', async () => {
    // Belt-and-braces: making sure that the only `(online, *)` edge we
    // DO have behaves correctly even though we just asserted `back`
    // doesn't.
    await expect(apply(agentStateMachine, 'online', { type: 'logout' })).resolves.toEqual(
      expect.objectContaining({ nextState: 'offline' }),
    );
  });
});
