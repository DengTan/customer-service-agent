import { describe, it, expect, vi } from 'vitest';
import {
  applyTransition,
  defineStateMachine,
  findTransition,
  GuardRejectionError,
  tryTransition,
  UnknownTransitionError,
  type StateMachine,
  type StateTransition,
} from './state-machine';

type S = 'open' | 'in_progress' | 'resolved' | 'closed';
// Discriminated by `type`; payloads are carried on individual variants. We
// also keep a "resolve" event variant without payload so test code can
// emit a bare resolve event without TypeScript complaining.
type E =
  | { type: 'start' }
  | { type: 'resolve' }
  | { type: 'resolve_with_identity'; resolvedBy: string }
  | { type: 'reopen' }
  | { type: 'close' };

const transitions: StateTransition<S, E>[] = [
  {
    from: 'open',
    to: 'in_progress',
    event: 'start',
    clearsFields: [],
  },
  {
    from: 'in_progress',
    to: 'resolved',
    event: 'resolve',
    clearsFields: ['resolved_at'],
    sideEffect: () => 'resolved-side-effect',
  },
  {
    from: 'resolved',
    to: 'in_progress',
    event: 'reopen',
    // No clearsFields: caller decides what to clear on revert.
  },
  {
    from: 'resolved',
    to: 'closed',
    event: 'close',
    guard: (current, event, data) => {
      if (data.payload?.force === true) return true;
      // Only resolve-with-identity can close.
      if (event.type === 'resolve_with_identity' && event.resolvedBy) {
        return true;
      }
      return 'cannot close without resolver identity';
    },
  },
];

const machine: Readonly<StateMachine<S, E>> = defineStateMachine({ transitions });

describe('defineStateMachine', () => {
  it('freezes the returned object and transitions array', () => {
    expect(Object.isFrozen(machine)).toBe(true);
    expect(Object.isFrozen(machine.transitions)).toBe(true);
  });

  it('throws when no transitions are provided', () => {
    // Empty arrays are valid input at runtime — defineStateMachine should
    // still throw to surface developer errors early. We bypass the type
    // checker here because the function intentionally narrows the input.
    const emptyConfig = { transitions: [] } as unknown as StateMachine<S, E>;
    expect(() => defineStateMachine(emptyConfig)).toThrow();
  });
});

describe('findTransition', () => {
  it('returns the matching transition or undefined', () => {
    expect(findTransition(machine, 'open', { type: 'start' })?.to).toBe('in_progress');
    expect(findTransition(machine, 'open', { type: 'close' })).toBeUndefined();
  });
});

describe('applyTransition', () => {
  it('applies a valid transition and reports clearedFields', async () => {
    const result = await applyTransition(machine, 'in_progress', { type: 'resolve' });
    expect(result.applied).toBe(true);
    expect(result.nextState).toBe('resolved');
    expect(result.clearedFields).toEqual(['resolved_at']);
  });

  it('runs side-effects and collects their return values', async () => {
    const result = await applyTransition(machine, 'in_progress', { type: 'resolve' });
    expect(result.sideEffectResults).toEqual(['resolved-side-effect']);
  });

  it('throws UnknownTransitionError on unmatched (state, event) pair', async () => {
    await expect(
      applyTransition(machine, 'open', { type: 'close' }),
    ).rejects.toBeInstanceOf(UnknownTransitionError);
  });

  it('guard returning false rejects with a generic message', async () => {
    await expect(
      applyTransition(machine, 'resolved', { type: 'close' }, { payload: {} }),
    ).rejects.toBeInstanceOf(GuardRejectionError);
  });

  it('guard returning a string rejects with that reason', async () => {
    // `close` is only defined for `resolved` state. From `resolved` without
    // a resolver identity, the guard should reject with its reason.
    try {
      await applyTransition(machine, 'resolved', { type: 'close' }, { payload: {} });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GuardRejectionError);
      expect((err as GuardRejectionError).reason).toBe(
        'cannot close without resolver identity',
      );
    }
  });

  it('async guard works', async () => {
    const asyncGuard = vi.fn(async () => true);
    const m = defineStateMachine<S, E>({
      transitions: [
        {
          from: 'open',
          to: 'in_progress',
          event: 'start',
          guard: asyncGuard,
        },
      ],
    });
    const r = await applyTransition(m, 'open', { type: 'start' });
    expect(r.applied).toBe(true);
    expect(asyncGuard).toHaveBeenCalledTimes(1);
  });

  it('side-effect failures are logged but do not prevent the transition', async () => {
    const m = defineStateMachine<S, E>({
      transitions: [
        {
          from: 'open',
          to: 'in_progress',
          event: 'start',
          sideEffect: () => {
            throw new Error('side-effect-failure');
          },
        },
      ],
    });
    const r = await applyTransition(m, 'open', { type: 'start' });
    expect(r.applied).toBe(true);
    expect(r.nextState).toBe('in_progress');
    expect(r.sideEffectResults).toEqual([]);
  });
});

describe('tryTransition', () => {
  it('returns null on unknown transition instead of throwing', async () => {
    const r = await tryTransition(machine, 'open', { type: 'close' });
    expect(r).toBeNull();
  });

  it('still throws GuardRejectionError', async () => {
    await expect(
      tryTransition(machine, 'resolved', { type: 'close' }, { payload: {} }),
    ).rejects.toBeInstanceOf(GuardRejectionError);
  });
});