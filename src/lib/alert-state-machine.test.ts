import { describe, expect, it } from 'vitest';
import {
  ALERT_EVENTS,
  ALERT_STATES,
  alertStateMachine,
  createAlertStateMachine,
  transitionAlertState,
  type AlertEvent,
  type AlertEventName,
  type AlertState,
} from './alert-state-machine';
import {
  GuardRejectionError,
  UnknownTransitionError,
  applyTransition,
  tryTransition,
} from './state-machine';

const machine = createAlertStateMachine();

const adminPayload = { operatorId: 'u-1', operatorRole: 'admin' };
const agentPayload = { operatorId: 'u-2', operatorRole: 'agent' };
const noPayload = { operatorId: null, operatorRole: null };

describe('alert state machine — happy paths', () => {
  it('open → resolved (event=resolve) is allowed without guards', async () => {
    const result = await applyTransition(machine, 'open', { type: 'resolve' as const });
    expect(result.nextState).toBe('resolved');
    expect(result.clearedFields).toEqual([]);
  });

  it('open → dismissed (event=dismiss) is allowed without guards', async () => {
    const result = await applyTransition(machine, 'open', { type: 'dismiss' as const });
    expect(result.nextState).toBe('dismissed');
    expect(result.clearedFields).toEqual([]);
  });

  it('resolved → open (event=reopen) is allowed for admins and clears resolved_at', async () => {
    const result = await applyTransition(
      machine,
      'resolved',
      { type: 'reopen' as const },
      { payload: adminPayload as unknown as Record<string, unknown> },
    );
    expect(result.nextState).toBe('open');
    expect(result.clearedFields).toContain('resolved_at');
  });
});

describe('alert state machine — illegal transitions', () => {
  it('resolved → dismissed raises UnknownTransitionError', async () => {
    await expect(
      applyTransition(machine, 'resolved', { type: 'dismiss' as const }),
    ).rejects.toBeInstanceOf(UnknownTransitionError);
  });

  it('dismissed → resolved raises UnknownTransitionError', async () => {
    await expect(
      applyTransition(machine, 'dismissed', { type: 'resolve' as const }),
    ).rejects.toBeInstanceOf(UnknownTransitionError);
  });

  it('dismissed → open raises UnknownTransitionError (no reopen from dismissed)', async () => {
    await expect(
      applyTransition(machine, 'dismissed', { type: 'reopen' as const }),
    ).rejects.toBeInstanceOf(UnknownTransitionError);
  });

  it('tryTransition returns null for unknown transitions instead of throwing', async () => {
    const result = await tryTransition(machine, 'dismissed', { type: 'reopen' as const });
    expect(result).toBeNull();
  });
});

describe('alert state machine — guards', () => {
  it('resolved → open rejects non-admin operators', async () => {
    let caught: unknown;
    try {
      await applyTransition(
        machine,
        'resolved',
        { type: 'reopen' as const },
        { payload: agentPayload as unknown as Record<string, unknown> },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GuardRejectionError);
    expect((caught as GuardRejectionError).reason).toMatch(/仅管理员/);
  });

  it('resolved → open rejects operators without a role payload', async () => {
    await expect(
      applyTransition(
        machine,
        'resolved',
        { type: 'reopen' as const },
        { payload: noPayload as unknown as Record<string, unknown> },
      ),
    ).rejects.toBeInstanceOf(GuardRejectionError);
  });

  it('transitionAlertState is a thin typed wrapper around applyTransition', async () => {
    const r = await transitionAlertState('open', { type: 'resolve' as const }, adminPayload);
    expect(r.nextState).toBe('resolved');
  });
});

describe('alert state machine — shape', () => {
  it('exports the canonical state and event alphabets', () => {
    expect([...ALERT_STATES]).toEqual(['open', 'resolved', 'dismissed']);
    expect([...ALERT_EVENTS]).toEqual(['resolve', 'dismiss', 'reopen']);
  });

  it('singleton matches the factory output (no drift across modules)', () => {
    expect(alertStateMachine.transitions.length).toBe(machine.transitions.length);
    // sanity: every transition has both endpoints declared
    const states = new Set<AlertState>();
    for (const t of machine.transitions) {
      states.add(t.from);
      states.add(t.to);
    }
    for (const s of ALERT_STATES) {
      expect(states.has(s)).toBe(true);
    }
  });

  it('exhaustive coverage of (state × event) rejects the disallowed pairs', async () => {
    const allowed = new Set<string>([
      'open|resolve',
      'open|dismiss',
      'resolved|reopen',
    ]);
    const states: AlertState[] = ['open', 'resolved', 'dismissed'];
    const events: AlertEventName[] = ['resolve', 'dismiss', 'reopen'];
    for (const from of states) {
      for (const ev of events) {
        const key = `${from}|${ev}`;
        const event: AlertEvent = { type: ev };
        if (allowed.has(key)) continue;
        // For allowed-but-guarded pair, supply admin to avoid GuardRejection.
        const payload =
          key === 'resolved|reopen'
            ? { payload: adminPayload as unknown as Record<string, unknown> }
            : {};
        // For resolved|reopen without admin payload, we expect GuardRejection
        // not UnknownTransitionError. That still satisfies "not allowed
        // without admin".
        await expect(applyTransition(machine, from, event, payload)).rejects.toThrow();
      }
    }
  });
});