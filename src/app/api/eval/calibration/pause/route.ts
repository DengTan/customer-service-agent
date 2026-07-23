/**
 * POST /api/eval/calibration/pause
 *
 * Admin-only. Pauses a canary calibration by archiving it.
 * Body: { id: string }
 */

import { NextRequest } from 'next/server';
import {
  apiSuccess,
  apiError,
  parseJsonBody,
  withErrorHandlerSimple,
  requireRole,
  HttpStatus,
} from '@/lib/api-utils';
import { EvalCalibrationRepository } from '@/server/repositories/eval-calibration-repository';
import { logger } from '@/lib/logger';

const ADMIN_ONLY = ['admin'];

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // --- Admin-only gate ---
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // --- Parse body ---
  const { data: body, error: parseError } = await parseJsonBody<{ id?: string }>(request);
  if (parseError) return parseError;

  const { id } = body ?? {};

  if (!id || typeof id !== 'string') {
    return apiError('缺少或无效的 id', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_ID',
    });
  }

  const repo = new EvalCalibrationRepository();
  const calibration = await repo.getById(id);

  if (!calibration) {
    return apiError('未找到指定的校准记录', {
      status: HttpStatus.NOT_FOUND,
      code: 'NOT_FOUND',
    });
  }

  if (calibration.status !== 'canary') {
    return apiError(
      `只能暂停状态为 canary 的校准记录，当前状态为 '${calibration.status}'`,
      {
        status: HttpStatus.CONFLICT,
        code: 'INVALID_STATUS',
      },
    );
  }

  logger.info('[Eval/Calibration/Pause] Pausing canary calibration', { id });

  const archived = await repo.archive(id);

  logger.info('[Eval/Calibration/Pause] Canary calibration paused', {
    id,
    previousStatus: 'canary',
    newStatus: archived.status,
  });

  return apiSuccess({ calibration: archived }, HttpStatus.OK);
});
