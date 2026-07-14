import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rotate: vi.fn() }));

vi.mock('@/lib/auth/jwt', () => ({
  extractTokenFromCookies: vi.fn(() => null),
  verifyToken: vi.fn(() => null),
}));
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
  });

  it('rejects non-admin callers', async () => {
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
