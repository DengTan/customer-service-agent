/**
 * GET /api/eval/regression/runs
 *
 * Admin-only.  Returns the most recent regression run rows.
 *
 * Query params:
 *   kind   — 'ci' | 'continuous' | 'manual'  (optional, default: all kinds)
 *   limit  — number (optional, default: 20)
 */

import { NextRequest } from 'next/server';
import {
  apiSuccess,
  withErrorHandlerSimple,
  requireRole,
} from '@/lib/api-utils';
import { EvalRegressionRepository } from '@/server/repositories/eval-regression-repository';

const ADMIN_ONLY = ['admin'];

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // --- Admin-only gate ---
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // --- Parse query params ---
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind') as 'ci' | 'continuous' | 'manual' | null;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10), 1), 100);

  const repo = new EvalRegressionRepository();
  const rows = await repo.list(kind ?? undefined, limit);

  return apiSuccess({ rows }, 200);
});
