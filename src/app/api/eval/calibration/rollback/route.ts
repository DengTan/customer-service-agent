/**
 * POST /api/eval/calibration/rollback
 *
 * Admin-only. Rolls back a canary calibration.
 * Body: { id: string }
 *
 * Sets status='archived' on the canary calibration and resets is_canary=false.
 * Does NOT re-activate the previous baseline automatically.
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { EvalCalibrationRepository } from '@/server/repositories/eval-calibration-repository';
import { logger } from '@/lib/logger';

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
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

    if (calibration.status !== 'canary') {
      return new Response(JSON.stringify({
        error: `只能回滚状态为 canary 的校准记录，当前状态为 '${calibration.status}'`,
        code: 'INVALID_STATUS',
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.info('[Eval/Calibration/Rollback] Rolling back canary calibration', { id });

    const archived = await repo.archive(id);

    logger.info('[Eval/Calibration/Rollback] Canary calibration rolled back', {
      id,
      previousStatus: 'canary',
      newStatus: archived.status,
    });

    return new Response(JSON.stringify({
      ok: true,
      calibration: archived,
      message: '回滚成功。previous baseline 未自动重新激活，如有需要请手动操作。',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
