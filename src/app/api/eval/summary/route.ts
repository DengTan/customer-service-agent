/**
 * GET /api/eval/summary
 *
 * Admin-only. Returns a unified summary of the three eval subsystems.
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { logger } from '@/lib/logger';
import { isDemoMode } from '@/storage/database/supabase-client';
import { EvalRegressionRepository } from '@/server/repositories/eval-regression-repository';
import { EvalShadowRepository } from '@/server/repositories/eval-shadow-repository';
import type { EvalRegressionRunRow } from '@/server/repositories/eval-regression-repository';
import type { ShadowComparatorRow } from '@/server/repositories/eval-shadow-repository';
import type { EvalCalibrationSettingsRow } from '@/server/repositories/eval-calibration-repository';

interface CalibrationSummaryRow {
  bot_id: string;
  shop_id: string | null;
  status: string;
  composite: number;
  min_score: number;
  rerank_backend: string;
  claim_verifier_threshold: number;
  confidence_gate: number;
  fold_gap: number;
  overfit_suspect: boolean;
  is_canary: boolean;
  canary_pct: number;
  promoted_at: string | null;
}

function toCalibrationSummary(row: EvalCalibrationSettingsRow): CalibrationSummaryRow {
  return {
    bot_id: row.bot_id,
    shop_id: row.shop_id,
    status: row.status,
    composite: row.composite,
    min_score: row.min_score,
    rerank_backend: row.rerank_backend,
    claim_verifier_threshold: row.claim_verifier_threshold,
    confidence_gate: row.confidence_gate,
    fold_gap: row.fold_gap,
    overfit_suspect: row.fold_gap > 0.1 && row.composite < 0.6,
    is_canary: row.is_canary,
    canary_pct: row.canary_pct,
    promoted_at: row.promoted_at,
  };
}

async function fetchRegressionRuns(): Promise<EvalRegressionRunRow[]> {
  const repo = new EvalRegressionRepository();
  const [ci, continuous, manual] = await Promise.all([
    repo.latest('ci').catch((err) => {
      logger.error('Failed to fetch latest ci regression run', { error: err });
      return null;
    }),
    repo.latest('continuous').catch((err) => {
      logger.error('Failed to fetch latest continuous regression run', { error: err });
      return null;
    }),
    repo.latest('manual').catch((err) => {
      logger.error('Failed to fetch latest manual regression run', { error: err });
      return null;
    }),
  ]);
  return [ci, continuous, manual].filter((r): r is EvalRegressionRunRow => r !== null);
}

async function fetchShadowSummary(): Promise<ShadowComparatorRow[]> {
  const repo = new EvalShadowRepository();
  const { rows: recentRuns } = await repo
    .getRuns({ sinceDays: 30, limit: 1000 })
    .catch((err) => {
      logger.error('Failed to fetch recent shadow runs for summary', { error: err });
      return { rows: [], total: 0 };
    });

  if (recentRuns.length === 0) return [];

  const slices = Array.from(
    new Set(recentRuns.map((r) => `${r.bot_id}::${r.shop_id ?? 'null'}`)),
  ).map((key) => {
    const [bot_id, shop_id] = key.split('::');
    return { bot_id, shop_id: shop_id === 'null' ? null : shop_id as string };
  });

  const comparators = await Promise.all(
    slices.map(({ bot_id, shop_id }) =>
      repo
        .getComparator({ botId: bot_id, shopId: shop_id, windowDays: 30, minN: 1 })
        .catch((err) => {
          logger.warn('Failed to compute shadow comparator', { bot_id, shop_id, error: err });
          return null;
        }),
    ),
  );

  return comparators.filter((c): c is ShadowComparatorRow => c !== null);
}

async function fetchCalibrationSummary(): Promise<CalibrationSummaryRow[]> {
  if (isDemoMode()) return [];

  const { getSupabaseClient } = await import('@/storage/database/supabase-client');
  let data: unknown[] | null = null;
  let error: string | null = null;
  try {
    const supabase = getSupabaseClient();
    const result = await supabase
      .from('eval_calibration_settings')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false });
    if (result.error) {
      error = result.error.message;
    } else {
      data = result.data;
    }
  } catch (err: unknown) {
    logger.error('Failed to fetch calibration summary rows', { error: err });
    return [];
  }

  if (error || !data) return [];
  return (data as unknown as EvalCalibrationSettingsRow[]).map(toCalibrationSummary);
}

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    const [latest_regression_runs, shadow_summary, calibration_summary] =
      await Promise.all([
        fetchRegressionRuns(),
        fetchShadowSummary(),
        fetchCalibrationSummary(),
      ]);

    const response = {
      latest_regression_runs,
      shadow_summary,
      calibration_summary,
    };

    return new Response(JSON.stringify({ ok: true, ...response }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
