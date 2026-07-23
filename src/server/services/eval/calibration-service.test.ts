/**
 * CalibrationService Unit Tests
 *
 * Tests cover:
 * 1. Composite formula: 0.4*answer_correct + 0.3*cite_precision
 *    + 0.2*recall_at_10 + 0.1*(1 - false_handoff_rate)
 * 2. Hard constraints drop combinations correctly (recall_at_10 >= 0.85, cite_precision >= 0.80)
 * 3. Tie-breaking prefers smaller distance to current production values
 *    (min_score first, then rerank_backend preference order)
 * 4. overfit_suspect triggers when fold-gap > 0.10
 * 5. 5-fold assignment is deterministic (stratified round-robin)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock supabase-client — isDemoMode() = false so real code paths are exercised
// ---------------------------------------------------------------------------
vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: vi.fn(),
  })),
  isDemoMode: () => false,
}));

// ---------------------------------------------------------------------------
// Mock the logger
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
// Mock RetrievalOrchestrator and LLMStreamingService
// ---------------------------------------------------------------------------
vi.mock('@/server/services/retrieval-orchestrator', () => ({
  RetrievalOrchestrator: vi.fn().mockImplementation(() => ({
    retrieve: vi.fn().mockResolvedValue({
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
    }),
  })),
}));

vi.mock('@/server/services/llm-streaming-service', () => ({
  LLMStreamingService: vi.fn().mockImplementation(() => ({
    createStream: vi.fn().mockReturnValue({
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"content":"test reply"}\n\n') })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"done":true}\n\n') })
          .mockResolvedValueOnce({ done: true }),
      }),
    }),
  })),
}));

vi.mock('@/server/services/knowledge-search-service', () => ({
  KnowledgeSearchService: vi.fn().mockImplementation(() => ({
    search: vi.fn().mockResolvedValue({ sources: [] }),
  })),
}));

// ---------------------------------------------------------------------------
// Import after all mocks are registered
// ---------------------------------------------------------------------------
import { CalibrationService } from './calibration-service';
import type { AggregateMetrics, CalibrationRow, TurnScore, EvalDatasetTurn } from './calibration-service';

// ---------------------------------------------------------------------------
// Helper: build a minimal CalibrationRow for use in test data
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<CalibrationRow> & {
  min_score: number;
  rerank_backend: string;
  cite_precision: number;
  recall_at_10: number;
  false_handoff_rate: number;
  composite: number;
  fold_gap: number;
}): CalibrationRow {
  const defaults: CalibrationRow = {
    id: 'row-test',
    dataset_version_id: 'ver-test',
    bot_id: 'bot-test',
    shop_id: null,
    min_score: 0.75,
    rerank_backend: 'mock',
    claim_verifier_threshold: 0.75,
    confidence_gate: 0.40,
    answer_correct: 0.80,
    cite_precision: 0.80,
    recall_at_10: 0.85,
    false_handoff_rate: 0.05,
    composite: 0.80,
    fold_gap: 0.05,
    status: 'frozen',
    is_canary: false,
    canary_pct: 0,
    fold_detail: [],
    created_by: null,
    created_at: new Date().toISOString(),
    promoted_at: null,
  };
  return { ...defaults, ...overrides };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal TurnScore for use in test data
// ---------------------------------------------------------------------------
function makeScore(overrides: Partial<TurnScore> & { turn_id: string }): TurnScore {
  return {
    answer_correct: 1,
    cite_precision: 1,
    recall_at_10: 1,
    false_handoff: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal AggregateMetrics for test data
// ---------------------------------------------------------------------------
function makeAggregateMetrics(overrides: Partial<AggregateMetrics>): AggregateMetrics {
  return {
    answer_correct: { value: 0.80, ci_lower: 0.70, ci_upper: 0.88 },
    cite_precision: { value: 0.80, ci_lower: 0.70, ci_upper: 0.88 },
    recall_at_10: { value: 0.85, ci_lower: 0.76, ci_upper: 0.91 },
    false_handoff_rate: { value: 0.05, ci_lower: 0.01, ci_upper: 0.15 },
    composite: 0.80,
    fold_gap: 0.05,
    n: 100,
    fold_detail: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('CalibrationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Test 1 — Composite formula matches the spec table
  // COMPOSITE_WEIGHTS = { answer_correct: 0.4, cite_precision: 0.3,
  //                       recall_at_10: 0.2, no_false_handoff: 0.1 }
  // Formula: 0.4*answer_correct + 0.3*cite_precision + 0.2*recall_at_10
  //          + 0.1*(1 - false_handoff_rate)
  // ========================================================================

  describe('computeComposite', () => {
    it('returns 1.0 when all four metrics are perfect', () => {
      const score = makeScore({ turn_id: 'perfect', answer_correct: 1, cite_precision: 1, recall_at_10: 1, false_handoff: false });
      expect(CalibrationService.computeComposite(score)).toBeCloseTo(1.0, 6);
    });

    it('returns 0.0 when all four metrics are worst', () => {
      const score = makeScore({ turn_id: 'worst', answer_correct: 0, cite_precision: 0, recall_at_10: 0, false_handoff: true });
      // 0.4*0 + 0.3*0 + 0.2*0 + 0.1*(1-1) = 0
      expect(CalibrationService.computeComposite(score)).toBeCloseTo(0.0, 6);
    });

    it('formula: 0.4*0.9 + 0.3*0.8 + 0.2*1.0 + 0.1*(1-1) = 0.80', () => {
      const score = makeScore({ turn_id: 'mixed', answer_correct: 0.9, cite_precision: 0.8, recall_at_10: 1.0, false_handoff: true });
      // 0.4*0.9 = 0.36
      // 0.3*0.8 = 0.24
      // 0.2*1.0 = 0.20
      // 0.1*(1-1) = 0.00
      // Total = 0.80
      expect(CalibrationService.computeComposite(score)).toBeCloseTo(0.80, 6);
    });

    it('formula: 0.4*0.85 + 0.3*0.90 + 0.2*0.95 + 0.1*(1-0) = 0.90', () => {
      const score = makeScore({ turn_id: 'mixed2', answer_correct: 0.85, cite_precision: 0.90, recall_at_10: 0.95, false_handoff: false });
      // 0.4*0.85 = 0.34
      // 0.3*0.90 = 0.27
      // 0.2*0.95 = 0.19
      // 0.1*(1-0) = 0.10
      // Total = 0.90
      expect(CalibrationService.computeComposite(score)).toBeCloseTo(0.90, 6);
    });

    it('false_handoff=false contributes 0.1, false_handoff=true contributes 0.0', () => {
      const noFalse = CalibrationService.computeComposite(makeScore({ turn_id: 'a', answer_correct: 0, cite_precision: 0, recall_at_10: 0, false_handoff: false }));
      const withFalse = CalibrationService.computeComposite(makeScore({ turn_id: 'b', answer_correct: 0, cite_precision: 0, recall_at_10: 0, false_handoff: true }));
      expect(noFalse - withFalse).toBeCloseTo(0.1, 6);
    });
  });

  // ========================================================================
  // Test 2 — Hard constraints drop combinations correctly
  // HARD_CONSTRAINTS = { recall_at_10_min: 0.85, cite_precision_min: 0.80 }
  // Combinations where recall_at_10 < 0.85 OR cite_precision < 0.80 are dropped
  // ========================================================================

  describe('meetsHardConstraints', () => {
    it('passes when both recall_at_10=0.85 and cite_precision=0.80 (boundary)', () => {
      const metrics = makeAggregateMetrics({
        recall_at_10: { value: 0.85, ci_lower: 0.75, ci_upper: 0.92 },
        cite_precision: { value: 0.80, ci_lower: 0.70, ci_upper: 0.88 },
      });
      expect(CalibrationService.meetsHardConstraints(metrics)).toBe(true);
    });

    it('passes when both constraints are satisfied well above minimum', () => {
      const metrics = makeAggregateMetrics({
        recall_at_10: { value: 0.92, ci_lower: 0.84, ci_upper: 0.97 },
        cite_precision: { value: 0.88, ci_lower: 0.80, ci_upper: 0.93 },
      });
      expect(CalibrationService.meetsHardConstraints(metrics)).toBe(true);
    });

    it('drops when recall_at_10=0.80 (< 0.85)', () => {
      const metrics = makeAggregateMetrics({
        recall_at_10: { value: 0.80, ci_lower: 0.72, ci_upper: 0.86 },
        cite_precision: { value: 0.90, ci_lower: 0.82, ci_upper: 0.95 },
      });
      expect(CalibrationService.meetsHardConstraints(metrics)).toBe(false);
    });

    it('drops when cite_precision=0.75 (< 0.80)', () => {
      const metrics = makeAggregateMetrics({
        recall_at_10: { value: 0.88, ci_lower: 0.80, ci_upper: 0.93 },
        cite_precision: { value: 0.75, ci_lower: 0.66, ci_upper: 0.82 },
      });
      expect(CalibrationService.meetsHardConstraints(metrics)).toBe(false);
    });

    it('drops when both constraints are violated simultaneously', () => {
      const metrics = makeAggregateMetrics({
        recall_at_10: { value: 0.78, ci_lower: 0.68, ci_upper: 0.85 },
        cite_precision: { value: 0.70, ci_lower: 0.60, ci_upper: 0.78 },
      });
      expect(CalibrationService.meetsHardConstraints(metrics)).toBe(false);
    });

    it('drops when recall_at_10=0.84 (just below threshold)', () => {
      const metrics = makeAggregateMetrics({
        recall_at_10: { value: 0.84, ci_lower: 0.76, ci_upper: 0.90 },
        cite_precision: { value: 0.82, ci_lower: 0.74, ci_upper: 0.88 },
      });
      expect(CalibrationService.meetsHardConstraints(metrics)).toBe(false);
    });
  });

  // ========================================================================
  // Test 3 — Tie-breaking prefers smaller distance
  // Tiebreaker: L1 distance to production defaults
  // rerank_backend preference: mock < generic < cohere < bge (lower ordinal wins)
  // ========================================================================

  describe('compareCombinations', () => {
    it('returns 1 (a wins) when a has higher composite', () => {
      const a = makeRow({ min_score: 0.75, rerank_backend: 'bge', composite: 0.88, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.75, rerank_backend: 'bge', composite: 0.85, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      expect(CalibrationService.compareCombinations(a, b)).toBe(1);
    });

    it('returns -1 (b wins) when b has higher composite', () => {
      const a = makeRow({ min_score: 0.75, rerank_backend: 'bge', composite: 0.85, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.75, rerank_backend: 'bge', composite: 0.88, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      expect(CalibrationService.compareCombinations(a, b)).toBe(-1);
    });

    it('tie-break: smaller min_score distance wins (a is closer to production)', () => {
      // Production: min_score=0.75, rerank_backend=mock
      const a = makeRow({ min_score: 0.75, rerank_backend: 'mock', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.80, rerank_backend: 'mock', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      // Both composite=0.86, tie → a wins (smaller min_score distance)
      expect(CalibrationService.compareCombinations(a, b)).toBe(1);
    });

    it('tie-break: rerank_backend preference — mock wins over bge', () => {
      const a = makeRow({ min_score: 0.75, rerank_backend: 'mock', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.75, rerank_backend: 'bge', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      // mock ordinal(0) < bge ordinal(3) → a wins
      expect(CalibrationService.compareCombinations(a, b)).toBe(1);
    });

    it('tie-break: generic wins over cohere', () => {
      const a = makeRow({ min_score: 0.75, rerank_backend: 'generic', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.75, rerank_backend: 'cohere', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      expect(CalibrationService.compareCombinations(a, b)).toBe(1);
    });

    it('tie-break: mock wins over generic', () => {
      const a = makeRow({ min_score: 0.75, rerank_backend: 'mock', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.75, rerank_backend: 'generic', composite: 0.86, cite_precision: 0.80, recall_at_10: 0.85, false_handoff_rate: 0.05, fold_gap: 0.05 });
      expect(CalibrationService.compareCombinations(a, b)).toBe(1);
    });

    it('returns 0 when both combinations are identical', () => {
      const a = makeRow({ min_score: 0.75, rerank_backend: 'mock', composite: 0.86, cite_precision: 0.82, recall_at_10: 0.87, false_handoff_rate: 0.05, fold_gap: 0.05 });
      const b = makeRow({ min_score: 0.75, rerank_backend: 'mock', composite: 0.86, cite_precision: 0.82, recall_at_10: 0.87, false_handoff_rate: 0.05, fold_gap: 0.05 });
      expect(CalibrationService.compareCombinations(a, b)).toBe(0);
    });
  });

  // ========================================================================
  // Test 4 — overfit_suspect triggers when fold-gap > 0.10
  // fold_gap = max(fold.composite) - min(fold.composite)
  // ========================================================================

  describe('isOverfitSuspect', () => {
    it('returns false when fold_gap=0.00 (perfectly consistent)', () => {
      expect(CalibrationService.isOverfitSuspect(0.00)).toBe(false);
    });

    it('returns false when fold_gap=0.05', () => {
      expect(CalibrationService.isOverfitSuspect(0.05)).toBe(false);
    });

    it('returns false when fold_gap=0.08 (below threshold)', () => {
      expect(CalibrationService.isOverfitSuspect(0.08)).toBe(false);
    });

    it('returns false when fold_gap=0.10 (exactly at threshold — not over)', () => {
      expect(CalibrationService.isOverfitSuspect(0.10)).toBe(false);
    });

    it('returns true when fold_gap=0.11 (just above threshold)', () => {
      expect(CalibrationService.isOverfitSuspect(0.11)).toBe(true);
    });

    it('returns true when fold_gap=0.12', () => {
      expect(CalibrationService.isOverfitSuspect(0.12)).toBe(true);
    });

    it('returns true when fold_gap=0.20 (severe overfit)', () => {
      expect(CalibrationService.isOverfitSuspect(0.20)).toBe(true);
    });

    it('boundary: 0.0999 is not suspect, 0.1001 is suspect', () => {
      expect(CalibrationService.isOverfitSuspect(0.0999)).toBe(false);
      expect(CalibrationService.isOverfitSuspect(0.1001)).toBe(true);
    });
  });

  // ========================================================================
  // Test 5 — 5-fold assignment is deterministic (stratified round-robin)
  // ========================================================================

  describe('assignFolds', () => {
    it('same input always produces the same fold assignments', () => {
      const turns: EvalDatasetTurn[] = Array.from({ length: 50 }, (_, i) => ({
        id: `turn-${i}`,
        turn_index: i,
        input_user_message: '',
        input_recent_messages: [],
        input_bot_id: null,
        input_shop_id: null,
        gold_gate_decision: 'retrieve' as const,
        gold_citations: [],
        gold_answer: '',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_should_handoff: false,
        difficulty: 'easy' as const,
        category: ['refund', 'logistics', 'size', 'product', 'policy', 'chitchat', 'other'][i % 7],
      }));

      const folds1 = CalibrationService.assignFolds(turns);
      const folds2 = CalibrationService.assignFolds(turns);
      expect(folds1).toEqual(folds2);
    });

    it('fold assignments are stable across 3 consecutive calls', () => {
      const turns: EvalDatasetTurn[] = Array.from({ length: 100 }, (_, i) => ({
        id: `turn-${i}`,
        turn_index: i,
        input_user_message: '',
        input_recent_messages: [],
        input_bot_id: null,
        input_shop_id: null,
        gold_gate_decision: 'retrieve' as const,
        gold_citations: [],
        gold_answer: '',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_should_handoff: false,
        difficulty: 'easy' as const,
        category: i % 2 === 0 ? 'refund' : 'logistics',
      }));

      const folds1 = CalibrationService.assignFolds(turns);
      const folds2 = CalibrationService.assignFolds(turns);
      const folds3 = CalibrationService.assignFolds(turns);
      expect(folds1).toEqual(folds2);
      expect(folds2).toEqual(folds3);
    });

    it('each fold has roughly equal size (stratified — every category appears in each fold)', () => {
      const turns: EvalDatasetTurn[] = Array.from({ length: 70 }, (_, i) => ({
        id: `turn-${i}`,
        turn_index: i,
        input_user_message: '',
        input_recent_messages: [],
        input_bot_id: null,
        input_shop_id: null,
        gold_gate_decision: 'retrieve' as const,
        gold_citations: [],
        gold_answer: '',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_should_handoff: false,
        difficulty: 'easy' as const,
        category: ['refund', 'logistics', 'size'][i % 3],
      }));

      const folds = CalibrationService.assignFolds(turns);

      const foldCounts: Record<number, number> = {};
      for (const assignment of folds) {
        foldCounts[assignment.fold] = (foldCounts[assignment.fold] ?? 0) + 1;
      }

      expect(Object.keys(foldCounts).map(Number).sort()).toEqual([0, 1, 2, 3, 4]);

      // Each fold should have roughly equal size: 70/5 = 14, allow ±3 deviation
      for (const fold of [0, 1, 2, 3, 4]) {
        const count = foldCounts[fold] ?? 0;
        expect(count).toBeGreaterThanOrEqual(11);
        expect(count).toBeLessThanOrEqual(17);
      }
    });

    it('stratified: each category appears in each fold', () => {
      const categories = ['refund', 'logistics', 'size', 'product', 'policy'];
      const turns: EvalDatasetTurn[] = Array.from({ length: 50 }, (_, i) => ({
        id: `turn-${i}`,
        turn_index: i,
        input_user_message: '',
        input_recent_messages: [],
        input_bot_id: null,
        input_shop_id: null,
        gold_gate_decision: 'retrieve' as const,
        gold_citations: [],
        gold_answer: '',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_should_handoff: false,
        difficulty: 'easy' as const,
        category: categories[i % categories.length],
      }));

      const folds = CalibrationService.assignFolds(turns);
      const turnCategoryMap = new Map(turns.map(t => [t.id, t.category]));

      for (const fold of [0, 1, 2, 3, 4]) {
        const foldCategories = new Set(
          folds
            .filter(f => f.fold === fold)
            .map(f => turnCategoryMap.get(f.turn_id) ?? 'unknown'),
        );
        for (const cat of categories) {
          expect(foldCategories.has(cat)).toBe(true);
        }
      }
    });

    it('different inputs produce different fold assignments', () => {
      const makeTurns = (prefix: string): EvalDatasetTurn[] =>
        Array.from({ length: 20 }, (_, i) => ({
          id: `${prefix}-turn-${i}`,
          turn_index: i,
          input_user_message: '',
          input_recent_messages: [],
          input_bot_id: null,
          input_shop_id: null,
          gold_gate_decision: 'retrieve' as const,
          gold_citations: [],
          gold_answer: '',
          gold_answer_alt: [],
          gold_answer_facts: [],
          gold_should_handoff: false,
          difficulty: 'easy' as const,
          category: 'refund',
        }));

      const foldsA = CalibrationService.assignFolds(makeTurns('a'));
      const foldsB = CalibrationService.assignFolds(makeTurns('b'));

      const idsA = foldsA.map(f => `${f.turn_id}-${f.fold}`).sort();
      const idsB = foldsB.map(f => `${f.turn_id}-${f.fold}`).sort();
      expect(idsA).not.toEqual(idsB);
    });

    it('produces exactly one fold assignment per input turn', () => {
      const turns: EvalDatasetTurn[] = Array.from({ length: 35 }, (_, i) => ({
        id: `turn-${i}`,
        turn_index: i,
        input_user_message: '',
        input_recent_messages: [],
        input_bot_id: null,
        input_shop_id: null,
        gold_gate_decision: 'retrieve' as const,
        gold_citations: [],
        gold_answer: '',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_should_handoff: false,
        difficulty: 'easy' as const,
        category: 'refund',
      }));

      const folds = CalibrationService.assignFolds(turns);
      expect(folds).toHaveLength(35);
      const assignedIds = new Set(folds.map(f => f.turn_id));
      expect(assignedIds.size).toBe(35);
    });

    it('empty array returns empty array', () => {
      const folds = CalibrationService.assignFolds([]);
      expect(folds).toHaveLength(0);
    });

    it('single turn gets a valid fold 0-4', () => {
      const turns: EvalDatasetTurn[] = [{ id: 'solo-turn', turn_index: 0, input_user_message: '', input_recent_messages: [], input_bot_id: null, input_shop_id: null, gold_gate_decision: 'retrieve' as const, gold_citations: [], gold_answer: '', gold_answer_alt: [], gold_answer_facts: [], gold_should_handoff: false, difficulty: 'easy' as const, category: 'refund' }];
      const folds = CalibrationService.assignFolds(turns);
      expect(folds).toHaveLength(1);
      expect([0, 1, 2, 3, 4]).toContain(folds[0].fold);
    });

    it('fold values are always 0-4 (5 folds)', () => {
      const turns: EvalDatasetTurn[] = Array.from({ length: 200 }, (_, i) => ({
        id: `turn-${i}`,
        turn_index: i,
        input_user_message: '',
        input_recent_messages: [],
        input_bot_id: null,
        input_shop_id: null,
        gold_gate_decision: 'retrieve' as const,
        gold_citations: [],
        gold_answer: '',
        gold_answer_alt: [],
        gold_answer_facts: [],
        gold_should_handoff: false,
        difficulty: 'easy' as const,
        category: ['refund', 'logistics', 'size', 'product'][i % 4],
      }));

      const folds = CalibrationService.assignFolds(turns);
      for (const assignment of folds) {
        expect([0, 1, 2, 3, 4]).toContain(assignment.fold);
      }
    });
  });

  // ========================================================================
  // Test 6 — Wilson CI formula
  // ========================================================================

  describe('wilsonCIstatic', () => {
    it('returns {value:0, ci_lower:0, ci_upper:1} when n=0', () => {
      const result = CalibrationService.wilsonCIstatic(0.5, 0);
      expect(result.value).toBe(0.5);
      expect(result.ci_lower).toBe(0);
      expect(result.ci_upper).toBe(1);
    });

    it('gives CI_lower < value < CI_upper for p=0.5, n=100', () => {
      const result = CalibrationService.wilsonCIstatic(0.5, 100);
      expect(result.ci_lower).toBeLessThan(result.value);
      expect(result.value).toBeLessThan(result.ci_upper);
    });

    it('CI narrows as n grows (for the same p)', () => {
      const ci10 = CalibrationService.wilsonCIstatic(0.8, 10);
      const ci100 = CalibrationService.wilsonCIstatic(0.8, 100);
      const width10 = ci10.ci_upper - ci10.ci_lower;
      const width100 = ci100.ci_upper - ci100.ci_lower;
      expect(width100).toBeLessThan(width10);
    });

    it('handles extreme p=0 (all failures)', () => {
      const result = CalibrationService.wilsonCIstatic(0, 20);
      expect(result.value).toBe(0);
      expect(result.ci_lower).toBe(0);
      expect(result.ci_upper).toBeLessThan(0.2);
    });

    it('handles extreme p=1 (all successes)', () => {
      const result = CalibrationService.wilsonCIstatic(1, 20);
      expect(result.value).toBe(1);
      expect(result.ci_lower).toBeGreaterThan(0.8);
      expect(result.ci_upper).toBeLessThanOrEqual(1);
    });
  });
});
