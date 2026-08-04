/**
 * POST /api/eval/calibration/promote
 *
 * Admin-only. Promotes a calibration row from 'frozen' to 'canary'.
 * Body: { id: string }
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { EvalCalibrationRepository } from '@/server/repositories/eval-calibration-repository';
import { logger } from '@/lib/logger';

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request, params }) => {
    const body = await request.json().catch(() => ({}));
    const { id } = body as { id?: string };

    if (!id || typeof id !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 id', code: 'MISSING_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const repo = new EvalCalibrationRepository();
    const calibration = await repo.getById(id);

    if (!calibration) {
      return new Response(JSON.stringify({ error: '未找到指定的校准记录', code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (calibration.status !== 'frozen') {
      return new Response(JSON.stringify({
        error: `只能提升状态为 frozen 的校准记录，当前状态为 '${calibration.status}'`,
        code: 'INVALID_STATUS',
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.info('[Eval/Calibration/Promote] Promoting calibration', { id });

    const promoted = await repo.promote(id, calibration.created_by ?? 'unknown');

    logger.info('[Eval/Calibration/Promote] Calibration promoted to canary', {
      id,
      status: promoted.status,
      promotedAt: promoted.promoted_at,
    });

    return new Response(JSON.stringify({ ok: true, calibration: promoted }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
