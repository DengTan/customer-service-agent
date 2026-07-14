/**
 * Unit tests for `POST /api/settings/reset`.
 *
 * Contract (phase 1 of `settings-rls-hardening_5c312208.plan.md`):
 *   - Admin-only gate → 403 for non-admin / unauthenticated.
 *   - Empty body / null / `{}` → factory reset via reset RPC (server-fixed scope).
 *   - Malformed JSON (invalid syntax) → 400 RESET_PAYLOAD_MALFORMED.
 *   - Non-empty body → 400 RESET_PAYLOAD_NOT_EMPTY.
 *   - RPC error → 500 (fail closed).
 *
 * Mock strategy:
 *   - `requireRole` is mocked via `importOriginal` so auth can be fully controlled.
 *   - `resetToDefaults` is patched on the real singleton in each `beforeEach`.
 *     This is necessary because the module-level singleton is created at
 *     module-load time before the hoisted mocks apply.
 *   - Demo mode (isDemoMode()) is exercised via settings-repository.reset.test.ts,
 *     not here, because mocking env-var-based demo mode at the route level is
 *     unreliable with the singleton-based Supabase client architecture.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    api: { error: vi.fn(), warn: vi.fn() },
    security: { warn: vi.fn() },
  },
}));

// Mock `requireRole` — bypass the cookie/JWT chain. All other exports
// (withErrorHandlerSimple, apiSuccess) come from the real module.
vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    requireRole: vi.fn((_request: unknown, _allowedRoles: string[]) => null),
    extractUserRole: vi.fn(),
  };
});

// ── route import ───────────────────────────────────────────────────────────────
import { POST } from './route';
import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { getSettingsRepository } from '@/server/repositories/settings-repository';
import { RepositoryError } from '@/server/repositories/repository-error';

// ── helpers ───────────────────────────────────────────────────────────────────
function buildReq(body: unknown): NextRequest {
  const url = new URL('http://localhost/api/settings/reset');
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(new Request(url, init));
}

/**
 * Build a NextRequest whose underlying Request body is a raw, malformed-JSON
 * string. We can't use `buildReq` here because JSON.stringify always produces
 * a valid string.
 */
function buildMalformedReq(rawBody: string): NextRequest {
  const url = new URL('http://localhost/api/settings/reset');
  return new NextRequest(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    })
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/settings/reset — auth', () => {
  beforeEach(() => {
    (requireRole as ReturnType<typeof vi.fn>).mockReset();
  });

  it('returns 403 when requireRole denies access', async () => {
    (requireRole as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Response(JSON.stringify({ success: false, code: 'FORBIDDEN' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    );
    const resp = await POST(buildReq(undefined) as never);
    expect(resp.status).toBe(403);
  });

  it('proceeds past auth gate when requireRole returns null', async () => {
    (requireRole as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const repo = getSettingsRepository();
    const original = repo.resetToDefaults.bind(repo);
    repo.resetToDefaults = vi.fn().mockResolvedValue(undefined);
    const resp = await POST(buildReq(undefined) as never);
    expect(resp.status).toBe(200);
    repo.resetToDefaults = original;
  });
});

describe('POST /api/settings/reset — payload contract', () => {
  beforeEach(() => {
    (requireRole as ReturnType<typeof vi.fn>).mockReset();
    (requireRole as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const repo = getSettingsRepository();
    repo.resetToDefaults = vi.fn().mockResolvedValue(undefined);
  });

  it('accepts empty body and triggers factory reset', async () => {
    const resp = await POST(buildReq(undefined) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.resetCount).toBeGreaterThan(0);
  });

  it('accepts null body and triggers factory reset', async () => {
    const resp = await POST(buildReq(null) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
  });

  it('accepts empty object body {} and triggers factory reset', async () => {
    const resp = await POST(buildReq({}) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
  });

  it('rejects non-empty body with 400 RESET_PAYLOAD_NOT_EMPTY', async () => {
    const resp = await POST(buildReq({ theme: 'dark' }) as never);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('RESET_PAYLOAD_NOT_EMPTY');
  });

  it('rejects body with arbitrary extra fields with 400', async () => {
    const resp = await POST(buildReq({ theme: 'dark', extra: 'x' }) as never);
    expect(resp.status).toBe(400);
  });

  it('rejects body containing only non-resettable keys', async () => {
    const resp = await POST(
      buildReq({ gorgias_api_key: 'sk-test', custom_tools: '[]' }) as never
    );
    expect(resp.status).toBe(400);
  });
});

describe('POST /api/settings/reset — malformed JSON', () => {
  beforeEach(() => {
    (requireRole as ReturnType<typeof vi.fn>).mockReset();
    (requireRole as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const repo = getSettingsRepository();
    repo.resetToDefaults = vi.fn().mockResolvedValue(undefined);
  });

  it('rejects malformed JSON with 400 RESET_PAYLOAD_MALFORMED', async () => {
    const resp = await POST(buildMalformedReq('{ "theme": ') as never);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('RESET_PAYLOAD_MALFORMED');
  });

  it('rejects malformed JSON does NOT call resetToDefaults', async () => {
    const repo = getSettingsRepository();
    repo.resetToDefaults = vi.fn().mockResolvedValue(undefined);
    await POST(buildMalformedReq('not json at all') as never);
    expect(repo.resetToDefaults).not.toHaveBeenCalled();
  });
});

describe('POST /api/settings/reset — RPC wiring', () => {
  beforeEach(() => {
    (requireRole as ReturnType<typeof vi.fn>).mockReset();
    (requireRole as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const repo = getSettingsRepository();
    repo.resetToDefaults = vi.fn().mockResolvedValue(undefined);
  });

  it('calls resetToDefaults with RESETTABLE_DEFAULTS and correct allowed keys', async () => {
    await POST(buildReq(undefined) as never);

    const repo = getSettingsRepository();
    expect(repo.resetToDefaults).toHaveBeenCalledTimes(1);
    const [defaults, allowedKeys] = (repo.resetToDefaults as ReturnType<typeof vi.fn>).mock.calls[0]!;

    expect(defaults).toHaveProperty('system_prompt');
    expect(defaults).toHaveProperty('theme');
    expect(allowedKeys).toContain('system_prompt');
    expect(allowedKeys).toContain('theme');
    expect(allowedKeys).not.toContain('gorgias_api_key');
    expect(allowedKeys).not.toContain('custom_tools');
  });

  it('returns resetCount matching the allowed keys count', async () => {
    const resp = await POST(buildReq(undefined) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.resetCount).toBeGreaterThan(0);
  });

  it('propagates RepositoryError as 500 with code RESET_RPC_FAILED', async () => {
    const repo = getSettingsRepository();
    repo.resetToDefaults = vi.fn().mockRejectedValue(
      new RepositoryError('reset', 'service_role denied', '42501')
    );

    const resp = await POST(buildReq(undefined) as never);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('RESET_RPC_FAILED');
  });

  it('survives non-RepositoryError as INTERNAL_ERROR 500', async () => {
    const repo = getSettingsRepository();
    repo.resetToDefaults = vi.fn().mockRejectedValue(new Error('unexpected network error'));

    const resp = await POST(buildReq(undefined) as never);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.success).toBe(false);
  });
});
