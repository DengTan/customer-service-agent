/**
 * Unit tests for the pure helper `performSettingsReset`.
 *
 * Contract (phase 2 of `settings-rls-hardening`):
 *   - POST /api/settings/reset with empty body.
 *   - On 2xx → GET /api/settings → return { ok:true, settings }.
 *   - On reset HTTP failure / network error → { ok:false, phase:'reset' }.
 *   - On reload HTTP failure / network error / JSON parse error → { ok:false, phase:'reload' }.
 *   - NEVER returns { ok:true } when reload fails — the user must NOT see a
 *     misleading success toast after a partial reset.
 *
 * The helper is intentionally a plain async function so it can be exercised
 * here without rendering the React component (which depends on toast /
 * confirm dialog / dynamic imports).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { performSettingsReset } from './settings-page';

type FetchArgs = Parameters<typeof fetch>;
type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function jsonResponse(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('performSettingsReset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok=true and the reloaded settings on full success', async () => {
    const fetchedUrls: string[] = [];
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      const url = String(args[0]);
      fetchedUrls.push(url);
      if (url === '/api/settings/reset') {
        return jsonResponse(200, { success: true, resetCount: 50 });
      }
      if (url === '/api/settings') {
        return jsonResponse(200, {
          data: { settings: { theme: 'light', welcome_message: 'hi' } },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings).toEqual({ theme: 'light', welcome_message: 'hi' });
    }
    expect(fetchedUrls).toEqual(['/api/settings/reset', '/api/settings']);
  });

  it('POSTs to /api/settings/reset with empty body (no client-supplied scope)', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        return jsonResponse(200, { success: true });
      }
      return jsonResponse(200, { data: { settings: {} } });
    }) as unknown as typeof fetch;

    await performSettingsReset(fetchImpl);
    const firstCall = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const [, init] = firstCall as [string, RequestInit | undefined];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });

  it('returns ok=false phase=reset when reset POST fails (non-2xx)', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        return jsonResponse(500, { success: false, code: 'RESET_RPC_FAILED' });
      }
      return jsonResponse(200, { data: { settings: {} } });
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('reset');
      expect(result.error).toBeTruthy();
    }
  });

  it('returns ok=false phase=reset when reset POST throws (network error)', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(200, { data: { settings: {} } });
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('reset');
    }
  });

  it('returns ok=false phase=reload when reset succeeds but reload HTTP fails', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        return jsonResponse(200, { success: true });
      }
      return jsonResponse(500, { error: 'db down' });
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('reload');
      expect(result.error).toMatch(/重置成功，但重新加载/);
    }
  });

  it('returns ok=false phase=reload when reload throws (network error)', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        return jsonResponse(200, { success: true });
      }
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('reload');
    }
  });

  it('returns ok=false phase=reload when reload JSON is malformed', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        return jsonResponse(200, { success: true });
      }
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      };
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('reload');
    }
  });

  it('returns ok=true with empty settings when reload payload has no data.settings', async () => {
    const fetchImpl = vi.fn(async (...args: FetchArgs): Promise<FetchResponse> => {
      if (String(args[0]) === '/api/settings/reset') {
        return jsonResponse(200, { success: true });
      }
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;

    const result = await performSettingsReset(fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings).toEqual({});
    }
  });
});