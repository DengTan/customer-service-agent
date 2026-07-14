import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { AlertRepository } from './alert-repository';

describe('AlertRepository.findRecentUnresolved', () => {
  it('selects the newest matching row before maybeSingle', async () => {
    const calls: string[] = [];
    const terminal = {
      maybeSingle: vi.fn(async () => ({ data: { id: 'newest' }, error: null })),
    };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => { calls.push('order'); return chain; }),
      limit: vi.fn(() => { calls.push('limit'); return terminal; }),
    };
    const client = { from: vi.fn(() => chain) };
    const repo = new AlertRepository(client as never);

    const result = await repo.findRecentUnresolved('conv', 'unhandled_remind', '2026-07-13T00:00:00Z');

    expect(result).toEqual({ id: 'newest' });
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(calls).toEqual(['order', 'limit']);
    expect(terminal.maybeSingle).toHaveBeenCalledOnce();
  });
});
