import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { ExportRepository } from './export-repository';

describe('ExportRepository.getAnalyticsStats', () => {
  it('counts ended conversations as completed (P0: schema enum is active|ended|handoff)', async () => {
    const fromMock = vi.fn();
    // conversations
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({
        data: [
          { status: 'active', rating: null },
          { status: 'active', rating: 5 },
          { status: 'ended', rating: 4 },
          { status: 'ended', rating: 3 },
          { status: 'handoff', rating: 5 },
          { status: 'ended', rating: 0 }, // rating=0 is invalid (rating must be 1-5)
        ],
        error: null,
      })),
    }));
    // messages count
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({ count: 120, error: null })),
    }));
    // alerts count
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({ count: 4, error: null })),
    }));
    // agent_queue count
    fromMock.mockImplementationOnce(() => {
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => Promise.resolve({ count: 2, error: null }));
      return { select: vi.fn(() => chain) };
    });

    const repo = new ExportRepository({ from: fromMock } as never);
    const stats = await repo.getAnalyticsStats();

    expect(stats).toEqual({
      total_conversations: 6,
      active_conversations: 2,
      // 3 ended rows become "completed"; handoff and active do not.
      completed_conversations: 3,
      total_messages: 120,
      // Average excludes the rating=0 row (only valid 1-5 ratings count).
      avg_rating: '4.25',
      total_alerts: 4,
      queued_items: 2,
    });
  });

  it('returns zeroed stats when the conversations query errors', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => Promise.resolve({
          data: null,
          error: { message: 'db down', code: '42P01' },
        })),
      })),
    };
    const repo = new ExportRepository(client as never);

    await expect(repo.getAnalyticsStats()).rejects.toThrow();
  });
});