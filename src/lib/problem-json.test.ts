import { describe, expect, it } from 'vitest';
import { buildProblem, problemResponse, PROBLEM_JSON_CONTENT_TYPE } from '@/lib/api/problem-json';

describe('RFC 7807 Problem Details', () => {
  it('buildProblem maps status codes to canonical type/title', () => {
    const p = buildProblem(404, 'Conversation missing');
    expect(p.type).toBe('/problems/not-found');
    expect(p.title).toBe('Not Found');
    expect(p.status).toBe(404);
    expect(p.detail).toBe('Conversation missing');
  });

  it('buildProblem honors explicit overrides', () => {
    const p = buildProblem(400, 'invalid sku', {
      type: '/problems/validation',
      title: 'Validation Failed',
      instance: '/api/knowledge/products',
    });
    expect(p.type).toBe('/problems/validation');
    expect(p.title).toBe('Validation Failed');
    expect(p.instance).toBe('/api/knowledge/products');
  });

  it('buildProblem forwards extension members', () => {
    const p = buildProblem(403, 'denied', { extensions: { code: 'FORBIDDEN', reason: 'role_mismatch' } });
    expect(p.code).toBe('FORBIDDEN');
    expect(p.reason).toBe('role_mismatch');
  });

  it('problemResponse sets application/problem+json content type', async () => {
    const res = problemResponse(401, 'login required');
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toBe(PROBLEM_JSON_CONTENT_TYPE);
    const body = await res.json();
    expect(body.type).toBe('/problems/unauthorized');
    expect(body.status).toBe(401);
    expect(body.detail).toBe('login required');
  });

  it('problemResponse supports custom headers', () => {
    const res = problemResponse(503, 'maintenance', { headers: { 'x-trace-id': 'abc' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toBe(PROBLEM_JSON_CONTENT_TYPE);
    expect(res.headers.get('x-trace-id')).toBe('abc');
  });

  it('falls back to about:blank for unknown statuses', () => {
    const p = buildProblem(418, 'teapot');
    expect(p.type).toBe('about:blank');
    expect(p.title).toBe('Error');
  });
});
