import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiProblemError, isApiProblem, parseProblem } from '@/lib/fetch-api';

describe('RFC 7807 fetch-api error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses application/problem+json response into ApiProblemError', async () => {
    const res = new Response(
      JSON.stringify({ type: '/problems/unauthorized', title: 'Unauthorized', status: 401, detail: 'login required' }),
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
    const err = await parseProblem(res);
    expect(err).toBeInstanceOf(ApiProblemError);
    expect(err?.status).toBe(401);
    expect(err?.type).toBe('/problems/unauthorized');
    expect(err?.detail).toBe('login required');
  });

  it('returns null when content type is not problem+json', async () => {
    const res = new Response(JSON.stringify({ error: 'bad' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await parseProblem(res)).toBeNull();
  });

  it('isApiProblem narrows unknown errors', () => {
    const e: unknown = new ApiProblemError(
      { type: '/problems/forbidden', title: 'Forbidden', status: 403, detail: 'no perm', instance: '/api/x' },
      new Response(null, { status: 403 }),
    );
    expect(isApiProblem(e)).toBe(true);
    expect(isApiProblem(new Error('plain'))).toBe(false);
    expect(isApiProblem('string')).toBe(false);
  });
});
