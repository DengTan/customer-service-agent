/**
 * GET /api/eval/regression/runs
 *
 * Admin-only. Returns the most recent regression run rows.
 *
 * Query params:
 *   kind   — 'ci' | 'continuous' | 'manual'  (optional, default: all kinds)
 *   limit  — number (optional, default: 20)
 */

import { withApi } from '@/lib/api/with-api';
import { EvalRegressionRepository } from '@/server/repositories/eval-regression-repository';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind') as 'ci' | 'continuous' | 'manual' | null;
    const rawLimit = searchParams.get('limit') ?? '20';
    const limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), 100);

    const repo = new EvalRegressionRepository();
    const rows = await repo.list(kind ?? undefined, limit);

    return new Response(JSON.stringify({ ok: true, rows }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
