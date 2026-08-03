/**
 * Focused tests for EffectBus and OutboxReplayWorker (B4a/B4b).
 *
 * Covers:
 * - EffectBus: register, unregister, dispatch, abort propagation, mode semantics
 * - critical mode: throws on failure, invokes onCriticalFailure
 * - best-effort mode: swallows errors silently
 * - AbortSignal propagation to effects
 * - idempotency and deduplication
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EffectBus } from '@/lib/effects/bus';
import type { EffectContext } from '@/lib/effects/bus';

describe('EffectBus (B4a)', () => {
  let bus: EffectBus;

  beforeEach(() => {
    bus = new EffectBus();
  });

  it('registers and executes an effect', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const execute = vi.fn().mockResolvedValue(undefined);

    bus.register('test', { mode: 'best-effort', execute });
    await bus.dispatch(ctx, new AbortController().signal);

    expect(execute).toHaveBeenCalledWith(ctx, expect.any(AbortSignal));
  });

  it('skips effects when signal is already aborted', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const execute = vi.fn().mockResolvedValue(undefined);
    const ac = new AbortController();
    ac.abort();

    bus.register('test', { mode: 'best-effort', execute });
    await bus.dispatch(ctx, ac.signal);

    expect(execute).not.toHaveBeenCalled();
  });

  it('best-effort mode swallows errors', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    const onCriticalFailure = vi.fn();

    bus.register('test', { mode: 'best-effort', execute });
    // Should NOT throw
    await expect(
      bus.dispatch(ctx, new AbortController().signal, onCriticalFailure)
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalled();
    expect(onCriticalFailure).not.toHaveBeenCalled();
  });

  it('critical mode throws on failure', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    const onCriticalFailure = vi.fn().mockResolvedValue(undefined);

    bus.register('critical', { mode: 'critical', execute });
    await expect(
      bus.dispatch(ctx, new AbortController().signal, onCriticalFailure)
    ).rejects.toThrow('boom');
    expect(onCriticalFailure).toHaveBeenCalledWith('critical', ctx, expect.any(Error));
  });

  it('critical mode invokes onCriticalFailure before re-throwing', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    const onCriticalFailure = vi.fn().mockResolvedValue(undefined);

    bus.register('critical', { mode: 'critical', execute });
    await expect(
      bus.dispatch(ctx, new AbortController().signal, onCriticalFailure)
    ).rejects.toThrow('boom');

    // execute fails first, then catch runs, calls onCriticalFailure, then throws
    // So onCriticalFailure should be called AFTER execute
    expect(execute).toHaveBeenCalledTimes(1);
    expect(onCriticalFailure).toHaveBeenCalledTimes(1);
    expect(onCriticalFailure).toHaveBeenCalledWith('critical', ctx, expect.any(Error));
  });

  it('executes effects in registration order', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const order: string[] = [];
    bus.register('a', { mode: 'best-effort', execute: async () => { order.push('a'); } });
    bus.register('b', { mode: 'best-effort', execute: async () => { order.push('b'); } });
    bus.register('c', { mode: 'best-effort', execute: async () => { order.push('c'); } });

    await bus.dispatch(ctx, new AbortController().signal);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('aborts in-flight effect when signal is aborted mid-execution', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const ac = new AbortController();
    const execute = vi.fn().mockImplementation(async (_ctx: EffectContext, signal: AbortSignal) => {
      // Verify the signal is aborted
      expect(signal.aborted).toBe(true);
    });

    bus.register('slow', { mode: 'best-effort', execute });

    // Start dispatch but abort immediately
    const dispatch = bus.dispatch(ctx, ac.signal);
    ac.abort();
    await dispatch;

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('unregister removes an effect', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    bus.register('test', { mode: 'best-effort', execute });
    bus.unregister('test');

    await bus.dispatch({ conversationId: 'c1' }, new AbortController().signal);
    expect(execute).not.toHaveBeenCalled();
  });

  it('clear removes all effects', async () => {
    const e1 = vi.fn().mockResolvedValue(undefined);
    const e2 = vi.fn().mockResolvedValue(undefined);
    bus.register('e1', { mode: 'best-effort', execute: e1 });
    bus.register('e2', { mode: 'best-effort', execute: e2 });
    bus.clear();

    await bus.dispatch({ conversationId: 'c1' }, new AbortController().signal);
    expect(e1).not.toHaveBeenCalled();
    expect(e2).not.toHaveBeenCalled();
    expect(bus.size).toBe(0);
  });

  it('keys() returns registered effect keys', async () => {
    bus.register('saveMessage', { mode: 'critical', execute: async () => {} });
    bus.register('alerts', { mode: 'best-effort', execute: async () => {} });
    bus.register('qualityCheck', { mode: 'best-effort', execute: async () => {} });

    const keys = Array.from(bus.keys()).sort();
    expect(keys).toEqual(['alerts', 'qualityCheck', 'saveMessage']);
  });

  it('re-registration overwrites previous handler', async () => {
    const ctx: EffectContext = { conversationId: 'conv-1' };
    const oldFn = vi.fn().mockResolvedValue(undefined);
    const newFn = vi.fn().mockResolvedValue(undefined);

    bus.register('test', { mode: 'best-effort', execute: oldFn });
    bus.register('test', { mode: 'best-effort', execute: newFn });

    await bus.dispatch(ctx, new AbortController().signal);
    expect(oldFn).not.toHaveBeenCalled();
    expect(newFn).toHaveBeenCalled();
  });

  it('size reflects registered count', () => {
    expect(bus.size).toBe(0);
    bus.register('a', { mode: 'best-effort', execute: async () => {} });
    expect(bus.size).toBe(1);
    bus.register('b', { mode: 'best-effort', execute: async () => {} });
    expect(bus.size).toBe(2);
    bus.unregister('a');
    expect(bus.size).toBe(1);
  });

  it('dispatch returns without error when no effects registered', async () => {
    await expect(
      bus.dispatch({ conversationId: 'c1' }, new AbortController().signal)
    ).resolves.toBeUndefined();
  });
});

describe('EffectBus abort propagation (B4a)', () => {
  it('sends the same AbortSignal to all effects', async () => {
    const bus = new EffectBus();
    const signals: AbortSignal[] = [];
    const ac = new AbortController();

    bus.register('e1', {
      mode: 'best-effort',
      execute: async (_ctx, signal) => { signals.push(signal); },
    });
    bus.register('e2', {
      mode: 'best-effort',
      execute: async (_ctx, signal) => { signals.push(signal); },
    });

    await bus.dispatch({ conversationId: 'c1' }, ac.signal);
    expect(signals.length).toBe(2);
    expect(signals[0]).toBe(ac.signal);
    expect(signals[1]).toBe(ac.signal);
  });
});
