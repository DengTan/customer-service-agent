/**
 * Sprint 3 — R-4: FastGPT timeout env override tests.
 *
 * Pin the resolution algorithm from process.env.FASTGPT_TIMEOUT_MS:
 *   - unset → 10_000 (documented default)
 *   - positive integer → that value (no silent overwrite)
 *   - malformed → falls back to 10_000
 *
 * The module-level `FASTGPT_TIMEOUT_MS` is captured via an IIFE that reads
 * `process.env.FASTGPT_TIMEOUT_MS` once. To make the env-visible behaviour
 * testable we use `vi.resetModules()` between tests so the module's IIFE
 * re-reads the env value at import time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastGPTClient, FASTGPT_TIMEOUT_DEFAULT_MS } from '@/server/services/fastgpt-client';

async function loadFastGPTModule(): Promise<{ FASTGPT_TIMEOUT_MS: number }> {
  vi.resetModules();
  return import('@/server/services/fastgpt-client');
}

describe('R-4: FASTGPT_TIMEOUT_MS resolution', () => {
  beforeEach(() => {
    delete process.env['FASTGPT_TIMEOUT_MS'];
  });
  afterEach(() => {
    delete process.env['FASTGPT_TIMEOUT_MS'];
  });

  it('exports a default of 10_000ms (sanity)', () => {
    expect(FASTGPT_TIMEOUT_DEFAULT_MS).toBe(10_000);
  });

  it('uses 10_000 when env is unset', async () => {
    delete process.env['FASTGPT_TIMEOUT_MS'];
    const mod = await loadFastGPTModule();
    expect(mod.FASTGPT_TIMEOUT_MS).toBe(10_000);
  });

  it('honours an explicit env value without silent downgrade', async () => {
    process.env['FASTGPT_TIMEOUT_MS'] = '12345';
    const mod = await loadFastGPTModule();
    expect(mod.FASTGPT_TIMEOUT_MS).toBe(12_345);
  });

  it('falls back to 10_000 when env value is malformed (non-numeric)', async () => {
    process.env['FASTGPT_TIMEOUT_MS'] = 'not-a-number';
    const mod = await loadFastGPTModule();
    expect(mod.FASTGPT_TIMEOUT_MS).toBe(10_000);
  });

  it('falls back to 10_000 when env value is non-positive', async () => {
    process.env['FASTGPT_TIMEOUT_MS'] = '0';
    const mod = await loadFastGPTModule();
    expect(mod.FASTGPT_TIMEOUT_MS).toBe(10_000);
  });

  it('FastGPTClient construction does not throw a timeout-related error', () => {
    // Construct a valid client without making a network call, to verify
    // that the timeout resolution doesn't break construction.
    const cfg = {
      enabled: true,
      provider: 'fastgpt',
      baseUrl: 'https://example.com',
      apiKey: 'k',
      datasetId: 'a'.repeat(24),
    };
    expect(() => new FastGPTClient(cfg)).not.toThrow();
  });
});
