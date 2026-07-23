/**
 * ContinuousEvalJob Demo-Mode Unit Test — Phase 6.5 (P4 RAG Evaluation Rollout)
 *
 * Test: run() handles demo mode gracefully
 *
 * When isDemoMode() returns true, sampleRealTurns short-circuits with an empty
 * array and run() returns { ok: true, sampled: 0, evaluated: 0 }.
 *
 * This is a SEPARATE test file so its vi.mock for supabase-client does not
 * conflict with the base mock in continuous-eval-job.test.ts (Vitest hoists
 * all vi.mock calls to the top of the file, so only one mock per module wins
 * per file; a separate file gives the demo-mode mock its own scope).
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock supabase-client with isDemoMode: () => true — DEMO MODE
// ---------------------------------------------------------------------------
vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ then: vi.fn() })),
      eq: vi.fn(() => ({ then: vi.fn() })),
      not: vi.fn(() => ({ then: vi.fn() })),
      gte: vi.fn(() => ({ then: vi.fn() })),
      lt: vi.fn(() => ({ then: vi.fn() })),
      order: vi.fn(() => ({ then: vi.fn() })),
      limit: vi.fn(() => ({ then: vi.fn() })),
      insert: vi.fn(() => ({ then: vi.fn() })),
    })),
  })),
  isDemoMode: () => true, // ← demo mode short-circuit
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    for: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    errorWithException: vi.fn(),
  })),
  createLogger: vi.fn(),
  clearLoggerCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock EvalRegressionRepository (not called in demo mode but needed for ctor)
// ---------------------------------------------------------------------------
vi.mock('@/server/repositories/eval-regression-repository', () => ({
  EvalRegressionRepository: class {
    create = vi.fn();
  },
}));

// ---------------------------------------------------------------------------
// Mock RegressionGateService (not called in demo mode but imported by service)
// ---------------------------------------------------------------------------
vi.mock('@/server/services/eval/regression-gate-service', () => ({
  RegressionGateService: class {
    static readonly HARD_MIN_DATASET_VERSION_STATUS = 'golden';
    static evaluate = vi.fn();
    static wilsonCIstatic = vi.fn();
    static aggregateContinuousMetrics = vi.fn();
    run = vi.fn();
  },
}));

// ---------------------------------------------------------------------------
// Import after all mocks are set up
// ---------------------------------------------------------------------------
import { ContinuousEvalJob } from '@/server/services/eval/continuous-eval-job';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('ContinuousEvalJob — demo mode', () => {
  it('returns { ok: true, sampled: 0, evaluated: 0 } when isDemoMode() is true', async () => {
    const job = new ContinuousEvalJob();
    const result = await job.run({ since: '2025-01-01T00:00:00Z', sampledN: 200 });
    expect(result).toEqual({ ok: true, sampled: 0, evaluated: 0 });
  });
});
