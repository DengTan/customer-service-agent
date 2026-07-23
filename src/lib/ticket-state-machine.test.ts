/**
 * Sprint 4 (T-1) ? ticket state machine tests.
 *
 * Covers:
 * - 5 legal transitions (open?in_progress, in_progress?resolved, etc.)
 * - 3 illegal transitions (closed?open, open?closed, etc.) ? UnknownTransitionError
 * - 2 guard rejections (open?resolved by non-assignee non-admin, closed?in_progress by non-admin)
 */

import { describe, it, expect } from 'vitest';
import {
  createTicketStateMachine,
  ticketStateMachine,
} from './ticket-state-machine';
import {
  applyTransition,
  UnknownTransitionError,
  GuardRejectionError,
  type StateMachine,
} from './state-machine';
import type { TicketEvent, TicketState } from './ticket-state-machine';

const machine: Readonly<StateMachine<TicketState, TicketEvent>> =
  ticketStateMachine;

// `applyTransition` is generic on `E`, but `StateTransition.guard` is
// invariant in `E`. Tests cast through `unknown` so we don't fight the
// variance rules; runtime behavior is unchanged because the machine is the
// same singleton.
const apply = applyTransition as unknown as <S extends string>(
  m: unknown,
  current: S,
  event: { type: string },
  data?: { payload?: Record<string, unknown> },
) => Promise<{ nextState: S; applied: boolean; clearedFields: readonly string[]; sideEffectResults: unknown[] }>;

function payloadOf(partial: Partial<{ operatorId: string; operatorRole: string; assigneeId: string }> = {}) {
  return {
    payload: {
      operatorId: partial.operatorId ?? null,
      operatorRole: partial.operatorRole ?? null,
      assigneeId: partial.assigneeId ?? null,
    },
  };
}

describe('ticketStateMachine - factory', () => {
  it('produces an equivalent machine on repeat calls', () => {
    const a = createTicketStateMachine();
    const b = createTicketStateMachine();
    expect(a.transitions.length).toBe(b.transitions.length);
    expect(
      a.transitions.map((t) => `${t.from}->${t.to}:${t.event}`).sort(),
    ).toEqual(b.transitions.map((t) => `${t.from}->${t.to}:${t.event}`).sort());
  });
});

describe('ticketStateMachine - legal transitions', () => {
  it('open to in_progress via assign', async () => {
    const result = await apply(machine, 'open', { type: 'assign' }, payloadOf());
    expect(result.applied).toBe(true);
    expect(result.nextState).toBe('in_progress');
  });

  it('open to in_progress via start (alternate event)', async () => {
    const result = await apply(machine, 'open', { type: 'start' }, payloadOf());
    expect(result.nextState).toBe('in_progress');
  });

  it('in_progress to pending_customer via wait_customer', async () => {
    const result = await apply(machine, 'in_progress', { type: 'wait_customer' }, payloadOf());
    expect(result.nextState).toBe('pending_customer');
  });

  it('in_progress to resolved via resolve', async () => {
    const result = await apply(machine, 'in_progress', { type: 'resolve' }, payloadOf());
    expect(result.nextState).toBe('resolved');
  });

  it('resolved to in_progress via reopen (any operator)', async () => {
    const result = await apply(machine, 'resolved', { type: 'reopen' }, payloadOf());
    expect(result.nextState).toBe('in_progress');
  });

  it('pending_customer to in_progress via resume', async () => {
    const result = await apply(machine, 'pending_customer', { type: 'resume' }, payloadOf());
    expect(result.nextState).toBe('in_progress');
  });

  it('resolved to closed via close', async () => {
    const result = await apply(machine, 'resolved', { type: 'close' }, payloadOf());
    expect(result.nextState).toBe('closed');
  });
});

describe('ticketStateMachine - illegal transitions throw UnknownTransitionError', () => {
  it('closed to open has no transition', async () => {
    await expect(apply(machine, 'closed', { type: 'open' }, payloadOf())).rejects.toBeInstanceOf(UnknownTransitionError);
  });

  it('open to closed has no transition (must go via resolved first)', async () => {
    await expect(apply(machine, 'open', { type: 'close' }, payloadOf())).rejects.toBeInstanceOf(UnknownTransitionError);
  });

  it('in_progress to closed direct has no transition', async () => {
    await expect(apply(machine, 'in_progress', { type: 'close' }, payloadOf())).rejects.toBeInstanceOf(UnknownTransitionError);
  });
});

describe('ticketStateMachine - guard rejections', () => {
  it('open to resolved rejected for non-assignee non-admin', async () => {
    await expect(
      apply(
        machine,
        'open',
        { type: 'resolve' },
        payloadOf({ operatorId: 'u-other', operatorRole: 'agent', assigneeId: 'u-1' }),
      ),
    ).rejects.toBeInstanceOf(GuardRejectionError);
  });

  it('open to resolved allowed when operator is admin', async () => {
    const result = await apply(
      machine,
      'open',
      { type: 'resolve' },
      payloadOf({ operatorId: 'u-admin', operatorRole: 'admin', assigneeId: 'u-1' }),
    );
    expect(result.nextState).toBe('resolved');
  });

  it('open to resolved allowed when operator equals assignee', async () => {
    const result = await apply(
      machine,
      'open',
      { type: 'resolve' },
      payloadOf({ operatorId: 'u-1', operatorRole: 'agent', assigneeId: 'u-1' }),
    );
    expect(result.nextState).toBe('resolved');
  });

  it('closed to in_progress rejected for non-admin', async () => {
    await expect(
      apply(
        machine,
        'closed',
        { type: 'reopen' },
        payloadOf({ operatorId: 'u-1', operatorRole: 'agent' }),
      ),
    ).rejects.toBeInstanceOf(GuardRejectionError);
  });

  it('closed to in_progress allowed for admin', async () => {
    const result = await apply(
      machine,
      'closed',
      { type: 'reopen' },
      payloadOf({ operatorId: 'u-admin', operatorRole: 'admin' }),
    );
    expect(result.nextState).toBe('in_progress');
  });
});
