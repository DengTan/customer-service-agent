import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auth so the route believes we have an authenticated agent with conversations:read.
vi.mock('@/lib/auth/jwt', () => ({
  extractTokenFromCookies: vi.fn(() => 'mock-token'),
  verifyToken: vi.fn(() => ({ role: 'agent', userId: 'u-1' })),
}));

// Hoisted spies so vi.doMock factories can reference them after resetModules.
const { getDetailMock, getSettingsMapMock } = vi.hoisted(() => ({
  getDetailMock: vi.fn(),
  getSettingsMapMock: vi.fn(),
}));

// Stub PermissionService so requirePermission passes.
vi.mock('@/server/services/permission-service', () => ({
  PermissionService: class { checkPermission = vi.fn(async () => true); },
}));

// Default class-shape mocks. Individual tests can override via vi.doMock + resetModules.
vi.mock('@/server/services/conversation-service', () => ({
  ConversationService: class { getConversationDetail = getDetailMock; },
}));
vi.mock('@/server/services/settings-service', () => ({
  SettingsService: class { getSettingsMap = getSettingsMapMock; },
}));

import { GET } from '@/app/api/conversations/[id]/route';

function buildRequest(): Request {
  return new Request('http://localhost/api/conversations/conv-1', {
    method: 'GET',
    headers: { cookie: 'auth-token=mock-token' },
  });
}

const fakeDetail = {
  conversation: { id: 'conv-1', status: 'active', title: 't' },
  messages: [],
  total_messages: 0,
};

describe('GET /api/conversations/[id] — capability surface (phase 4)', () => {
  beforeEach(() => {
    getDetailMock.mockReset();
    getSettingsMapMock.mockReset();
    getDetailMock.mockResolvedValue(fakeDetail);
    getSettingsMapMock.mockResolvedValue({ rating_enabled: 'true' });
  });

  it('returns capabilities.rating_enabled in the detail payload', async () => {
    const res = await GET(buildRequest() as never, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.capabilities).toBeDefined();
    expect(json.capabilities).toEqual({ rating_enabled: expect.any(Boolean) });
  });

  it('reports rating_enabled=true when settings.rating_enabled is "true"', async () => {
    getSettingsMapMock.mockResolvedValue({ rating_enabled: 'true' });
    const res = await GET(buildRequest() as never, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    const json = await res.json();
    expect(json.capabilities.rating_enabled).toBe(true);
  });

  it('reports rating_enabled=false when settings.rating_enabled is "false"', async () => {
    getDetailMock.mockResolvedValue({
      conversation: { id: 'conv-1', status: 'ended', title: 't', rating: null },
      messages: [],
      total_messages: 0,
    });
    getSettingsMapMock.mockResolvedValue({ rating_enabled: 'false' });
    const res = await GET(buildRequest() as never, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    const json = await res.json();
    expect(json.capabilities.rating_enabled).toBe(false);
  });

  it('defaults rating_enabled=true when the settings lookup throws', async () => {
    getSettingsMapMock.mockRejectedValue(new Error('settings down'));
    const res = await GET(buildRequest() as never, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    const json = await res.json();
    expect(json.capabilities.rating_enabled).toBe(true);
  });

  it('NEVER reads the admin-only /api/settings endpoint for the capability', async () => {
    // Sanity: the route must not call /api/settings on the frontend.
    // We assert by spying on global fetch: no URL matching /api/settings must appear.
    const fetchSpy: typeof fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      await GET(buildRequest() as never, {
        params: Promise.resolve({ id: 'conv-1' }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const calls = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    for (const call of calls) {
      const url = String(call[0] ?? '');
      expect(url).not.toContain('/api/settings');
    }
  });
});
