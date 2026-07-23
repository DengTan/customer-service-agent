/**
 * GET /api/eval/shadow/runs
 *
 * Admin-only. Returns paginated, de-identified shadow run records.
 *
 * Query params:
 *   cohort  'treatment' | 'control'  optional — filter by cohort
 *   limit   <number>    optional, default 20, max 200
 *   offset  <number>    optional, default 0
 *
 * De-identification:
 *   - input_recent_messages: NEVER included (PII-bearing field)
 *   - input_user_message_digest: returned as-is (already a hash, not PII)
 *   - All other fields are returned verbatim.
 *
 * Throws:
 *   403 — caller is not admin
 */

import { NextRequest } from 'next/server';
import {
  apiSuccess,
  withErrorHandlerSimple,
  requireRole,
  HttpStatus,
} from '@/lib/api-utils';
import { EvalShadowRepository } from '@/server/repositories/eval-shadow-repository';

const ADMIN_ONLY = ['admin'];
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;

// ─── De-identified run record (no PII) ───────────────────────────────────────

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
  // input_recent_messages is intentionally omitted — never returned
  // input_user_message_digest: not present on eval_shadow_runs table (added in phase 5)
}

interface ShadowRunsResponse {
  rows: DeidentifiedShadowRun[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // ── Admin gate ──────────────────────────────────────────────────────────────
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // ── Parse query params ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const cohortParam = searchParams.get('cohort');
  const cohort: 'treatment' | 'control' | undefined =
    cohortParam === 'treatment' || cohortParam === 'control'
      ? cohortParam
      : undefined;

  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit), MAX_LIMIT);

  const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  // ── Fetch runs ─────────────────────────────────────────────────────────────
  const repo = new EvalShadowRepository();
  const { rows, total } = await repo.getRuns({
    cohort,
    limit,
    offset,
  });

  // ── De-identify: strip any PII-bearing fields ──────────────────────────────
  // eval_shadow_runs intentionally does not store input_recent_messages or
  // input_user_message_digest (see migration comment). Still, we explicitly
  // enumerate only the safe fields to future-proof against schema changes.
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
    // NOTE: input_recent_messages is NOT included — this field does not exist
    // on eval_shadow_runs and is explicitly excluded from the schema to ensure
    // operator/analytics-only access with no PII risk.
  }));

  const response: ShadowRunsResponse = {
    rows: deidentified,
    total,
    limit,
    offset,
  };

  return apiSuccess(response, HttpStatus.OK);
});
