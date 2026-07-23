/**
 * GET /api/eval/shadow/comparator
 *
 * Admin-only. Returns the 4-by-2 shadow evaluation comparison table
 * (baseline × candidate) with 95% Wilson confidence intervals for four
 * metrics, plus the delta between cohorts.
 *
 * Query params:
 *   botId      <uuid>    required — which bot to compare
 *   shopId     <uuid>    optional — filter by shop (omit or pass "null" for all)
 *   windowDays <number>  optional, default 7 — look-back window in days
 *   minN       <number>  optional, default 100 — minimum runs per cohort to return data
 *
 * Throws:
 *   403 — caller is not admin
 *   400 — missing or invalid botId
 *   404 — total runs across both cohorts is below minN
 */

import { NextRequest } from 'next/server';
import {
  apiSuccess,
  apiError,
  withErrorHandlerSimple,
  requireRole,
  HttpStatus,
} from '@/lib/api-utils';
import { EvalShadowRepository } from '@/server/repositories/eval-shadow-repository';
import { CalibrationService } from '@/server/services/eval/calibration-service';

const ADMIN_ONLY = ['admin'];

// ─── Wilson CI wrapper ────────────────────────────────────────────────────────

function wilsonCI(
  p: number,
  n: number,
): { value: number; ci_lower: number; ci_upper: number } {
  return CalibrationService.wilsonCIstatic(p, n);
}

// ─── Metric with CI ───────────────────────────────────────────────────────────

interface MetricWithCI {
  value: number;
  ci_lower: number;
  ci_upper: number;
}

// ─── Response shape ───────────────────────────────────────────────────────────

interface ShadowComparatorResponse {
  bot_id: string;
  shop_id: string | null;
  window_days: number;
  n: number; // runs per cohort (the smaller of the two)
  baseline: {
    answer_correct: MetricWithCI;
    cite_precision: MetricWithCI;
    recall_at_10: MetricWithCI;
    false_handoff_rate: MetricWithCI;
  };
  candidate: {
    answer_correct: MetricWithCI;
    cite_precision: MetricWithCI;
    recall_at_10: MetricWithCI;
    false_handoff_rate: MetricWithCI;
  };
  delta: {
    answer_correct: number;
    cite_precision: number;
    recall_at_10: number;
    false_handoff_rate: number;
  };
}

const METRIC_KEYS = ['answer_correct', 'cite_precision', 'recall_at_10', 'false_handoff_rate'] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

// ─── Handler ──────────────────────────────────────────────────────────────────

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // ── Admin gate ──────────────────────────────────────────────────────────────
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // ── Parse query params ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const botIdRaw = searchParams.get('botId');
  if (!botIdRaw || typeof botIdRaw !== 'string') {
    return apiError('缺少或无效的 botId 参数', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_BOT_ID',
    });
  }

  const shopIdParam = searchParams.get('shopId');
  // "null" string means no shop filter (all shops); null means no shop assigned
  const shopId: string | null = shopIdParam === null || shopIdParam === 'null'
    ? null
    : shopIdParam;

  const windowDays = parseInt(searchParams.get('windowDays') ?? '7', 10);
  if (isNaN(windowDays) || windowDays < 1) {
    return apiError('windowDays 必须为正整数', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_WINDOW_DAYS',
    });
  }

  const minN = parseInt(searchParams.get('minN') ?? '100', 10);
  if (isNaN(minN) || minN < 1) {
    return apiError('minN 必须为正整数', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_MIN_N',
    });
  }

  // ── Fetch comparator data ───────────────────────────────────────────────────
  const repo = new EvalShadowRepository();
  const result = await repo.getComparator({
    botId: botIdRaw,
    shopId,
    windowDays,
    // The repository uses minN to filter each cohort separately; we need both
    // cohorts to have at least minN rows. We pass the combined threshold.
    minN,
  });

  // If insufficient data (either cohort has < minN rows), return null with 200
  if (!result) {
    return apiSuccess(null, HttpStatus.OK);
  }

  // ── Enrich with 95% Wilson CIs ─────────────────────────────────────────────
  // The repository returns raw metric values; compute CIs per cohort per metric.
  const enrich = (raw: Record<string, number>, n: number) => {
    const enriched: Record<string, MetricWithCI> = {};
    for (const key of METRIC_KEYS) {
      const value = raw[key] ?? 0;
      enriched[key] = wilsonCI(value, n);
    }
    return enriched;
  };

  const baselineCI = enrich(result.baseline_metrics, result.n);
  const candidateCI = enrich(result.candidate_metrics, result.n);

  const response: ShadowComparatorResponse = {
    bot_id: result.bot_id,
    shop_id: result.shop_id,
    window_days: windowDays,
    n: result.n,
    baseline: {
      answer_correct: baselineCI.answer_correct,
      cite_precision: baselineCI.cite_precision,
      recall_at_10: baselineCI.recall_at_10,
      false_handoff_rate: baselineCI.false_handoff_rate,
    },
    candidate: {
      answer_correct: candidateCI.answer_correct,
      cite_precision: candidateCI.cite_precision,
      recall_at_10: candidateCI.recall_at_10,
      false_handoff_rate: candidateCI.false_handoff_rate,
    },
    delta: result.delta,
  };

  return apiSuccess(response, HttpStatus.OK);
});
