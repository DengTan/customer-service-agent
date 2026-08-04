/**
 * GET /api/eval/shadow/runs
 *
 * Admin-only. Returns paginated, de-identified shadow run records.
 *
 * Query params:
 *   cohort  'treatment' | 'control'  optional — filter by cohort
 *   limit   <number>    optional, default 20, max 200
 *   offset  <number>    optional, default 0
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { EvalShadowRepository } from '@/server/repositories/eval-shadow-repository';

interface DeidentifiedShadowRun {
  id: string;
  conversation_id: string;
  message_id: string;
  bot_id: string;
  shop_id: string | null;
  cohort: 'treatment' | 'control';
  dataset_version_id: string | null;
  baseline_config_hash: string;
  candidate_config_hash: string;
  baseline_decision: string;
  candidate_decision: string;
  baseline_confidence: number;
  candidate_confidence: number;
  first_token_latency_ms_baseline: number;
  first_token_latency_ms_candidate: number;
  agreement_decision: boolean;
  agreement_citations: number;
  agreement_answer: number;
  created_at: string;
}

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);

    const cohortParam = searchParams.get('cohort');
    const cohort: 'treatment' | 'control' | undefined =
      cohortParam === 'treatment' || cohortParam === 'control'
        ? cohortParam
        : undefined;

    const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 200);

    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    const repo = new EvalShadowRepository();
    const { rows, total } = await repo.getRuns({
      cohort,
      limit,
      offset,
    });

    const deidentified: DeidentifiedShadowRun[] = rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      message_id: row.message_id,
      bot_id: row.bot_id,
      shop_id: row.shop_id,
      cohort: row.cohort,
      dataset_version_id: row.dataset_version_id,
      baseline_config_hash: row.baseline_config_hash,
      candidate_config_hash: row.candidate_config_hash,
      baseline_decision: row.baseline_decision,
      candidate_decision: row.candidate_decision,
      baseline_confidence: row.baseline_confidence,
      candidate_confidence: row.candidate_confidence,
      first_token_latency_ms_baseline: row.first_token_latency_ms_baseline,
      first_token_latency_ms_candidate: row.first_token_latency_ms_candidate,
      agreement_decision: row.agreement_decision,
      agreement_citations: row.agreement_citations,
      agreement_answer: row.agreement_answer,
      created_at: row.created_at,
    }));

    const response = {
      rows: deidentified,
      total,
      limit,
      offset,
    };

    return new Response(JSON.stringify({ ok: true, ...response }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
