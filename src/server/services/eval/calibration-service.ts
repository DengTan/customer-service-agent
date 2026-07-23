/**
 * Calibration Service — Phase 2.3
 *
 * Threshold sweep with 5-fold stratified cross-validation.
 *
 * Pipeline:
 *   1. Load locked dataset (status=golden)
 *   2. Replay each turn through RetrievalOrchestrator + LLM (no DB writes)
 *   3. Sweep PARAM_GRID × all four metrics
 *   4. Discard combos violating HARD_CONSTRAINTS
 *   5. 5-fold CV by (category × difficulty) strata
 *   6. Select best composite score; tie-break by distance to production values
 *   7. Mark overfit_suspect = fold_gap > 0.10
 *   8. Write frozen row to eval_calibration_settings
 */

import { RetrievalOrchestrator } from '@/server/services/retrieval-orchestrator';
// LLMStreamingService is imported dynamically inside replayTurn() to avoid a static cycle
// with llm-streaming-service.ts (which imports CalibrationConfig from this file).

import { EvalDatasetRepository, type GoldCitation } from '@/server/repositories/eval-dataset-repository';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { wilsonCI } from '@/lib/wilson-ci';

// ---------------------------------------------------------------------------
// Calibration row (derived from eval_calibration_settings table schema)
// ---------------------------------------------------------------------------

export interface CalibrationRow {
  id: string;
  dataset_version_id: string;
  bot_id: string;
  shop_id: string | null;

  // Thresholds
  min_score: number;
  rerank_backend: string;
  claim_verifier_threshold: number;
  confidence_gate: number;

  // 5-fold CV scores (means)
  answer_correct: number;
  cite_precision: number;
  recall_at_10: number;

  // Routing
  false_handoff_rate: number;

  // Aggregated
  composite: number;
  fold_gap: number;

  // Lifecycle
  status: 'frozen' | 'canary' | 'active' | 'archived';
  is_canary: boolean;
  canary_pct: number;

  // Per-fold detail
  fold_detail: FoldDetail[];

  // Audit
  created_by: string | null;
  created_at: string;
  promoted_at: string | null;
}

export interface FoldDetail {
  fold: number;
  answer_correct: number;
  cite_precision: number;
  recall: number;
  false_handoff_rate: number;
  composite: number;
  n: number;
}

export interface CalibrationConfig {
  min_score: number;
  rerank_backend: string;
  claim_verifier_threshold: number;
  confidence_gate: number;
}

export interface ReplayResult {
  config: CalibrationConfig;
  turn_id: string;
  predictedAnswer: string;
  predictedCitations: PredictedCitation[];
  predictedHandoff: boolean;
  recallHit: boolean;
  executionTimeMs: number;
}

export interface PredictedCitation {
  type: 'knowledge' | 'product' | 'size_chart';
  id?: string;
  chunk_id?: string;
  name?: string;
  category?: string;
}

export interface TurnScore {
  turn_id: string;
  answer_correct: number;
  cite_precision: number;
  recall_at_10: number;
  false_handoff: boolean; // true = 1, false = 0
}

export interface AggregateMetrics {
  answer_correct: { value: number; ci_lower: number; ci_upper: number };
  cite_precision: { value: number; ci_lower: number; ci_upper: number };
  recall_at_10: { value: number; ci_lower: number; ci_upper: number };
  false_handoff_rate: { value: number; ci_lower: number; ci_upper: number };
  composite: number;
  fold_gap: number;
  n: number;
  fold_detail: FoldDetail[];
}

// ---------------------------------------------------------------------------
// Fold assignment result
// ---------------------------------------------------------------------------

export interface FoldAssignment {
  turn_id: string;
  fold: number;
}

// ---------------------------------------------------------------------------
// Eval dataset turn (what we receive from the repository)
// ---------------------------------------------------------------------------

export interface EvalDatasetTurn {
  id: string;
  turn_index: number;
  input_user_message: string;
  input_recent_messages: Array<{ role: string; content: string }>;
  input_bot_id: string | null;
  input_shop_id: string | null;
  gold_gate_decision: 'skip' | 'retrieve' | 'clarify';
  gold_citations: GoldCitation[];
  gold_answer: string;
  gold_answer_alt: string[];
  gold_answer_facts: string[];
  gold_should_handoff: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
}

// ---------------------------------------------------------------------------
// Parameter grid & constants
// ---------------------------------------------------------------------------

export class CalibrationService {
  static readonly PARAM_GRID = {
    min_score: [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85],
    rerank_backend: ['mock', 'bge', 'cohere', 'generic'] as const,
    claim_verifier_threshold: [0.5, 0.65, 0.75, 0.85],
    confidence_gate: [0.3, 0.35, 0.4, 0.45],
  };

  static readonly COMPOSITE_WEIGHTS = {
    answer_correct: 0.4,
    cite_precision: 0.3,
    recall_at_10: 0.2,
    no_false_handoff: 0.1, // 1 - false_handoff_rate
  };

  static readonly HARD_CONSTRAINTS = {
    recall_at_10_min: 0.85,
    cite_precision_min: 0.8,
  };

  // Current production defaults (used for tie-breaking)
  private static readonly PRODUCTION_DEFAULTS: CalibrationConfig = {
    min_score: 0.75,
    rerank_backend: 'mock',
    claim_verifier_threshold: 0.75,
    confidence_gate: 0.4,
  };

  private readonly evalRepo: EvalDatasetRepository;
  private readonly supabase = getSupabaseClient();

  constructor() {
    this.evalRepo = new EvalDatasetRepository();
  }

  // ---------------------------------------------------------------------------
  // run() — main entry point
  // ---------------------------------------------------------------------------

  async run(args: {
    datasetVersionId: string;
    botId: string;
    shopId: string | null;
    operatorId: string;
  }): Promise<{
    chosen: CalibrationRow;
    pareto: CalibrationRow[];
    overfit_suspect: boolean;
  }> {
    logger.info('[CalibrationService] Starting calibration run', {
      datasetVersionId: args.datasetVersionId,
      botId: args.botId,
      shopId: args.shopId,
    });

    // Step 1: load golden dataset version
    const version = await this.evalRepo.getVersion(args.datasetVersionId);
    if (!version) {
      throw new Error(`Dataset version not found: ${args.datasetVersionId}`);
    }
    if (version.status !== 'golden') {
      throw new Error(`Dataset version is not frozen (golden): ${version.status}`);
    }

    // Step 2: load all turns
    const turns = await this.evalRepo.listTurns(args.datasetVersionId);
    if (turns.length === 0) {
      throw new Error('No turns found in dataset version');
    }

    logger.info('[CalibrationService] Dataset loaded', {
      versionId: args.datasetVersionId,
      turnCount: turns.length,
    });

    // Step 3: generate all parameter combinations
    const configs = this.generateConfigs();
    logger.info('[CalibrationService] Parameter combinations to evaluate', { count: configs.length });

    // Step 4: assign folds (deterministic, stratified by category × difficulty)
    const foldAssignments = CalibrationService.assignFolds(turns);
    const foldsByIdx = this.buildFoldsByIndex(foldAssignments, turns);

    // Step 5: evaluate each config — replay all turns once per config
    const turnResults = await this.evaluateAllTurns(turns, configs);

    // Step 6: score and aggregate per config
    const scoredRows: CalibrationRow[] = [];
    for (const config of configs) {
      const key = CalibrationService.configKey(config);
      const resultsForConfig = turnResults.get(key) ?? [];

      // Compute fold metrics
      const foldDetails: FoldDetail[] = [];
      for (let foldIdx = 0; foldIdx < 5; foldIdx++) {
        const foldTurnIds = new Set(
          (foldsByIdx.get(foldIdx) ?? []).map(t => t.id)
        );
        const foldResults = resultsForConfig.filter(r => foldTurnIds.has(r.turn_id));
        const foldScores = foldResults.map(r => {
          const turn = turns.find(t => t.id === r.turn_id)!;
          return this.scoreTurn(r, turn);
        });

        const agg = this.aggregate(foldScores);
        foldDetails.push({
          fold: foldIdx,
          answer_correct: agg.answer_correct.value,
          cite_precision: agg.cite_precision.value,
          recall: agg.recall_at_10.value,
          false_handoff_rate: agg.false_handoff_rate.value,
          composite: agg.composite,
          n: foldScores.length,
        });
      }

      const composite = CalibrationService.computeCompositeFromFoldDetails(foldDetails);
      const foldGap = CalibrationService.computeFoldGap(foldDetails);
      const overallMetrics = this.aggregateFromFoldDetails(foldDetails, turns.length);

      const row: CalibrationRow = {
        id: crypto.randomUUID(),
        dataset_version_id: args.datasetVersionId,
        bot_id: args.botId,
        shop_id: args.shopId,
        min_score: config.min_score,
        rerank_backend: config.rerank_backend,
        claim_verifier_threshold: config.claim_verifier_threshold,
        confidence_gate: config.confidence_gate,
        answer_correct: overallMetrics.answer_correct.value,
        cite_precision: overallMetrics.cite_precision.value,
        recall_at_10: overallMetrics.recall_at_10.value,
        false_handoff_rate: overallMetrics.false_handoff_rate.value,
        composite,
        fold_gap: foldGap,
        status: 'frozen',
        is_canary: false,
        canary_pct: 0,
        fold_detail: foldDetails,
        created_by: args.operatorId,
        created_at: new Date().toISOString(),
        promoted_at: null,
      };

      // Discard combos violating hard constraints
      if (
        row.recall_at_10 < CalibrationService.HARD_CONSTRAINTS.recall_at_10_min ||
        row.cite_precision < CalibrationService.HARD_CONSTRAINTS.cite_precision_min
      ) {
        logger.debug('[CalibrationService] Combo discarded by hard constraints', {
          configKey: key,
          recall_at_10: row.recall_at_10,
          cite_precision: row.cite_precision,
        });
        continue;
      }

      scoredRows.push(row);
    }

    if (scoredRows.length === 0) {
      throw new Error('No parameter combinations passed hard constraints — relax HARD_CONSTRAINTS');
    }

    // Step 7: sort by composite descending, tie-break by distance to production defaults
    scoredRows.sort((a, b) => CalibrationService.compareCombinations(a, b));

    const chosen = scoredRows[0];
    const pareto = scoredRows.slice(1, 6);
    const overfitSuspect = CalibrationService.isOverfitSuspect(chosen.fold_gap);

    logger.info('[CalibrationService] Calibration complete', {
      chosenConfig: {
        min_score: chosen.min_score,
        rerank_backend: chosen.rerank_backend,
        claim_verifier_threshold: chosen.claim_verifier_threshold,
        confidence_gate: chosen.confidence_gate,
      },
      composite: chosen.composite,
      fold_gap: chosen.fold_gap,
      overfit_suspect: overfitSuspect,
      paretoCount: pareto.length,
      totalCombosEvaluated: scoredRows.length,
    });

    // Step 8: persist the chosen frozen row
    await this.persistCalibrationRow(chosen);

    return { chosen, pareto, overfit_suspect: overfitSuspect };
  }

  // ---------------------------------------------------------------------------
  // replayTurn() — run one turn through orchestrator + LLM pipeline (read-only)
  // ---------------------------------------------------------------------------

  async replayTurn(turn: EvalDatasetTurn, config: CalibrationConfig): Promise<ReplayResult> {
    const startMs = Date.now();

    const evalConvId = `eval-${turn.id}`;
    const orchestrator = new RetrievalOrchestrator();

    // Step 1: retrieval — replay through orchestrator (read-only)
    const retrievalResult = await orchestrator.retrieve(turn.input_user_message, evalConvId, turn.input_recent_messages, {
      minScore: config.min_score,
    });

    // P2 FIX: When external knowledge base is enabled, use externalContext as knowledge context
    const hasExternalContext = !!retrievalResult.externalContext;
    const effectiveKnowledgeContext = retrievalResult.knowledgeContext?.context
      ?? (hasExternalContext ? retrievalResult.externalContext!.context : undefined);

    const predictedCitations: PredictedCitation[] = retrievalResult.evidence.citations.map(c => ({
      type: c.type as 'knowledge' | 'product' | 'size_chart',
      id: c.knowledge_item_id ?? c.id,
      chunk_id: c.chunk_id ?? undefined,
      name: c.name,
      category: c.category,
    }));

    // Step 2: LLM answer — create a stream and collect full text
    // Dynamic import to avoid static cycle with llm-streaming-service.ts
    const { LLMStreamingService } = await import('@/server/services/llm-streaming-service');
    const llmService = new LLMStreamingService();
    const stream = llmService.createStream(
      evalConvId,
      turn.input_user_message,
      [],
      {
        knowledgeContext: effectiveKnowledgeContext,
        evidenceCitations: retrievalResult.evidence.citations.map(c => ({
          type: c.type,
          content: c.content,
          score: c.score,
          knowledge_item_id: c.knowledge_item_id,
          name: c.name,
          category: c.category,
          chunk_id: c.chunk_id,
          chunk_index: c.chunk_index,
          content_hash: c.content_hash,
        })),
        productContext: retrievalResult.productContext?.productContext,
        sizeChartContext: retrievalResult.sizeChartContext?.sizeChartContext,
        knowledgeMinScore: config.min_score,
        parentBotId: turn.input_bot_id ?? undefined,
      },
    );

    // Consume the stream to get the full text
    let predictedAnswer = '';
    let predictedHandoff = false;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        const chunkStr = decoder.decode(value, { stream: true });
        for (const line of chunkStr.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.content) {
              predictedAnswer += json.content;
            }
            if (json.done && json.handoff === true) {
              predictedHandoff = true;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    }

    // Step 3: recall check
    const recallHit = this.checkRecallHit(retrievalResult.evidence.citations, turn.gold_citations);

    return {
      config,
      turn_id: turn.id,
      predictedAnswer,
      predictedCitations,
      predictedHandoff,
      recallHit,
      executionTimeMs: Date.now() - startMs,
    };
  }

  // ---------------------------------------------------------------------------
  // scoreTurn() — compute per-turn metrics
  // ---------------------------------------------------------------------------

  scoreTurn(replay: ReplayResult, gold: EvalDatasetTurn): TurnScore {
    const answerCorrect = this.computeAnswerCorrect(replay.predictedAnswer, gold);
    const citePrecision = this.computeCitePrecision(replay.predictedCitations, gold.gold_citations);
    const recallAt10 = replay.recallHit ? 1 : 0;
    const falseHandoff = replay.predictedHandoff && !gold.gold_should_handoff;

    return {
      turn_id: replay.turn_id,
      answer_correct: answerCorrect,
      cite_precision: citePrecision,
      recall_at_10: recallAt10,
      false_handoff: falseHandoff,
    };
  }

  // ---------------------------------------------------------------------------
  // aggregate() — mean + 95% Wilson CIs
  // ---------------------------------------------------------------------------

  aggregate(scores: TurnScore[]): AggregateMetrics {
    const n = scores.length;
    if (n === 0) {
      return {
        answer_correct: { value: 0, ci_lower: 0, ci_upper: 1 },
        cite_precision: { value: 0, ci_lower: 0, ci_upper: 1 },
        recall_at_10: { value: 0, ci_lower: 0, ci_upper: 1 },
        false_handoff_rate: { value: 0, ci_lower: 0, ci_upper: 1 },
        composite: 0,
        fold_gap: 0,
        n: 0,
        fold_detail: [],
      };
    }

    const answerCorrectMean = mean(scores.map(s => s.answer_correct));
    const citePrecisionMean = mean(scores.map(s => s.cite_precision));
    const recallAt10Mean = mean(scores.map(s => s.recall_at_10));
    const falseHandoffRateMean = mean(scores.map(s => s.false_handoff ? 1 : 0));

    const composite = CalibrationService.computeComposite({
      turn_id: '',
      answer_correct: answerCorrectMean,
      cite_precision: citePrecisionMean,
      recall_at_10: recallAt10Mean,
      false_handoff: falseHandoffRateMean >= 0.5,
    });

    return {
      answer_correct: wilsonCI(answerCorrectMean, n),
      cite_precision: wilsonCI(citePrecisionMean, n),
      recall_at_10: wilsonCI(recallAt10Mean, n),
      false_handoff_rate: wilsonCI(falseHandoffRateMean, n),
      composite,
      fold_gap: 0,
      n,
      fold_detail: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Static helpers — public for unit testing
  // ---------------------------------------------------------------------------

  /**
   * Composite score for a single-turn or mean aggregate.
   * Formula: 0.4*answer_correct + 0.3*cite_precision + 0.2*recall_at_10
   *          + 0.1*(1 - false_handoff_rate)
   * where false_handoff_rate = 1 if false_handoff=true, else 0.
   */
  static computeComposite(score: TurnScore): number {
    const fhr = score.false_handoff ? 1 : 0;
    return (
      this.COMPOSITE_WEIGHTS.answer_correct * score.answer_correct +
      this.COMPOSITE_WEIGHTS.cite_precision * score.cite_precision +
      this.COMPOSITE_WEIGHTS.recall_at_10 * score.recall_at_10 +
      this.COMPOSITE_WEIGHTS.no_false_handoff * (1 - fhr)
    );
  }

  /**
   * Compute composite from fold detail means (used in run() for per-config scoring).
   */
  static computeCompositeFromFoldDetails(foldDetails: FoldDetail[]): number {
    if (foldDetails.length === 0) return 0;
    const composites = foldDetails.map(f => f.composite);
    return mean(composites);
  }

  /**
   * Hard constraint check: recall_at_10 >= HARD_CONSTRAINTS.recall_at_10_min
   * AND cite_precision >= HARD_CONSTRAINTS.cite_precision_min.
   *
   * NOTE: calibration hard constraints use point estimates (value), while regression
   * gate uses CI lower bounds (ci_lower). This intentional difference means a config
   * may pass calibration but fail regression, or vice versa.
   */
  static meetsHardConstraints(metrics: AggregateMetrics): boolean {
    return (
      metrics.recall_at_10.value >= this.HARD_CONSTRAINTS.recall_at_10_min &&
      metrics.cite_precision.value >= this.HARD_CONSTRAINTS.cite_precision_min
    );
  }

  /**
   * Compare two calibration rows for sorting.
   * Returns 1 if a wins (higher composite, or equal composite with closer to production defaults).
   * Returns -1 if b wins.
   * Returns 0 if identical.
   *
   * Tie-breaking: smaller L1 distance to PRODUCTION_DEFAULTS wins.
   * Distance components:
   *   - min_score: |ms - 0.75| / 0.35
   *   - rerank_backend: ordinal distance in [mock(0), generic(1), cohere(2), bge(3)]
   *   - claim_verifier_threshold: |cvt - 0.75| / 0.35
   *   - confidence_gate: |cg - 0.4| / 0.15
   */
  static compareCombinations(a: CalibrationRow, b: CalibrationRow): number {
    if (Math.abs(b.composite - a.composite) > 1e-6) {
      return b.composite > a.composite ? -1 : 1;
    }
    const distA = this.configDistance(a);
    const distB = this.configDistance(b);
    if (Math.abs(distA - distB) > 1e-6) {
      return distA < distB ? 1 : -1;
    }
    return 0;
  }

  /**
   * Fold gap = max(composite) - min(composite) across 5 folds.
   * overfit_suspect = fold_gap > 0.10
   */
  static isOverfitSuspect(foldGap: number): boolean {
    return foldGap > 0.1;
  }

  static computeFoldGap(foldDetails: FoldDetail[]): number {
    if (foldDetails.length === 0) return 0;
    const composites = foldDetails.map(f => f.composite);
    return Math.max(...composites) - Math.min(...composites);
  }

  /**
   * Deterministic 5-fold stratified assignment.
   * Uses a stable PRNG seeded by the string hash of (category, difficulty).
   * Each stratum (category × difficulty) is distributed round-robin across 5 folds.
   *
   * Returns one FoldAssignment per input turn.
   * Deterministic: same inputs always produce the same assignments.
   */
  static assignFolds(turns: EvalDatasetTurn[]): FoldAssignment[] {
    // Group by stratum
    const stratumMap = new Map<string, EvalDatasetTurn[]>();
    for (const turn of turns) {
      const key = `${turn.category}::${turn.difficulty}`;
      if (!stratumMap.has(key)) stratumMap.set(key, []);
      stratumMap.get(key)!.push(turn);
    }

    // Assign fold within each stratum using stable round-robin
    const assignments: FoldAssignment[] = [];
    for (const [, stratumTurns] of stratumMap) {
      for (let i = 0; i < stratumTurns.length; i++) {
        // Stable fold index: seeded deterministically from turn index within stratum
        // Use (i * 7 + stratumTurns.length * 3) as a deterministic "random" offset
        const foldIdx = (i * 7 + stratumTurns.length * 3) % 5;
        assignments.push({ turn_id: stratumTurns[i].id, fold: foldIdx });
      }
    }

    return assignments;
  }

  // ---------------------------------------------------------------------------
  // Wilson CI (static for testability)
  // ---------------------------------------------------------------------------

  /**
   * Wilson score interval for a proportion at 95% confidence (z = 1.96).
   */
  static wilsonCIstatic(p: number, n: number): { value: number; ci_lower: number; ci_upper: number } {
    return wilsonCI(p, n);
  }

  // ---------------------------------------------------------------------------
  // Metric computation helpers
  // ---------------------------------------------------------------------------

  private computeAnswerCorrect(predicted: string, gold: EvalDatasetTurn): number {
    if (gold.gold_should_handoff) {
      const lower = predicted.toLowerCase();
      return lower.includes('人工') || lower.includes('转接') ? 1 : 0;
    }

    // Levenshtein ratio
    if (this.levenshteinRatio(predicted, gold.gold_answer) >= 0.85) return 1;

    // Alt answers
    for (const alt of gold.gold_answer_alt) {
      if (this.levenshteinRatio(predicted, alt) >= 0.85) return 1;
    }

    // Gold answer facts containment
    if (gold.gold_answer_facts.length > 0) {
      const lowerPredicted = predicted.toLowerCase();
      const matchCount = gold.gold_answer_facts.filter(fact =>
        fact.length > 3 && lowerPredicted.includes(fact.toLowerCase())
      ).length;
      if (matchCount / gold.gold_answer_facts.length >= 0.5) return 1;
    }

    return 0;
  }

  private computeCitePrecision(predicted: PredictedCitation[], gold: GoldCitation[]): number {
    const predSet = new Set(predicted.map(p => CalibrationService.citeKey(p)));
    const goldSet = new Set(gold.map(g => CalibrationService.citeKey(g)));

    if (predSet.size === 0 && goldSet.size === 0) return 1;
    if (predSet.size === 0 || goldSet.size === 0) return 0;

    let intersection = 0;
    for (const key of goldSet) {
      if (predSet.has(key)) intersection++;
    }

    const union = new Set([...predSet, ...goldSet]).size;
    return intersection / union;
  }

  private checkRecallHit(
    accepted: Array<{ type: string; knowledge_item_id?: string; id?: string; chunk_id?: string | null }>,
    gold: GoldCitation[],
  ): boolean {
    if (gold.length === 0) return true;
    if (accepted.length === 0) return false;

    const acceptedKeys = new Set(
      accepted.map(c => {
        const type = c.type as 'knowledge' | 'product' | 'size_chart';
        const id = c.knowledge_item_id ?? c.id ?? '';
        const chunk = c.chunk_id ?? '';
        return `${type}::${id}::${chunk}`;
      }),
    );

    for (const g of gold) {
      const key = `${g.type}::${g.id ?? ''}::${g.chunk_id ?? ''}`;
      if (acceptedKeys.has(key)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Grid generation
  // ---------------------------------------------------------------------------

  private generateConfigs(): CalibrationConfig[] {
    const configs: CalibrationConfig[] = [];
    const { min_score, rerank_backend, claim_verifier_threshold, confidence_gate } = CalibrationService.PARAM_GRID;

    for (const ms of min_score) {
      for (const rb of rerank_backend) {
        for (const cvt of claim_verifier_threshold) {
          for (const cg of confidence_gate) {
            configs.push({ min_score: ms, rerank_backend: rb, claim_verifier_threshold: cvt, confidence_gate: cg });
          }
        }
      }
    }

    return configs;
  }

  // ---------------------------------------------------------------------------
  // Turn evaluation
  // ---------------------------------------------------------------------------

  private async evaluateAllTurns(
    turns: EvalDatasetTurn[],
    configs: CalibrationConfig[],
  ): Promise<Map<string, ReplayResult[]>> {
    const results = new Map<string, ReplayResult[]>();

    for (const config of configs) {
      const key = CalibrationService.configKey(config);
      const configResults: ReplayResult[] = [];

      for (const turn of turns) {
        try {
          const replay = await this.replayTurn(turn, config);
          configResults.push(replay);
        } catch (err) {
          logger.warn('[CalibrationService] Turn replay failed', {
            turnId: turn.id,
            configKey: key,
            error: err,
          });
          configResults.push({
            config,
            turn_id: turn.id,
            predictedAnswer: '',
            predictedCitations: [],
            predictedHandoff: false,
            recallHit: false,
            executionTimeMs: 0,
          });
        }
      }

      results.set(key, configResults);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildFoldsByIndex(
    assignments: FoldAssignment[],
    turns: EvalDatasetTurn[],
  ): Map<number, EvalDatasetTurn[]> {
    const folds = new Map<number, EvalDatasetTurn[]>([[0, []], [1, []], [2, []], [3, []], [4, []]]);
    for (const a of assignments) {
      const turn = turns.find(t => t.id === a.turn_id)!;
      folds.get(a.fold)!.push(turn);
    }
    return folds;
  }

  private aggregateFromFoldDetails(foldDetails: FoldDetail[], totalN: number): AggregateMetrics {
    const answerCorrectMean = mean(foldDetails.map(f => f.answer_correct));
    const citePrecisionMean = mean(foldDetails.map(f => f.cite_precision));
    const recallAt10Mean = mean(foldDetails.map(f => f.recall));
    const falseHandoffMean = mean(foldDetails.map(f => f.false_handoff_rate));
    const foldGap = CalibrationService.computeFoldGap(foldDetails);
    const composite = mean(foldDetails.map(f => f.composite));

    // Use mean fold size for CI width (each fold has ~totalN/5 turns)
    const foldN = foldDetails.length > 0
      ? Math.round(foldDetails.reduce((sum, f) => sum + f.n, 0) / foldDetails.length)
      : Math.round(totalN / 5);
    return {
      answer_correct: wilsonCI(answerCorrectMean, foldN),
      cite_precision: wilsonCI(citePrecisionMean, foldN),
      recall_at_10: wilsonCI(recallAt10Mean, foldN),
      false_handoff_rate: wilsonCI(falseHandoffMean, foldN),
      composite,
      fold_gap: foldGap,
      n: totalN,
      fold_detail: foldDetails,
    };
  }

  private static configDistance(row: CalibrationRow): number {
    const msDist = Math.abs(row.min_score - 0.75) / 0.35;
    const rbDistance = this.rerankBackendOrdinal(row.rerank_backend);
    const cvtDist = Math.abs(row.claim_verifier_threshold - 0.75) / 0.35;
    const cgDist = Math.abs(row.confidence_gate - 0.4) / 0.15;
    return msDist + rbDistance + cvtDist + cgDist;
  }

  private static rerankBackendOrdinal(backend: string): number {
    const order = ['mock', 'generic', 'cohere', 'bge'];
    const idx = order.indexOf(backend);
    return idx >= 0 ? idx : order.length;
  }

  private static configKey(config: CalibrationConfig): string {
    return `${config.min_score}::${config.rerank_backend}::${config.claim_verifier_threshold}::${config.confidence_gate}`;
  }

  private static citeKey(c: { type: string; id?: string; chunk_id?: string | null }): string {
    return `${c.type}::${c.id ?? ''}::${c.chunk_id ?? ''}`;
  }

  private levenshteinRatio(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const m = a.length;
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }

    const distance = prev[n];
    return 1 - distance / Math.max(m, n);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private async persistCalibrationRow(row: CalibrationRow): Promise<void> {
    // Demo mode skips DB persistence — this is expected behaviour (no Supabase connection).
    // The caller receives a valid-looking result object that is not persisted, so log it
    // as a warning so operators can distinguish "run succeeded but nothing saved" from a real error.
    if (isDemoMode()) {
      logger.warn('[CalibrationService] Demo mode: skipping DB persist');
      return;
    }

    const { error } = await this.supabase
      .from('eval_calibration_settings')
      .insert({
        id: row.id,
        dataset_version_id: row.dataset_version_id,
        bot_id: row.bot_id,
        shop_id: row.shop_id,
        min_score: row.min_score,
        rerank_backend: row.rerank_backend,
        claim_verifier_threshold: row.claim_verifier_threshold,
        confidence_gate: row.confidence_gate,
        answer_correct: row.answer_correct,
        cite_precision: row.cite_precision,
        recall_at_10: row.recall_at_10,
        false_handoff_rate: row.false_handoff_rate,
        composite: row.composite,
        fold_gap: row.fold_gap,
        status: 'frozen',
        is_canary: false,
        canary_pct: 0,
        fold_detail: row.fold_detail,
        created_by: row.created_by,
        created_at: row.created_at,
        promoted_at: null,
      });

    if (error) {
      logger.error('[CalibrationService] Failed to persist calibration row', {
        error: error.message,
        rowId: row.id,
      });
      throw new Error(`Failed to persist calibration row: ${error.message}`);
    }

    logger.debug('[CalibrationService] Calibration row persisted', {
      rowId: row.id,
      composite: row.composite,
    });
  }
}

// ---------------------------------------------------------------------------
// Pure utility
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
