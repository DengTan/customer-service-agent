/**
 * POST /api/eval/calibration/promote
 *
 * Admin-only. Promotes a calibration row from 'frozen' to 'canary'.
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

  if (calibration.status !== 'frozen') {
    return apiError(
      `只能提升状态为 frozen 的校准记录，当前状态为 '${calibration.status}'`,
      {
        status: HttpStatus.CONFLICT,
        code: 'INVALID_STATUS',
      },
    );
  }

  logger.info('[Eval/Calibration/Promote] Promoting calibration', { id });

  const promoted = await repo.promote(id, calibration.created_by ?? 'unknown');

  logger.info('[Eval/Calibration/Promote] Calibration promoted to canary', {
    id,
    status: promoted.status,
    promotedAt: promoted.promoted_at,
  });

  return apiSuccess({ calibration: promoted }, HttpStatus.OK);
});
