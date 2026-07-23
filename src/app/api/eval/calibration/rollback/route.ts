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
      `只能回滚状态为 canary 的校准记录，当前状态为 '${calibration.status}'`,
      {
        status: HttpStatus.CONFLICT,
        code: 'INVALID_STATUS',
      },
    );
  }

  logger.info('[Eval/Calibration/Rollback] Rolling back canary calibration', { id });

  // Archive the canary — also clears is_canary via updateStatus then set is_canary=false
  const archived = await repo.archive(id);

  logger.info('[Eval/Calibration/Rollback] Canary calibration rolled back', {
    id,
    previousStatus: 'canary',
    newStatus: archived.status,
  });

  return apiSuccess(
    {
      calibration: archived,
      message: '回滚成功。previous baseline 未自动重新激活，如有需要请手动操作。',
    },
    HttpStatus.OK,
  );
});
