import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── vi.hoisted — must be hoisted so vi.mock factories can reference these ──
const mocks = vi.hoisted(() => ({
  rotate: vi.fn(),
  extractTokenMock: vi.fn(() => 'mock-valid-token'),
  verifyTokenMock: vi.fn(() => ({ role: 'admin', userId: 'u-admin' })),
  checkPermissionMock: vi.fn(async () => true),
  extractUserRoleMock: vi.fn(() => 'admin'),
}));

// ── JWT mock ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/jwt', () => ({
  extractTokenFromCookies: mocks.extractTokenMock,
  verifyToken: mocks.verifyTokenMock,
}));

// ── PermissionService mock ────────────────────────────────────────────────────
vi.mock('@/server/services/permission-service', () => ({
  PermissionService: class { checkPermission = mocks.checkPermissionMock; },
}));

// ── api-utils stub ─────────────────────────────────────────────────────────
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    extractUserRole: mocks.extractUserRoleMock,
  };
});

vi.mock('@/server/services/push-secret-service', () => ({
  PushSecretService: class { rotate = mocks.rotate; },
}));

import { POST } from './route';

function request(role: string | null): Request {
  const headers = new Headers();
  if (role) headers.set('x-user-role', role);
  return new Request('http://localhost/api/push/secret/rotate', { method: 'POST', headers });
}

describe('POST /api/push/secret/rotate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rotate.mockResolvedValue({ last4: 'wxyz', rotated_at: '2026-07-13T04:00:00.000Z' });
    // Default: admin role, permission granted.
    mocks.extractUserRoleMock.mockReturnValue('admin');
    mocks.checkPermissionMock.mockResolvedValue(true);
  });

  it('rejects non-admin callers with 403', async () => {
    // Agent role → RBAC check fails → 403.
    mocks.extractUserRoleMock.mockReturnValue('agent');
    mocks.checkPermissionMock.mockResolvedValue(false);
    const response = await POST(request('agent') as never);
    expect(response.status).toBe(403);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it('rotates for admins without returning the complete secret', async () => {
    const response = await POST(request('admin') as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, last4: 'wxyz', rotated_at: '2026-07-13T04:00:00.000Z' });
    expect(JSON.stringify(body)).not.toContain('push_webhook_secret');
    expect(mocks.rotate).toHaveBeenCalledOnce();
  });
});
