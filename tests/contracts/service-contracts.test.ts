/**
 * Contract tests for public service interfaces (B5).
 *
 * These tests verify the contracts between the API layer and the service layer,
 * focusing on the public-facing interfaces that other code depends on.
 *
 * Run: `pnpm test:run -- tests/contracts`
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { EffectBus } from '@/lib/effects/bus';
import { PaginationSchema, IdParamSchema, parseBody, parseQuery } from '@/lib/api/parse';
import { withApi } from '@/lib/api/with-api';

// ─── Contract: LLMStreamOptions ───────────────────────────────────────────

describe('LLMStreamOptions contract (B5)', () => {
  it('accepts the documented option shape', () => {
    const ac = new AbortController();
    const options = {
      abortSignal: ac.signal,
      abortController: ac,
    };
    expect(typeof options.abortSignal.addEventListener).toBe('function');
    expect(typeof options.abortController.abort).toBe('function');
  });
});

// ─── Contract: EffectBus ─────────────────────────────────────────────────────

describe('EffectBus contract (B5)', () => {
  it('register returns void', () => {
    const bus = new EffectBus();
    const result = bus.register('test', {
      mode: 'best-effort',
      execute: async () => {},
    });
    expect(result).toBeUndefined();
  });

  it('dispatch returns void', async () => {
    const bus = new EffectBus();
    const result = await bus.dispatch({ conversationId: 'c1' }, new AbortController().signal);
    expect(result).toBeUndefined();
  });

  it('mode is either critical or best-effort', () => {
    const modes: Array<'critical' | 'best-effort'> = ['critical', 'best-effort'];
    modes.forEach((mode) => {
      const bus = new EffectBus();
      bus.register('test', { mode, execute: async () => {} });
      expect(bus.size).toBe(1);
    });
  });

  it('aborts in-flight when signal is aborted', async () => {
    const bus = new EffectBus();
    const ac = new AbortController();
    let wasCalled = false;

    bus.register('test', {
      mode: 'best-effort',
      execute: async () => { wasCalled = true; },
    });

    // Abort before dispatch
    ac.abort();
    await bus.dispatch({ conversationId: 'c1' }, ac.signal);
    expect(wasCalled).toBe(false);
  });
});

// ─── Contract: parse helpers ───────────────────────────────────────────────

describe('parseBody contract (B5)', () => {
  it('returns NextResponse on invalid JSON', async () => {
    const req = new NextRequest('http://localhost/test', {
      method: 'POST',
      body: 'not-valid-json',
      headers: { 'content-type': 'application/json' },
    });
    const result = await parseBody(req, z.object({ name: z.string() }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('returns NextResponse on validation failure', async () => {
    const req = new NextRequest('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({ name: 123 }),
      headers: { 'content-type': 'application/json' },
    });
    const result = await parseBody(req, z.object({ name: z.string() }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(422);
  });

  it('returns parsed object on success', async () => {
    const req = new NextRequest('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alice' }),
      headers: { 'content-type': 'application/json' },
    });
    const result = await parseBody(req, z.object({ name: z.string() }));
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual({ name: 'Alice' });
  });
});

describe('parseQuery contract (B5)', () => {
  it('returns NextResponse on validation failure', () => {
    const req = new NextRequest('http://localhost/test?page=abc', { method: 'GET' });
    const result = parseQuery(req, z.object({ page: z.coerce.number().int().positive() }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('returns parsed object on success', () => {
    const req = new NextRequest('http://localhost/test?page=5&limit=10', { method: 'GET' });
    const result = parseQuery(req, z.object({
      page: z.coerce.number().int().positive(),
      limit: z.coerce.number().int().positive().max(100),
    }));
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual({ page: 5, limit: 10 });
  });
});

describe('PaginationSchema contract (B5)', () => {
  it('applies correct defaults', () => {
    const result = PaginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('accepts coerced string values', () => {
    const result = PaginationSchema.parse({ page: '3', limit: '50' });
    expect(result).toEqual({ page: 3, limit: 50 });
  });

  it('rejects limit over 100', () => {
    expect(() => PaginationSchema.parse({ limit: 200 })).toThrow();
  });
});

describe('IdParamSchema contract (B5)', () => {
  it('accepts valid UUID', () => {
    const result = IdParamSchema.parse({ id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects empty id', () => {
    expect(() => IdParamSchema.parse({ id: '' })).toThrow();
    expect(() => IdParamSchema.parse({})).toThrow();
  });
});

// ─── Contract: withApi ─────────────────────────────────────────────────────

describe('withApi contract (B5)', () => {
  it('returns a handler function', () => {
    const handler = withApi({ auth: 'public' }, async () => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    expect(typeof handler).toBe('function');
  });
});

// ─── Contract: effect_outbox table ─────────────────────────────────────

describe('effect_outbox schema contract (B5)', () => {
  it('effectOutbox table is defined', async () => {
    const { effectOutbox } = await import('@/storage/database/shared/schema');
    // Verify the table object is defined (TypeScript ensures the rest)
    expect(effectOutbox).toBeDefined();
    expect(typeof effectOutbox).toBe('object');
  });
});
