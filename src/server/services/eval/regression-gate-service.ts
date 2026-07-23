/**
 * Regression Gate Service — Phase 4.4
 *
 * CI regression gate: replays the locked dataset against the candidate config,
 * compares metrics against thresholds from eval_gate_thresholds, and returns
 * pass | warn | fail with exit codes 0 / 1 / 2.
 *
 * Pipeline:
 *   1. Load locked dataset (status=golden)
 *   2. Load thresholds from eval_gate_thresholds
 *   3. Replay all turns via CalibrationService.replayTurn()
 *   4. Aggregate metrics with Wilson CIs
 *   5. Evaluate each metric against thresholds (fail first, then warn)
 *   6. Persist eval_regression_runs row
 *   7. Return structured result
 */

import { CalibrationService } from '@/server/services/eval/calibration-service';
import type { CalibrationConfig, EvalDatasetTurn, TurnScore } from '@/server/services/eval/calibration-service';
import { EvalDatasetRepository } from '@/server/repositories/eval-dataset-repository';
import { EvalGateThresholdsRepository } from '@/server/repositories/eval-gate-thresholds-repository';
import { EvalRegressionRepository } from '@/server/repositories/eval-regression-repository';
import { isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { wilsonCI } from '@/lib/wilson-ci';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface RegressionRunResult {
  id?: string;
  status: 'pass' | 'warn' | 'fail';
  details: ThresholdDetail[];
  datasetVersionId: string;
  runKind: 'ci' | 'continuous' | 'manual';
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface ThresholdDetail {
  metric: string;
  status: 'pass' | 'warn' | 'fail';
  value: number;
  ci_lower: number;
  ci_upper: number;
  threshold: number;
}

// ---------------------------------------------------------------------------
// RegressionGateService
// ---------------------------------------------------------------------------

export class RegressionGateService {
  /** The only dataset version status accepted by the regression gate. */
  static readonly HARD_MIN_DATASET_VERSION_STATUS = 'golden';

  private readonly evalRepo = new EvalDatasetRepository();
  private readonly thresholdsRepo = new EvalGateThresholdsRepository();
  private readonly regressionRepo = new EvalRegressionRepository();
  private readonly calibrationService = new CalibrationService();

  /**
   * Run the regression gate.
   *
   * @param args.datasetVersionId     Locked (golden) dataset version ID
   * @param args.candidateConfig     Candidate calibration config to evaluate
   * @param args.triggeredBy          'ci' | 'continuous' | 'manual'
   * @param args.triggeredByUserId    Operator user ID (optional)
   */
  async run(args: {
    datasetVersionId: string;
    candidateConfig: CalibrationConfig;
    triggeredBy: 'ci' | 'continuous' | 'manual';
    triggeredByUserId?: string;
  }): Promise<RegressionRunResult> {
    const startedAt = new Date().toISOString();

    logger.info('[RegressionGateService] Starting regression gate', {
      datasetVersionId: args.datasetVersionId,
      triggeredBy: args.triggeredBy,
      candidateConfig: args.candidateConfig,
    });

    // Step 1: load golden dataset
    const version = await this.evalRepo.getVersion(args.datasetVersionId);
    if (!version) {
      throw new Error(`Dataset version not found: ${args.datasetVersionId}`);
    }
    if (version.status !== RegressionGateService.HARD_MIN_DATASET_VERSION_STATUS) {
      throw new Error(
        `Dataset version must have status=golden, got=${version.status}`,
      );
    }

    const turns = await this.evalRepo.listTurns(args.datasetVersionId);

    logger.info('[RegressionGateService] Dataset loaded', {
      versionId: args.datasetVersionId,
      turnCount: turns.length,
    });

    // Step 2: load thresholds
    const thresholds = await this.thresholdsRepo.list();

    // Step 3: replay all turns and score
    const turnScores = await this.replayAndScore(turns, args.candidateConfig);

    // Step 4: aggregate metrics with Wilson CIs
    const metrics = this.aggregateMetrics(turnScores);

    // Step 5: evaluate against thresholds (static method, exercised directly in tests)
    const { status, details } = RegressionGateService.evaluate(metrics, thresholds);

    const finishedAt = new Date().toISOString();

    const result: RegressionRunResult = {
      status,
      details,
      datasetVersionId: args.datasetVersionId,
      runKind: args.triggeredBy,
      triggeredBy: args.triggeredByUserId ?? null,
      startedAt,
      finishedAt,
    };

    // Step 6: persist the run
    await this.persistRun(result);

    logger.info('[RegressionGateService] Regression gate complete', {
      status: result.status,
      turnCount: turns.length,
      violationsCount: details.filter(d => d.status !== 'pass').length,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Static: evaluate metrics against thresholds
  //
  // Breaching logic (matches test comments):
  //   direction = 'lower_is_worse':
  //     ci_lower < warn_at  → warn
  //     ci_lower < fail_at  → fail  (fail wins when both apply)
  //     ci_lower >= warn_at → pass
  //   direction = 'higher_is_worse':
  //     ci_upper > warn_at  → warn
  //     ci_upper > fail_at  → fail  (fail wins when both apply)
  //     ci_upper <= warn_at → pass
  // ---------------------------------------------------------------------------

  static evaluate(
    metrics: Record<string, { value: number; ci_lower: number; ci_upper: number; threshold: number }>,
    thresholds: Array<{
      metric: string;
      fail_at: number;
      warn_at: number;
      direction: 'lower_is_worse' | 'higher_is_worse';
    }>,
  ): { status: 'pass' | 'warn' | 'fail'; details: ThresholdDetail[] } {
    const details: ThresholdDetail[] = [];
    let hasFail = false;
    let hasWarn = false;

    for (const threshold of thresholds) {
      const m = metrics[threshold.metric];
      const status: 'pass' | 'warn' | 'fail' =
        RegressionGateService.breachStatus(m, threshold.fail_at, threshold.warn_at, threshold.direction);

      if (status === 'fail') hasFail = true;
      else if (status === 'warn') hasWarn = true;

      details.push({
        metric: threshold.metric,
        status,
        value: m?.value ?? 0,
        ci_lower: m?.ci_lower ?? 0,
        ci_upper: m?.ci_upper ?? 1,
        threshold: threshold.fail_at,
      });
    }

    // Overall status: fail > warn > pass
    const overallStatus: 'pass' | 'warn' | 'fail' = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

    return { status: overallStatus, details };
  }

  /**
   * Determines the per-metric breach status.
   */
  private static breachStatus(
    m: { value: number; ci_lower: number; ci_upper: number } | undefined,
    fail_at: number,
    warn_at: number,
    direction: 'lower_is_worse' | 'higher_is_worse',
  ): 'pass' | 'warn' | 'fail' {
    if (!m) {
      // No metric data for this threshold → pass
      return 'pass';
    }

    if (direction === 'lower_is_worse') {
      // Lower values are worse (e.g. answer_correct).
      // Check fail first (ci_lower < fail_at), then warn (ci_lower < warn_at).
      if (m.ci_lower < fail_at) return 'fail';
      if (m.ci_lower < warn_at) return 'warn';
      return 'pass';
    } else {
      // Higher values are worse (e.g. false_handoff_rate).
      // Check fail first (ci_upper > fail_at), then warn (ci_upper > warn_at).
      if (m.ci_upper > fail_at) return 'fail';
      if (m.ci_upper > warn_at) return 'warn';
      return 'pass';
    }
  }

  // ---------------------------------------------------------------------------
  // Static: Wilson CI at 95% confidence
  // ---------------------------------------------------------------------------

  /**
   * Wilson score interval for a proportion at 95% confidence (z = 1.96).
   * Reference values (used in test assertions):
   *   p=0.8, n=100  → ci_lower ≈ 0.7115, ci_upper ≈ 0.8670
   *   p=0.8, n=5000 → ci_lower ≈ 0.7897, ci_upper ≈ 0.8103
   *   p=0.5, n=100  → ci_lower ≈ 0.401,  ci_upper ≈ 0.599
   */
  static wilsonCIstatic(p: number, n: number): { value: number; ci_lower: number; ci_upper: number } {
    return wilsonCI(p, n);
  }

  // ---------------------------------------------------------------------------
  // Static: aggregate continuous eval metrics with Wilson CIs
  //
  // Continuous eval uses the same scoring structure as CI but applies looser
  // thresholds. Exposed as a static method so ContinuousEvalJob can call it
  // without instantiating RegressionGateService.
  // ---------------------------------------------------------------------------

  static aggregateContinuousMetrics(
    scores: Array<{
      turn_id: string;
      answer_correct: number;
      cite_precision: number;
      recall_at_10: number;
      false_handoff: number;
    }>,
  ): Record<string, { value: number; ci_lower: number; ci_upper: number }> {
    const n = scores.length;
    if (n === 0) return {};

    const answerCorrect = mean(scores.map(s => s.answer_correct));
    const citePrecision = mean(scores.map(s => s.cite_precision));
    const recallAt10 = mean(scores.map(s => s.recall_at_10));
    const falseHandoffRate = mean(scores.map(s => (s.false_handoff ? 1 : 0)));

    return {
      answer_correct: RegressionGateService.wilsonCIstatic(answerCorrect, n),
      cite_precision: RegressionGateService.wilsonCIstatic(citePrecision, n),
      recall_at_10: RegressionGateService.wilsonCIstatic(recallAt10, n),
      false_handoff_rate: RegressionGateService.wilsonCIstatic(falseHandoffRate, n),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: replay + score
  // ---------------------------------------------------------------------------

  private async replayAndScore(
    turns: EvalDatasetTurn[],
    config: CalibrationConfig,
  ): Promise<TurnScore[]> {
    const scores: TurnScore[] = [];

    for (const turn of turns) {
      try {
        const replay = await this.calibrationService.replayTurn(turn, config);
        const score = this.calibrationService.scoreTurn(replay, turn);
        scores.push(score);
      } catch (err) {
        logger.warn('[RegressionGateService] Turn replay failed, treating as miss', {
          turnId: turn.id,
          error: err,
        });
        // Treat failed replay as all-zero score
        scores.push({
          turn_id: turn.id,
          answer_correct: 0,
          cite_precision: 0,
          recall_at_10: 0,
          false_handoff: true,
        });
      }
    }

    return scores;
  }

  // ---------------------------------------------------------------------------
  // Internal: aggregate metrics with Wilson CIs
  // ---------------------------------------------------------------------------

  private aggregateMetrics(
    scores: TurnScore[],
  ): Record<string, { value: number; ci_lower: number; ci_upper: number; threshold: number }> {
    const n = scores.length;
    if (n === 0) {
      return {};
    }

    const answerCorrect = mean(scores.map(s => s.answer_correct));
    const citePrecision = mean(scores.map(s => s.cite_precision));
    const recallAt10 = mean(scores.map(s => s.recall_at_10));
    const falseHandoffRate = mean(scores.map(s => (s.false_handoff ? 1 : 0)));

    return {
      answer_correct: { ...RegressionGateService.wilsonCIstatic(answerCorrect, n), threshold: 0 },
      cite_precision: { ...RegressionGateService.wilsonCIstatic(citePrecision, n), threshold: 0 },
      recall_at_10: { ...RegressionGateService.wilsonCIstatic(recallAt10, n), threshold: 0 },
      false_handoff_rate: { ...RegressionGateService.wilsonCIstatic(falseHandoffRate, n), threshold: 0 },
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: persist
  // ---------------------------------------------------------------------------

  private async persistRun(result: RegressionRunResult): Promise<void> {
    if (isDemoMode()) {
      logger.debug('[RegressionGateService] Demo mode: skipping DB persist');
      return;
    }

    // Build a metrics JSONB compatible with EvalRegressionRepository
    const metricsJson: Record<string, { value: number; ci_lower: number; ci_upper: number; threshold: number }> = {};
    for (const detail of result.details) {
      metricsJson[detail.metric] = {
        value: detail.value ?? 0,
        ci_lower: detail.ci_lower,
        ci_upper: detail.ci_upper,
        threshold: detail.threshold,
      };
    }

    await this.regressionRepo.create({
      dataset_version_id: result.datasetVersionId,
      run_kind: result.runKind,
      status: result.status,
      metrics: metricsJson,
      started_at: result.startedAt,
      finished_at: result.finishedAt,
      triggered_by: result.triggeredBy,
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
