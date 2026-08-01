import { describe, expect, it, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { AnalyticsRepository } from './analytics-repository';

describe('AnalyticsRepository.getTicketStats', () => {
  it('aggregates status/category/priority from select() data rows (P0 fix)', async () => {
    // Mock the four parallel ticket queries
    const totalChain = {
      select: vi.fn().mockReturnThis(),
    };
    // Build a mock client where every .from().select() returns a different
    // data array. We use a single shared chainable that resolves to the
    // status rows for tickets; the count query uses head:true which the
    // existing client builder doesn't expose, so we directly stub the call.
    const fromMock = vi.fn();
    // tickets count
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({ count: 7, error: null })),
    }));
    // tickets status
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({
        data: [
          { status: 'open' },
          { status: 'open' },
          { status: 'in_progress' },
          { status: 'resolved' },
          { status: 'closed' },
        ],
        error: null,
      })),
    }));
    // tickets category
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({
        data: [
          { category: 'refund' },
          { category: 'refund' },
          { category: 'shipping' },
        ],
        error: null,
      })),
    }));
    // tickets priority
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => Promise.resolve({
        data: [
          { priority: 'high' },
          { priority: 'low' },
          { priority: 'low' },
        ],
        error: null,
      })),
    }));
    // tickets overdue (no SLA -> falls back to default 24h with .or().lt())
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.or = vi.fn(() => chain);
        chain.lt = vi.fn(() => Promise.resolve({ count: 2, error: null }));
        return chain;
      }),
    }));
    // tickets resolved (for avg_resolution_hours)
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.in = vi.fn(() => chain);
        chain.order = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve({
          data: [
            { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T03:00:00Z' },
          ],
          error: null,
        }));
        return chain;
      }),
    }));
    // ticket_status_log
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.eq = vi.fn(() => chain);
        chain.gte = vi.fn(() => chain);
        chain.order = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve({
          data: [{ ticket_id: 't1', created_at: '2026-01-01T01:00:00Z' }],
          error: null,
        }));
        return chain;
      }),
    }));
    // tickets for first-response lookup
    fromMock.mockImplementationOnce(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.in = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve({
          data: [{ id: 't1', created_at: '2026-01-01T00:00:00Z' }],
          error: null,
        }));
        return chain;
      }),
    }));

    const client = { from: fromMock };
    const repo = new AnalyticsRepository(client as never);

    const result = await repo.getTicketStats({});

    expect(result.total).toBe(7);
    expect(result.by_status).toEqual({
      open: 2,
      in_progress: 1,
      resolved: 1,
      closed: 1,
    });
    expect(result.by_category).toEqual({
      refund: 2,
      shipping: 1,
    });
    expect(result.by_priority).toEqual({
      high: 1,
      low: 2,
    });
    expect(result.avg_resolution_hours).toBe(3);
    expect(result.avg_first_response_hours).toBe(1);
    expect(result.overdue_count).toBe(2);
  });

  it('returns zeroed stats when the underlying client throws', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('connection refused');
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    const result = await repo.getTicketStats({ low: 2880 });

    expect(result).toEqual({
      total: 0,
      by_status: {},
      by_category: {},
      by_priority: {},
      avg_resolution_hours: null,
      avg_first_response_hours: null,
      overdue_count: 0,
    });
  });
});

describe('AnalyticsRepository.getAutoReplyHits', () => {
  it('counts only messages whose sources include an auto_reply entry within the window', async () => {
    const gte = vi.fn(() => Promise.resolve({
      data: [
        { sources: [{ type: 'auto_reply', keyword: 'hi' }] },
        { sources: [{ type: 'knowledge' }] },
        { sources: [{ type: 'auto_reply' }, { type: 'knowledge' }] },
        { sources: null },
      ],
      error: null,
    }));
    const client = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.not = vi.fn(() => chain);
        chain.gte = gte;
        return chain;
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    expect(await repo.getAutoReplyHits('2026-07-25T00:00:00.000Z')).toBe(2);
    expect(gte).toHaveBeenCalledWith('created_at', '2026-07-25T00:00:00.000Z');
  });

  it('returns 0 when the messages query errors', async () => {
    const client = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.not = vi.fn(() => chain);
        chain.gte = vi.fn(() => Promise.resolve({
          data: null,
          error: { message: 'boom', code: '42P01' },
        }));
        return chain;
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    expect(await repo.getAutoReplyHits('2026-07-25T00:00:00.000Z')).toBe(0);
  });

  it('returns 0 when the underlying client throws', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('connection refused');
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    expect(await repo.getAutoReplyHits('2026-07-25T00:00:00.000Z')).toBe(0);
  });
});

describe('AnalyticsRepository.getUserMessageCount', () => {
  it('returns the count of role=user messages in the window', async () => {
    const gte = vi.fn(() => Promise.resolve({ count: 42, error: null }));
    const client = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.gte = gte;
        return chain;
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    expect(await repo.getUserMessageCount('2026-07-25T00:00:00.000Z')).toBe(42);
    expect(gte).toHaveBeenCalledWith('created_at', '2026-07-25T00:00:00.000Z');
  });

  it('returns 0 when the count query errors', async () => {
    const client = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.gte = vi.fn(() => Promise.resolve({
          count: null,
          error: { message: 'boom', code: '42P01' },
        }));
        return chain;
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    expect(await repo.getUserMessageCount('2026-07-25T00:00:00.000Z')).toBe(0);
  });

  it('returns 0 when the underlying client throws', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('connection refused');
      }),
    };
    const repo = new AnalyticsRepository(client as never);

    expect(await repo.getUserMessageCount('2026-07-25T00:00:00.000Z')).toBe(0);
  });
});