import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { ConversationRepository } from './conversation-repository';

describe('ConversationRepository.countUserMessages', () => {
  it('queries messages table with conversation_id and role=user exact count', async () => {
    const calls: string[] = [];
    const selectOptions: unknown[] = [];
    const chain = {
      select: vi.fn((sel: unknown, options?: unknown) => {
        selectOptions.push(options);
        calls.push(`select:${typeof sel === 'string' ? sel : '<obj>'}`);
        return chain;
      }),
      eq: vi.fn((field: string, value: unknown) => {
        calls.push(`eq:${field}=${String(value)}`);
        return chain;
      }),
    };
    // Make the chain itself thenable so `await client.from(...)...` resolves.
    const thenable: Promise<{ count: number; error: null }> = Promise.resolve({ count: 7, error: null });
    const awaitable = Object.assign(chain, {
      then: thenable.then.bind(thenable),
    });
    const client = {
      from: vi.fn((table: string) => {
        calls.push(`from:${table}`);
        return awaitable;
      }),
    };

    const repo = new ConversationRepository(client as never);
    const count = await repo.countUserMessages('conv-abc');

    expect(count).toBe(7);
    expect(client.from).toHaveBeenCalledWith('messages');
    expect(calls).toContain('from:messages');
    expect(calls).toContain('eq:conversation_id=conv-abc');
    expect(calls).toContain('eq:role=user');
    // select must request an exact, head-only count via the second argument.
    expect(selectOptions).toHaveLength(1);
    expect(selectOptions[0]).toEqual({ count: 'exact', head: true });
  });

  it('returns 0 when supabase reports an error', async () => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
    };
    const errored = Promise.resolve({ count: null, error: { message: 'db down', code: 'XX000' } });
    const awaitable = Object.assign(chain, { then: errored.then.bind(errored) });
    const client = { from: vi.fn(() => awaitable) };

    const repo = new ConversationRepository(client as never);
    const count = await repo.countUserMessages('conv-err');

    expect(count).toBe(0);
  });
});