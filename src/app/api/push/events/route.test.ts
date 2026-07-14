import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

vi.mock('@/lib/auth/jwt', () => ({
  extractTokenFromCookies: vi.fn(() => null),
  verifyToken: vi.fn(() => null),
}));

import { GET, PATCH } from '@/app/api/push/events/route';

// Helper to build a NextRequest-like object with the given role header.
function buildRequest(role: string | null, method = 'GET', body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (role !== null) headers['x-user-role'] = role;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('http://localhost/api/push/events', init);
}

describe('GET /api/push/events — authorization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects anonymous callers (no role) with 403', async () => {
    const res = await GET(buildRequest(null) as never);
    expect(res.status).toBe(403);
  });

  it('rejects non-admin callers (agent role)', async () => {
    const res = await GET(buildRequest('agent') as never);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/push/events — webhook secret redaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('NEVER returns the raw webhook secret — only a preview object', async () => {
    // Build a "service client" stub that pretends a secret is configured.
    const fakeClient = {
      from: (table: string) => {
        if (table === 'settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { value: 'whsec_supersecret_1234567890', updated_at: '2026-01-01' },
                }),
              }),
            }),
          };
        }
        if (table === 'push_event_log') {
          return {
            select: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    // Re-mock supabase-client so getSupabaseClient() returns our stub.
    vi.doMock('@/storage/database/supabase-client', () => ({
      getSupabaseClient: () => fakeClient,
      isDemoMode: () => false,
    }));

    // Re-import so the route picks up the new mock.
    vi.resetModules();
    const { GET: GETFresh } = await import('@/app/api/push/events/route');
    const res = await GETFresh(buildRequest('admin') as never);
    const json = await res.json();

    expect(json.success).toBe(true);
    // The full secret must NEVER appear in the response
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('whsec_supersecret_1234567890');
    // A preview object must be returned with safe fields
    expect(json.webhook_secret_preview).toBeDefined();
    expect(json.webhook_secret_preview.configured).toBe(true);
    expect(json.webhook_secret_preview.last4).toBe('7890');
    expect(typeof json.webhook_secret_preview.updated_at).toBe('string');
  });
});

describe('PATCH /api/push/events — authorization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects anonymous callers with 403', async () => {
    const res = await PATCH(buildRequest(null, 'PATCH', { id: 'x', status: 'processed' }) as never);
    expect(res.status).toBe(403);
  });

  it('rejects agent callers', async () => {
    const res = await PATCH(buildRequest('agent', 'PATCH', { id: 'x', status: 'processed' }) as never);
    expect(res.status).toBe(403);
  });
});