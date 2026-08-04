/**
 * GET /api/eval/shadow/comparator
 *
 * Admin-only. Returns the 4-by-2 shadow evaluation comparison table.
 *
 * Query params:
 *   botId      <uuid>    required
 *   shopId     <uuid>    optional
 *   windowDays <number>  optional, default 7
 *   minN       <number>  optional, default 100
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { EvalShadowRepository } from '@/server/repositories/eval-shadow-repository';
import { CalibrationService } from '@/server/services/eval/calibration-service';

function wilsonCI(
  p: number,
  n: number,
): { value: number; ci_lower: number; ci_upper: number } {
  return CalibrationService.wilsonCIstatic(p, n);
}

interface MetricWithCI {
  value: number;
  ci_lower: number;
  ci_upper: number;
}

const METRIC_KEYS = ['answer_correct', 'cite_precision', 'recall_at_10', 'false_handoff_rate'] as const;

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);

    const botIdRaw = searchParams.get('botId');
    if (!botIdRaw || typeof botIdRaw !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 botId 参数', code: 'MISSING_BOT_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shopIdParam = searchParams.get('shopId');
    const shopId: string | null = shopIdParam === null || shopIdParam === 'null'
      ? null
      : shopIdParam;

    const windowDays = parseInt(searchParams.get('windowDays') ?? '7', 10);
    if (isNaN(windowDays) || windowDays < 1) {
      return new Response(JSON.stringify({ error: 'windowDays 必须为正整数', code: 'INVALID_WINDOW_DAYS' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const minN = parseInt(searchParams.get('minN') ?? '100', 10);
    if (isNaN(minN) || minN < 1) {
      return new Response(JSON.stringify({ error: 'minN 必须为正整数', code: 'INVALID_MIN_N' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const repo = new EvalShadowRepository();
    const result = await repo.getComparator({
      botId: botIdRaw,
      shopId,
      windowDays,
      minN,
    });

    if (!result) {
      return new Response(JSON.stringify({ ok: true, data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const response = {
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

    return new Response(JSON.stringify({ ok: true, ...response }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
