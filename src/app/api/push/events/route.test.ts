import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

// ── JWT mock ──────────────────────────────────────────────────────────────────
// Use vi.hoisted() so spies are initialized before the factory runs.
const { extractTokenMock, verifyTokenMock } = vi.hoisted(() => ({
  extractTokenMock: vi.fn(() => 'mock-valid-token'),
  verifyTokenMock: vi.fn(() => ({ role: 'admin', userId: 'u-admin' })),
}));

vi.mock('@/lib/auth/jwt', () => ({
  extractTokenFromCookies: extractTokenMock,
  verifyToken: verifyTokenMock,
}));

// ── PermissionService mock ────────────────────────────────────────────────────
// Hoisted so the factory can reference it; factory-default = allow all.
const { checkPermissionMock } = vi.hoisted(() => ({ checkPermissionMock: vi.fn(async () => true) }));
vi.mock('@/server/services/permission-service', () => ({
  PermissionService: class { checkPermission = checkPermissionMock; },
}));

// ── api-utils stub ─────────────────────────────────────────────────────────
// Stub extractUserRole so each test can control the role without the JWT chain.
// This avoids the "JWT mock vs api-utils closure" problem where extractUserRole
// in api-utils closes over the real (unmocked) JWT module.
// requirePermission is kept real so the RBAC check uses the real PermissionService.
// Hoisted via vi.hoisted() so the factory can reference it (vi.mock is hoisted).
const { extractUserRoleMock } = vi.hoisted(() => ({ extractUserRoleMock: vi.fn(() => 'admin') }));
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    extractUserRole: extractUserRoleMock,
  };
});

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
    vi.clearAllMocks();
    // Default: admin role, permission granted.
    vi.mocked(extractUserRoleMock).mockReturnValue('admin');
    vi.mocked(checkPermissionMock).mockResolvedValue(true);
  });

  it('rejects anonymous callers with 401 (no role)', async () => {
    // No role → extractUserRole returns null → withApi auth fails → 401.
    vi.mocked(extractUserRoleMock).mockReturnValue(null);
    const res = await GET(buildRequest(null) as never);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin callers with 403 (no permission)', async () => {
    // Agent role → extractUserRole returns 'agent' → RBAC check fails → 403.
    vi.mocked(extractUserRoleMock).mockReturnValue('agent');
    vi.mocked(checkPermissionMock).mockResolvedValue(false);
    const res = await GET(buildRequest('agent') as never);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/push/events — webhook secret redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // Use importOriginal so all api-utils exports (HttpStatus, apiSuccess, etc.)
    // are preserved; only override the two we need to bypass auth/RBAC.
    vi.doMock('@/storage/database/supabase-client', () => ({
      getSupabaseClient: () => fakeClient,
      isDemoMode: () => false,
    }));
    vi.doMock('@/lib/api-utils', async () => {
      const actual = await import('@/lib/api-utils');
      return {
        ...actual,
        extractUserRole: () => 'admin',
        requirePermission: () => Promise.resolve(null),
      };
    });

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
    vi.clearAllMocks();
    // Default: admin role, permission granted.
    vi.mocked(extractUserRoleMock).mockReturnValue('admin');
    vi.mocked(checkPermissionMock).mockResolvedValue(true);
  });

  it('rejects anonymous callers with 401 (no role)', async () => {
    vi.mocked(extractUserRoleMock).mockReturnValue(null);
    const res = await PATCH(buildRequest(null, 'PATCH', { id: 'x', status: 'processed' }) as never);
    expect(res.status).toBe(401);
  });

  it('rejects agent callers with 403 (no permission)', async () => {
    vi.mocked(extractUserRoleMock).mockReturnValue('agent');
    vi.mocked(checkPermissionMock).mockResolvedValue(false);
    const res = await PATCH(buildRequest('agent', 'PATCH', { id: 'x', status: 'processed' }) as never);
    expect(res.status).toBe(403);
  });
});