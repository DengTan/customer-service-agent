/**
 * RegressionGateService Unit Tests — Phase 4.7
 *
 * Tests cover:
 * 1. evaluate() — warn when CI crosses warn_at, fail when CI crosses fail_at
 *    - direction='lower_is_worse': ci_lower < warn_at → warn, ci_lower < fail_at → fail
 *    - direction='higher_is_worse': ci_upper > warn_at → warn, ci_upper > fail_at → fail
 * 2. evaluate() — aggregate status: fail > warn > pass
 *    - one fail → overall=fail; one warn + rest pass → overall=warn; all pass → overall=pass
 * 3. wilsonCIstatic() — Wilson CI bounds are computed correctly (p=0.8, n=100 known values)
 * 4. run() rejects non-golden datasets; proceeds for golden datasets
 *
 * Key architectural notes:
 * - evaluate() and wilsonCIstatic() are PUBLIC STATIC methods on RegressionGateService.
 *   Tests call them directly: RegressionGateService.evaluate(...), RegressionGateService.wilsonCIstatic(...)
 * - RegressionGateService is NOT mocked so static methods are accessible.
 * - Mock isDemoMode() = true in supabase-client so repository methods short-circuit
 *   without making real DB calls (used for run() tests).
 * - External services (RetrievalOrchestrator, LLMStreamingService) are mocked because
 *   they are called during replayAndScore().
 * - All vi.hoisted() and vi.mock() calls are at the TOP LEVEL of the module
 *   (Vitest hoists them before any other code runs).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted spies — declared at module top level so the vi.mock factory can reference
// them and tests can reset their implementations.
// ---------------------------------------------------------------------------
const getVersionSpy = vi.hoisted(() => vi.fn());
const listTurnsSpy = vi.hoisted(() => vi.fn());
const thresholdsListSpy = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mock isDemoMode() = true — repositories short-circuit without DB calls
// ---------------------------------------------------------------------------
vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ then: vi.fn() })),
      eq: vi.fn(() => ({ then: vi.fn() })),
      order: vi.fn(() => ({ then: vi.fn() })),
      insert: vi.fn(() => ({ then: vi.fn() })),
    })),
  })),
  isDemoMode: () => true,
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
// Mock EvalDatasetRepository — uses hoisted spies so tests can control behavior
// ---------------------------------------------------------------------------
vi.mock('@/server/repositories/eval-dataset-repository', () => ({
  EvalDatasetRepository: class {
    getVersion = getVersionSpy;
    listTurns = listTurnsSpy;
  },
}));

// ---------------------------------------------------------------------------
// Mock EvalGateThresholdsRepository — uses hoisted spy
// ---------------------------------------------------------------------------
vi.mock('@/server/repositories/eval-gate-thresholds-repository', () => ({
  EvalGateThresholdsRepository: class {
    list = thresholdsListSpy;
  },
}));

// ---------------------------------------------------------------------------
// Mock companion services invoked during replay
// ---------------------------------------------------------------------------
vi.mock('@/server/services/retrieval-orchestrator', () => ({
  RetrievalOrchestrator: class {
    retrieve = vi.fn().mockResolvedValue({
      evidence: {
        citations: [],
        candidates: [],
        accepted: [],
        trace: {
          provenanceVersion: 2 as const,
          retrievalRan: true,
          rerankDegraded: false,
          hybridSearch: false,
          candidateCount: 0,
          acceptedCount: 0,
          citationCount: 0,
          minScore: 0.75,
          executionTimeMs: 10,
          degradationReasons: [],
        },
      },
      knowledgeContext: { context: '', knowledgeSources: [], confidence: 0, images: [] },
      productContext: undefined,
      sizeChartContext: undefined,
    });
  },
}));

vi.mock('@/server/services/llm-streaming-service', () => ({
  LLMStreamingService: class {
    createStream = vi.fn().mockReturnValue({
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"content":"test reply"}\n\n') })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"done":true}\n\n') })
          .mockResolvedValueOnce({ done: true }),
      }),
    });
  },
}));

// ---------------------------------------------------------------------------
// Import the REAL service — static methods evaluate() and wilsonCIstatic()
// are directly accessible as RegressionGateService.evaluate(...) etc.
// ---------------------------------------------------------------------------
import { RegressionGateService } from './regression-gate-service';
import type { EvalGateThresholdRow } from '@/server/repositories/eval-gate-thresholds-repository';

// ---------------------------------------------------------------------------
// Helper: build a threshold row matching EvalGateThresholdRow
// ---------------------------------------------------------------------------
function makeThreshold(overrides: Partial<EvalGateThresholdRow> & {
  metric: string;
  fail_at: number;
  warn_at: number;
  direction: 'lower_is_worse' | 'higher_is_worse';
}): EvalGateThresholdRow {
  return {
    ...overrides,
    id: 'thresh-' + overrides.metric,
    description: overrides.metric,
    updated_by: null,
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('RegressionGateService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset spy implementations so each test has a clean slate
    getVersionSpy.mockReset();
    listTurnsSpy.mockReset();
    thresholdsListSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Test 1 — evaluate: warn when CI crosses warn_at, fail when CI crosses fail_at
  //
  // evaluate() is a PUBLIC STATIC method:
  //   RegressionGateService.evaluate(metrics, thresholds) → { status, details }
  //
  // direction = 'lower_is_worse':
  //   ci_lower < warn_at  → warn
  //   ci_lower < fail_at  → fail  (fail wins when both would apply)
  //   ci_lower >= warn_at → pass
  //
  // direction = 'higher_is_worse':
  //   ci_upper > warn_at  → warn
  //   ci_upper > fail_at → fail  (fail wins when both would apply)
  //   ci_upper <= warn_at → pass
  // ========================================================================

  describe('evaluate', () => {
    // -- lower_is_worse direction --

    it('returns pass when ci_lower >= warn_at (and no other metric fails/warns)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // ci_lower = 0.87, warn_at = 0.85 → pass (0.87 >= 0.85)
      const metrics = {
        answer_correct: { value: 0.87, ci_lower: 0.87, ci_upper: 0.92, threshold: 0.75 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('pass');
    });

    it('returns warn when ci_lower < warn_at but ci_lower >= fail_at (direction=lower_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // ci_lower = 0.77, warn_at = 0.85 → warn (0.77 < 0.85); not fail (0.77 >= 0.75)
      const metrics = {
        answer_correct: { value: 0.77, ci_lower: 0.77, ci_upper: 0.83, threshold: 0.75 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('returns fail when ci_lower < fail_at (direction=lower_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // ci_lower = 0.70, fail_at = 0.75 → fail (0.70 < 0.75)
      const metrics = {
        answer_correct: { value: 0.70, ci_lower: 0.70, ci_upper: 0.78, threshold: 0.75 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail');
    });

    it('returns fail when ci_lower < warn_at AND ci_lower < fail_at simultaneously', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // ci_lower = 0.60, warn_at = 0.85, fail_at = 0.75 → fail wins
      const metrics = {
        answer_correct: { value: 0.60, ci_lower: 0.60, ci_upper: 0.68, threshold: 0.75 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail');
    });

    // -- higher_is_worse direction (e.g. false_handoff_rate) --

    it('returns pass when ci_upper <= warn_at (direction=higher_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.03, warn_at = 0.05 → pass (0.03 <= 0.05)
      const metrics = {
        false_handoff_rate: { value: 0.03, ci_lower: 0.01, ci_upper: 0.03, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('pass');
    });

    it('returns warn when warn_at < ci_upper <= fail_at (direction=higher_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.07, warn_at = 0.05, fail_at = 0.10 → warn (0.07 > 0.05); not fail (0.07 <= 0.10)
      const metrics = {
        false_handoff_rate: { value: 0.07, ci_lower: 0.03, ci_upper: 0.07, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('returns fail when ci_upper > fail_at (direction=higher_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.15, fail_at = 0.10 → fail (0.15 > 0.10)
      const metrics = {
        false_handoff_rate: { value: 0.15, ci_lower: 0.08, ci_upper: 0.15, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail');
    });

    // -- Boundary values --

    it('passes when ci_lower = warn_at exactly (direction=lower_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // ci_lower = 0.85, warn_at = 0.85 → pass (0.85 >= 0.85)
      const metrics = {
        answer_correct: { value: 0.85, ci_lower: 0.85, ci_upper: 0.90, threshold: 0.75 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('pass');
    });

    it('warns when ci_lower just below warn_at (direction=lower_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // ci_lower = 0.84, warn_at = 0.85 → warn (0.84 < 0.85)
      const metrics = {
        answer_correct: { value: 0.84, ci_lower: 0.84, ci_upper: 0.89, threshold: 0.75 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('passes when ci_upper = warn_at exactly (direction=higher_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.05, warn_at = 0.05 → pass (0.05 <= 0.05)
      const metrics = {
        false_handoff_rate: { value: 0.05, ci_lower: 0.02, ci_upper: 0.05, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('pass');
    });

    it('warns when ci_upper just above warn_at (direction=higher_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.06, warn_at = 0.05 → warn (0.06 > 0.05)
      const metrics = {
        false_handoff_rate: { value: 0.06, ci_lower: 0.03, ci_upper: 0.06, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('warns when ci_upper = fail_at exactly (boundary: service treats = as in-warn zone)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.10, fail_at = 0.10, warn_at = 0.05
      // Service uses strict >, so: 0.10 > 0.10 (fail) = false, 0.10 > 0.05 (warn) = true
      // → warn (equality at fail_at boundary is treated as warn zone)
      const metrics = {
        false_handoff_rate: { value: 0.10, ci_lower: 0.05, ci_upper: 0.10, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('warns when warn_at < ci_upper < fail_at (direction=higher_is_worse)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // ci_upper = 0.08: warn_at(0.05) < 0.08 < fail_at(0.10) → warn
      const metrics = {
        false_handoff_rate: { value: 0.08, ci_lower: 0.04, ci_upper: 0.08, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('skips metrics that have no corresponding threshold', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
      ];
      // cite_precision has no threshold → should be skipped (not cause fail/warn)
      const metrics = {
        answer_correct: { value: 0.88, ci_lower: 0.88, ci_upper: 0.92, threshold: 0.75 },
        cite_precision: { value: 0.91, ci_lower: 0.87, ci_upper: 0.95, threshold: 0 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('pass');
    });
  });

  // ========================================================================
  // Test 2 — evaluate: aggregate status is fail if any metric fails
  //
  // Overall status: fail > warn > pass
  // - any metric fails → overall=fail
  // - no fails, any warns → overall=warn
  // - all pass → overall=pass
  // ========================================================================

  describe('evaluate — aggregate status', () => {
    it('overall = fail when one metric fails and all others pass', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
      ];
      // answer_correct: ci_lower=0.88 >= 0.85 → pass
      // cite_precision:  ci_lower=0.68 < 0.70 → fail
      const metrics = {
        answer_correct: { value: 0.88, ci_lower: 0.88, ci_upper: 0.92, threshold: 0.75 },
        cite_precision: { value: 0.68, ci_lower: 0.68, ci_upper: 0.76, threshold: 0.70 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail');
    });

    it('overall = fail when one metric fails and another warns', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
      ];
      // answer_correct: ci_lower=0.77 < 0.85 → warn (>= 0.75 so not fail)
      // cite_precision:  ci_lower=0.68 < 0.70 → fail
      const metrics = {
        answer_correct: { value: 0.77, ci_lower: 0.77, ci_upper: 0.83, threshold: 0.75 },
        cite_precision: { value: 0.68, ci_lower: 0.68, ci_upper: 0.76, threshold: 0.70 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail'); // fail overrides warn
    });

    it('overall = warn when one metric warns and rest pass (no fails)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'recall_at_10', fail_at: 0.80, warn_at: 0.90, direction: 'lower_is_worse' }),
      ];
      // answer_correct: ci_lower=0.88 >= 0.85 → pass
      // cite_precision:  ci_lower=0.79 < 0.80 → warn (>= 0.70 so not fail)
      // recall_at_10:    ci_lower=0.92 >= 0.90 → pass
      const metrics = {
        answer_correct: { value: 0.88, ci_lower: 0.88, ci_upper: 0.92, threshold: 0.75 },
        cite_precision: { value: 0.79, ci_lower: 0.79, ci_upper: 0.85, threshold: 0.70 },
        recall_at_10: { value: 0.92, ci_lower: 0.92, ci_upper: 0.97, threshold: 0.80 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('overall = warn when multiple metrics warn (no fails)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
      ];
      // answer_correct: ci_lower=0.80 < 0.85 → warn
      // cite_precision:  ci_lower=0.75 < 0.80 → warn
      const metrics = {
        answer_correct: { value: 0.80, ci_lower: 0.80, ci_upper: 0.86, threshold: 0.75 },
        cite_precision: { value: 0.75, ci_lower: 0.75, ci_upper: 0.82, threshold: 0.70 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('warn');
    });

    it('overall = pass when all metrics pass', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'recall_at_10', fail_at: 0.80, warn_at: 0.90, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      const metrics = {
        answer_correct: { value: 0.88, ci_lower: 0.88, ci_upper: 0.92, threshold: 0.75 },
        cite_precision: { value: 0.85, ci_lower: 0.85, ci_upper: 0.91, threshold: 0.70 },
        recall_at_10: { value: 0.95, ci_lower: 0.95, ci_upper: 0.98, threshold: 0.80 },
        false_handoff_rate: { value: 0.02, ci_lower: 0.01, ci_upper: 0.03, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('pass');
    });

    it('overall = fail when one metric fails (mixed warn/pass)', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'recall_at_10', fail_at: 0.80, warn_at: 0.90, direction: 'lower_is_worse' }),
      ];
      // answer_correct: ci_lower=0.86 >= 0.85 → pass
      // cite_precision:  ci_lower=0.78 < 0.80 → warn (>= 0.70 so not fail)
      // recall_at_10:   ci_lower=0.79 < 0.80 → fail
      const metrics = {
        answer_correct: { value: 0.86, ci_lower: 0.86, ci_upper: 0.91, threshold: 0.75 },
        cite_precision: { value: 0.78, ci_lower: 0.78, ci_upper: 0.85, threshold: 0.70 },
        recall_at_10: { value: 0.79, ci_lower: 0.79, ci_upper: 0.86, threshold: 0.80 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail');
    });

    it('fail overrides warn — multiple warnings plus one fail → overall fail', () => {
      const thresholds: EvalGateThresholdRow[] = [
        makeThreshold({ metric: 'answer_correct', fail_at: 0.75, warn_at: 0.85, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'cite_precision', fail_at: 0.70, warn_at: 0.80, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'recall_at_10', fail_at: 0.80, warn_at: 0.90, direction: 'lower_is_worse' }),
        makeThreshold({ metric: 'false_handoff_rate', fail_at: 0.10, warn_at: 0.05, direction: 'higher_is_worse' }),
      ];
      // answer_correct: warn (0.83 < 0.85, >= 0.75)
      // cite_precision:  warn (0.79 < 0.80, >= 0.70)
      // recall_at_10:   fail (0.78 < 0.80)
      // false_handoff_rate: pass (0.03 <= 0.05)
      const metrics = {
        answer_correct: { value: 0.83, ci_lower: 0.83, ci_upper: 0.89, threshold: 0.75 },
        cite_precision: { value: 0.79, ci_lower: 0.79, ci_upper: 0.85, threshold: 0.70 },
        recall_at_10: { value: 0.78, ci_lower: 0.78, ci_upper: 0.85, threshold: 0.80 },
        false_handoff_rate: { value: 0.03, ci_lower: 0.01, ci_upper: 0.03, threshold: 0.10 },
      };
      const result = RegressionGateService.evaluate(metrics, thresholds);
      expect(result.status).toBe('fail');
    });
  });

  // ========================================================================
  // Test 3 — Wilson CI bounds are computed correctly
  //
  // wilsonCIstatic() is a PUBLIC STATIC METHOD:
  //   RegressionGateService.wilsonCIstatic(p, n) → { value, ci_lower, ci_upper }
  //
  // Uses z = 1.96 (95% confidence).
  //
  // Known reference values:
  //   p=0.8, n=100  → ci_lower ≈ 0.7115, ci_upper ≈ 0.8670
  //   p=0.8, n=5000 → ci_lower ≈ 0.7897, ci_upper ≈ 0.8103
  //   p=0.5, n=100  → ci_lower ≈ 0.401,  ci_upper ≈ 0.599
  //
  // Manual verification for p=0.8, n=100:
  //   z=1.96, z²=3.8416
  //   denom = 1 + 3.8416/100 = 1.038416
  //   center = 0.8 + 3.8416/200 = 0.819208
  //   sqrt_term = sqrt(0.0016 + 0.00009604) ≈ 0.041185
  //   margin = 1.96 * 0.041185 ≈ 0.08072
  //   ci_lower = (0.819208 - 0.08072) / 1.038416 ≈ 0.7115
  //   ci_upper = (0.819208 + 0.08072) / 1.038416 ≈ 0.8670
  // ========================================================================

  describe('wilsonCIstatic', () => {
    it('returns ci_lower < value < ci_upper for p=0.8, n=100', () => {
      const result = RegressionGateService.wilsonCIstatic(0.8, 100);
      expect(result.value).toBe(0.8);
      expect(result.ci_lower).toBeLessThan(result.value);
      expect(result.value).toBeLessThan(result.ci_upper);
    });

    it('ci_lower ≈ 0.7115 and ci_upper ≈ 0.8670 for p=0.8, n=100 (known reference)', () => {
      const result = RegressionGateService.wilsonCIstatic(0.8, 100);
      expect(result.ci_lower).toBeCloseTo(0.7115, 3);
      expect(result.ci_upper).toBeCloseTo(0.8670, 3);
    });

    it('ci_lower ≈ 0.7887 and ci_upper ≈ 0.8113 for p=0.8, n=5000 (CI narrows with n)', () => {
      const result = RegressionGateService.wilsonCIstatic(0.8, 5000);
      expect(result.ci_lower).toBeCloseTo(0.7887, 3);
      expect(result.ci_upper).toBeCloseTo(0.8113, 3);
    });

    it('CI narrows as n grows (for the same p)', () => {
      const ci100 = RegressionGateService.wilsonCIstatic(0.8, 100);
      const ci5000 = RegressionGateService.wilsonCIstatic(0.8, 5000);
      const width100 = ci100.ci_upper - ci100.ci_lower;
      const width5000 = ci5000.ci_upper - ci5000.ci_lower;
      expect(width5000).toBeLessThan(width100);
    });

    it('returns ci_lower=0, ci_upper=1 when n=0', () => {
      const result = RegressionGateService.wilsonCIstatic(0.5, 0);
      expect(result.value).toBe(0.5);
      expect(result.ci_lower).toBe(0);
      expect(result.ci_upper).toBe(1);
    });

    it('handles extreme p=0 (all failures)', () => {
      const result = RegressionGateService.wilsonCIstatic(0, 20);
      expect(result.value).toBe(0);
      expect(result.ci_lower).toBe(0);
      expect(result.ci_upper).toBeLessThan(0.2);
    });

    it('handles extreme p=1 (all successes)', () => {
      const result = RegressionGateService.wilsonCIstatic(1, 20);
      expect(result.value).toBe(1);
      expect(result.ci_lower).toBeGreaterThan(0.8);
      expect(result.ci_upper).toBeLessThanOrEqual(1);
    });

    it('ci_lower >= 0 for all p,n combinations (never negative)', () => {
      const cases = [
        { p: 0.1, n: 5 },
        { p: 0.2, n: 10 },
        { p: 0.5, n: 50 },
        { p: 0.9, n: 3 },
      ];
      for (const { p, n } of cases) {
        const result = RegressionGateService.wilsonCIstatic(p, n);
        expect(result.ci_lower).toBeGreaterThanOrEqual(0);
      }
    });

    it('ci_upper <= 1 for all p,n combinations (never exceeds 1)', () => {
      const cases = [
        { p: 0.1, n: 5 },
        { p: 0.2, n: 10 },
        { p: 0.5, n: 50 },
        { p: 0.9, n: 3 },
      ];
      for (const { p, n } of cases) {
        const result = RegressionGateService.wilsonCIstatic(p, n);
        expect(result.ci_upper).toBeLessThanOrEqual(1);
      }
    });

    it('handles p=0.5, n=100 (midpoint of CI width curve)', () => {
      const result = RegressionGateService.wilsonCIstatic(0.5, 100);
      expect(result.value).toBe(0.5);
      expect(result.ci_lower).toBeCloseTo(0.404, 3);
      expect(result.ci_upper).toBeCloseTo(0.596, 3);
    });
  });

  // ========================================================================
  // Test 4 — Hard constraint: dataset must be 'golden' status
  //
  // RegressionGateService.HARD_MIN_DATASET_VERSION_STATUS = 'golden'
  // Non-golden dataset → throws error
  // Golden dataset → proceeds (no error thrown)
  //
  // Repository spies are hoisted at module top and reset in beforeEach.
  // Tests configure the mock return values using spy.mockResolvedValue().
  // ========================================================================

  describe('run — dataset status enforcement', () => {
    it('throws when dataset version is null (not found)', async () => {
      // Demo mode (isDemoMode=true) + unknown ID → getVersion returns null
      getVersionSpy.mockResolvedValue(null);
      listTurnsSpy.mockResolvedValue([]);
      thresholdsListSpy.mockResolvedValue([]);

      const service = new RegressionGateService();
      await expect(
        service.run({
          datasetVersionId: 'nonexistent-id',
          candidateConfig: {
            min_score: 0.75,
            rerank_backend: 'mock',
            claim_verifier_threshold: 0.75,
            confidence_gate: 0.40,
          },
          triggeredBy: 'ci',
        }),
      ).rejects.toThrow('Dataset version not found');
    });

    it('throws when dataset version status is "draft" (not golden)', async () => {
      getVersionSpy.mockResolvedValue({
        id: 'version-draft',
        dataset_id: 'ds-1',
        version_number: 1,
        status: 'draft',
        created_by: 'user-1',
        created_at: new Date().toISOString(),
        note: null,
      });
      listTurnsSpy.mockResolvedValue([]);
      thresholdsListSpy.mockResolvedValue([]);

      const service = new RegressionGateService();
      await expect(
        service.run({
          datasetVersionId: 'version-draft',
          candidateConfig: {
            min_score: 0.75,
            rerank_backend: 'mock',
            claim_verifier_threshold: 0.75,
            confidence_gate: 0.40,
          },
          triggeredBy: 'ci',
        }),
      ).rejects.toThrow(/golden/i);
    });

    it('throws when dataset version status is "locked" (not golden)', async () => {
      getVersionSpy.mockResolvedValue({
        id: 'version-locked',
        dataset_id: 'ds-1',
        version_number: 2,
        status: 'locked',
        created_by: 'user-1',
        created_at: new Date().toISOString(),
        note: null,
      });
      listTurnsSpy.mockResolvedValue([]);
      thresholdsListSpy.mockResolvedValue([]);

      const service = new RegressionGateService();
      await expect(
        service.run({
          datasetVersionId: 'version-locked',
          candidateConfig: {
            min_score: 0.75,
            rerank_backend: 'mock',
            claim_verifier_threshold: 0.75,
            confidence_gate: 0.40,
          },
          triggeredBy: 'ci',
        }),
      ).rejects.toThrow(/golden/i);
    });

    it('proceeds without error when dataset version status is "golden"', async () => {
      getVersionSpy.mockResolvedValue({
        id: 'version-golden',
        dataset_id: 'ds-1',
        version_number: 3,
        status: 'golden',
        created_by: 'user-1',
        created_at: new Date().toISOString(),
        note: null,
      });
      listTurnsSpy.mockResolvedValue([]);
      thresholdsListSpy.mockResolvedValue([]);

      const service = new RegressionGateService();
      // Should NOT throw — golden dataset is accepted
      await expect(
        service.run({
          datasetVersionId: 'version-golden',
          candidateConfig: {
            min_score: 0.75,
            rerank_backend: 'mock',
            claim_verifier_threshold: 0.75,
            confidence_gate: 0.40,
          },
          triggeredBy: 'ci',
        }),
      ).resolves.toMatchObject({ status: 'pass' });
    });
  });
});
