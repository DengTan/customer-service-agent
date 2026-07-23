/**
 * ContinuousEvalJob Unit Tests — Phase 6.5 (P4 RAG Evaluation Rollout)
 *
 * Tests cover (§3.6.2):
 * 1. Reservoir sampling — same population → same sample, size matches, only valid items.
 * 2. deriveWeakGold — gold_should_auto_reply, gold_citations (provenanceVersion=2),
 *    gold_should_handoff from conversation status.
 *
 * See also: continuous-eval-job.demo-mode.test.ts for the isDemoMode() path.
 *
 * Key architectural notes:
 * - reservoirSample() lives in its own module (reservoir-sampling.ts) and is imported
 *   directly — no mocking needed, the pure function is exercised in-process.
 * - ContinuousEvalJob is instantiated in deriveWeakGold tests. Its constructor calls
 *   `new EvalRegressionRepository()` so the repository must be mocked.
 * - vi.hoisted() spies are declared at module top level so vi.mock factories can
 *   reference them and tests can reset implementations in beforeEach.
 * - All vi.hoisted() and vi.mock() calls are at the TOP LEVEL of the module
 *   (Vitest hoists them before any other code runs).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies — referenced by vi.mock factories and reset in beforeEach.
// ---------------------------------------------------------------------------
const repoCreateSpy = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mock supabase-client — isDemoMode() = false (non-demo mode exercises real paths)
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
  isDemoMode: () => false,
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
// Mock EvalRegressionRepository
// ---------------------------------------------------------------------------
vi.mock('@/server/repositories/eval-regression-repository', () => ({
  EvalRegressionRepository: class {
    create = repoCreateSpy;
  },
}));

// ---------------------------------------------------------------------------
// Mock RegressionGateService
// ---------------------------------------------------------------------------
vi.mock('@/server/services/eval/regression-gate-service', () => ({
  RegressionGateService: class {
    static readonly HARD_MIN_DATASET_VERSION_STATUS = 'golden';
    static evaluate = vi.fn(() => ({ status: 'pass', details: [] }));
    static wilsonCIstatic = vi.fn(() => ({ value: 0.9, ci_lower: 0.85, ci_upper: 0.95 }));
    static aggregateContinuousMetrics = vi.fn(() => ({
      answer_correct: { value: 0.9, ci_lower: 0.85, ci_upper: 0.95, threshold: 0 },
    }));
    run = vi.fn().mockResolvedValue({
      status: 'pass',
      details: [],
      datasetVersionId: 'continuous',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      triggeredBy: 'continuous',
    });
  },
}));

// ---------------------------------------------------------------------------
// Import after all mocks are set up
// ---------------------------------------------------------------------------
import { ContinuousEvalJob } from '@/server/services/eval/continuous-eval-job';
import { reservoirSample } from '@/server/services/eval/reservoir-sampling';
import type { SampledRealTurn } from '@/server/services/eval/continuous-eval-job';

// ---------------------------------------------------------------------------
// Helper: minimal valid SampledRealTurn (matches the DB-query shape)
// ---------------------------------------------------------------------------
function makeTurn(overrides: Partial<SampledRealTurn> = {}): SampledRealTurn {
  return {
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'assistant',
    content: 'Here is your refund confirmation.',
    sources: [],
    metadata: {},
    created_at: new Date().toISOString(),
    conversation_status: 'active',
    user_message: 'How do I return an item?',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('ContinuousEvalJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    repoCreateSpy.mockReset();
    repoCreateSpy.mockResolvedValue({ id: 'run-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Test 1 — Reservoir sampling produces reproducible results
  //
  // reservoirSample() is a standalone pure function in reservoir-sampling.ts.
  // Assertions:
  //   (a) Sample size exactly equals the requested k.
  //   (b) Every item in the sample is from the population.
  //   (c) Sample contains no duplicates.
  //   (d) Reproducible with a fixed Math.random sequence.
  // ========================================================================

  describe('reservoirSample', () => {
    it('returns a sample with exactly k items when n > k', () => {
      const population = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const result = reservoirSample(population, 20);
      expect(result).toHaveLength(20);
    });

    it('returns the entire population when k >= n', () => {
      const population = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(reservoirSample(population, 3)).toHaveLength(3);
      expect(reservoirSample(population, 5)).toHaveLength(3);
    });

    it('sample contains only items from the population', () => {
      const population = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const result = reservoirSample(population, 10);
      for (const item of result) {
        expect(population).toContainEqual(item);
      }
    });

    it('sample contains no duplicate items', () => {
      const population = Array.from({ length: 80 }, (_, i) => ({ id: i }));
      const result = reservoirSample(population, 15);
      const ids = result.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('is reproducible — same fixed random sequence yields the same sample', () => {
      const population = Array.from({ length: 200 }, (_, i) => ({ value: i * 2 }));

      // First run
      const fixedSequence = [0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.99];
      let idx = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const v = fixedSequence[idx % fixedSequence.length];
        idx++;
        return v;
      });
      const sample1 = reservoirSample(population, 10);
      vi.spyOn(Math, 'random').mockRestore();

      // Second run with identical sequence — result must be identical
      idx = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        const v = fixedSequence[idx % fixedSequence.length];
        idx++;
        return v;
      });
      const sample2 = reservoirSample(population, 10);
      vi.spyOn(Math, 'random').mockRestore();

      expect(sample1).toEqual(sample2);
    });

    it('returns an empty array when k = 0', () => {
      expect(reservoirSample([{ id: 1 }], 0)).toEqual([]);
    });
  });

  // ========================================================================
  // Test 2 — Derive weak gold from existing signals
  //
  // deriveWeakGold() is a PUBLIC instance method:
  //   job.deriveWeakGold(turn: SampledRealTurn): WeakGold
  //
  // Rules (§3.6.2):
  //   gold_should_auto_reply  = sources[0]?.type === 'auto_reply'
  //   gold_citations          = sources filtered to provenanceVersion=2
  //                             AND kind IN ('trusted_v2', 'trusted_v1_with_audit_strip')
  //   gold_should_handoff     = conversation_status === 'handoff'
  //   gold_answer             = content (assistant message)
  //   gold_gate_decision      = metadata.retrievalTrace?.action
  // ========================================================================

  describe('deriveWeakGold', () => {
    it('sets gold_should_auto_reply = true when sources[0].type === "auto_reply"', () => {
      const turn = makeTurn({
        sources: [
          { type: 'auto_reply', provenanceVersion: 2, kind: 'trusted_v2', name: 'Greeting' },
          { type: 'knowledge', provenanceVersion: 2, kind: 'trusted_v2', name: 'Return Policy' },
        ],
      });
      expect(new ContinuousEvalJob().deriveWeakGold(turn).gold_should_auto_reply).toBe(true);
    });

    it('sets gold_should_auto_reply = false when sources[0].type !== "auto_reply"', () => {
      const turn = makeTurn({
        sources: [
          { type: 'knowledge', provenanceVersion: 2, kind: 'trusted_v2', name: 'Return Policy' },
          { type: 'auto_reply', provenanceVersion: 2, kind: 'trusted_v2', name: 'Greeting' },
        ],
      });
      expect(new ContinuousEvalJob().deriveWeakGold(turn).gold_should_auto_reply).toBe(false);
    });

    it('sets gold_should_auto_reply = false when sources is empty', () => {
      const turn = makeTurn({ sources: [] });
      expect(new ContinuousEvalJob().deriveWeakGold(turn).gold_should_auto_reply).toBe(false);
    });

    it('includes a source in gold_citations only when provenanceVersion=2', () => {
      const turn = makeTurn({
        sources: [
          { type: 'knowledge', provenanceVersion: 2, kind: 'trusted_v2', name: 'Return Policy', id: 'ki-1' },
          { type: 'knowledge', provenanceVersion: 1, kind: 'trusted_v2', name: 'Old Policy', id: 'ki-old' },
        ],
      });
      const result = new ContinuousEvalJob().deriveWeakGold(turn);
      expect(result.gold_citations).toHaveLength(1);
      expect(result.gold_citations[0].id).toBe('ki-1');
    });

    it('includes a source in gold_citations only when kind is trusted_v2 or trusted_v1_with_audit_strip', () => {
      const turn = makeTurn({
        sources: [
          { type: 'knowledge', provenanceVersion: 2, kind: 'trusted_v2', name: 'Trusted v2', id: 'ki-1' },
          {
            type: 'knowledge',
            provenanceVersion: 2,
            kind: 'trusted_v1_with_audit_strip',
            name: 'Trusted v1-audit',
            id: 'ki-2',
          },
          {
            type: 'knowledge',
            provenanceVersion: 2,
            kind: 'untrusted',
            name: 'Should be excluded',
            id: 'ki-bad',
          },
        ],
      });
      const result = new ContinuousEvalJob().deriveWeakGold(turn);
      expect(result.gold_citations).toHaveLength(2);
      expect(result.gold_citations.map((c) => c.id)).toEqual(['ki-1', 'ki-2']);
    });

    it('maps citation fields correctly: type, id, chunk_id, name, category, score', () => {
      const turn = makeTurn({
        sources: [
          {
            type: 'product',
            provenanceVersion: 2,
            kind: 'trusted_v2',
            id: 'prod-42',
            chunkId: 'chunk-7',
            name: 'Cotton T-Shirt',
            category: 'Apparel',
            score: 0.92,
          },
        ],
      });
      const result = new ContinuousEvalJob().deriveWeakGold(turn);
      expect(result.gold_citations[0]).toMatchObject({
        type: 'product',
        id: 'prod-42',
        chunk_id: 'chunk-7',
        name: 'Cotton T-Shirt',
        category: 'Apparel',
        score: 0.92,
      });
    });

    it('sets gold_should_handoff = true when conversation_status === "handoff"', () => {
      const turn = makeTurn({ conversation_status: 'handoff' });
      expect(new ContinuousEvalJob().deriveWeakGold(turn).gold_should_handoff).toBe(true);
    });

    it('sets gold_should_handoff = false when conversation_status !== "handoff"', () => {
      const turn = makeTurn({ conversation_status: 'active' });
      expect(new ContinuousEvalJob().deriveWeakGold(turn).gold_should_handoff).toBe(false);
    });

    it('sets gold_answer from content', () => {
      const turn = makeTurn({ content: 'Here is your refund confirmation.' });
      expect(new ContinuousEvalJob().deriveWeakGold(turn).gold_answer).toBe(
        'Here is your refund confirmation.',
      );
    });
  });
});
