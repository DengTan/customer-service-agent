/**
 * POST /api/eval/calibration/pause
 *
 * Admin-only. Pauses a canary calibration by archiving it.
 * Body: { id: string }
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
        error: `只能暂停状态为 canary 的校准记录，当前状态为 '${calibration.status}'`,
        code: 'INVALID_STATUS',
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logger.info('[Eval/Calibration/Pause] Pausing canary calibration', { id });

    const archived = await repo.archive(id);

    logger.info('[Eval/Calibration/Pause] Canary calibration paused', {
      id,
      previousStatus: 'canary',
      newStatus: archived.status,
    });

    return new Response(JSON.stringify({ ok: true, calibration: archived }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
