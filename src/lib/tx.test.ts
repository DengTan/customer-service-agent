import { describe, it, expect, vi } from 'vitest';
import { runBatch } from './tx';

describe('runBatch', () => {
  it('processes every item and reports zero errors in the happy path', async () => {
    const result = await runBatch(
      [1, 2, 3, 4],
      async (n) => n * 2,
      { onError: 'best-effort' },
    );
    expect(result.results.map((r) => r.result)).toEqual([2, 4, 6, 8]);
    expect(result.errors).toEqual([]);
    expect(result.deduped).toBe(0);
    expect(result.total).toBe(4);
    expect(result.processed).toBe(4);
  });

  it('dedupeBy groups items and processes only the first of each group', async () => {
    const calls: number[] = [];
    // [1, 2, 2, 3, 4, 4, 5]: odd keys are unique, ALL evens collapse into one
    // group ("even"), so 4 dedupes into 2's group. Groups: {1, 2, 3, 5}.
    const result = await runBatch(
      [1, 2, 2, 3, 4, 4, 5],
      async (n) => {
        calls.push(n);
        return n;
      },
      {
        onError: 'best-effort',
        dedupeBy: (n) => (n % 2 === 0 ? 'even' : `odd-${n}`),
      },
    );
    expect(calls.sort((a, b) => a - b)).toEqual([1, 2, 3, 5]);
    expect(result.deduped).toBe(3);
    expect(result.processed).toBe(4);
  });

  it('best-effort continues after errors and collects them', async () => {
    const result = await runBatch(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2) throw new Error('boom-2');
        if (n === 4) throw new Error('boom-4');
        return n * 10;
      },
      { onError: 'best-effort' },
    );
    expect(result.results.map((r) => r.result)).toEqual([10, 30]);
    expect(result.errors.map((e) => (e.error as Error).message)).toEqual([
      'boom-2',
      'boom-4',
    ]);
  });

  it('fail-fast throws on first error and stops processing', async () => {
    const calls: number[] = [];
    await expect(
      runBatch(
        [1, 2, 3, 4],
        async (n) => {
          calls.push(n);
          if (n === 2) throw new Error('boom');
          return n;
        },
        { onError: 'fail-fast' },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toEqual([1, 2]);
  });

  it('fail-fast with chunkSize > 1 stops at first error in a chunk', async () => {
    const calls: number[] = [];
    await expect(
      runBatch(
        [1, 2, 3, 4],
        async (n) => {
          calls.push(n);
          if (n === 3) throw new Error('boom');
          return n;
        },
        { onError: 'fail-fast', chunkSize: 2 },
      ),
    ).rejects.toThrow('boom');
    // Chunk 1: 1, 2 OK. Chunk 2: 3 throws before 4 runs.
    expect(calls).toEqual([1, 2, 3]);
  });

  it('chunkSize slices work; chunks are sequential', async () => {
    const order: number[] = [];
    const result = await runBatch(
      [1, 2, 3, 4, 5],
      async (n) => {
        // Always resolve in chunks-of-N to expose chunking behavior.
        await new Promise((r) => setTimeout(r, 5));
        order.push(n);
        return n;
      },
      { onError: 'best-effort', chunkSize: 2 },
    );
    expect(result.results).toHaveLength(5);
    // Order is not guaranteed within a chunk (parallel), but the START of
    // each chunk must precede the START of the next.
    expect(order[0]).toBe(1);
    expect(order[2]).toBe(3);
    expect(order[4]).toBe(5);
  });

  it('rollback hook fires in reverse order on best-effort errors', async () => {
    const rolledBack: number[] = [];
    await runBatch(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 3) throw new Error('boom');
        return n * 10;
      },
      {
        onError: 'best-effort',
        transactional: true,
        rollback: (item) => {
          rolledBack.push(item);
        },
      },
    );
    // Successes are [1, 2, 4]; reverse order is [4, 2, 1].
    expect(rolledBack).toEqual([4, 2, 1]);
  });

  it('rollback hook does NOT fire on full success', async () => {
    const rollback = vi.fn();
    await runBatch(
      [1, 2, 3],
      async (n) => n,
      {
        onError: 'best-effort',
        transactional: true,
        rollback,
      },
    );
    expect(rollback).not.toHaveBeenCalled();
  });

  it('rollback failures are logged, not rethrown', async () => {
    const result = await runBatch(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      },
      {
        onError: 'best-effort',
        transactional: true,
        rollback: () => {
          throw new Error('rollback-fail');
        },
      },
    );
    expect(result.errors).toHaveLength(1);
    // Original errors must still be reported even though rollback threw.
    expect((result.errors[0]?.error as Error).message).toBe('boom');
  });

  it('accepts synchronous processors', async () => {
    const result = await runBatch(
      [1, 2, 3],
      (n) => n + 100,
      { onError: 'best-effort' },
    );
    expect(result.results.map((r) => r.result)).toEqual([101, 102, 103]);
  });
});