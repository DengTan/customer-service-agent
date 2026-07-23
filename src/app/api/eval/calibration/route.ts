/**
 * GET /api/eval/calibration — list calibration rows for a slice
 *   botId   <uuid>    required
 *   shopId  <uuid>   optional — pass "null" for all-shops slice
 *
 * POST /api/eval/calibration — lifecycle action on a calibration row
 *   Body: { action: 'promote' | 'pause' | 'rollback'; id: string }
 */

import { NextRequest } from 'next/server';
import {
  apiSuccess,
  apiError,
  parseJsonBody,
  withErrorHandlerSimple,
  requireRole,
  HttpStatus,
  getAuthenticatedUserId,
} from '@/lib/api-utils';
import { EvalCalibrationRepository } from '@/server/repositories/eval-calibration-repository';

const ADMIN_ONLY = ['admin'];

// GET /api/eval/calibration — list calibration rows for a slice

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // ── Admin gate ──────────────────────────────────────────────────────────────
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  // ── Parse query params ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const botIdRaw = searchParams.get('botId');
  if (!botIdRaw || typeof botIdRaw !== 'string') {
    return apiError('缺少或无效的 botId 参数', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_BOT_ID',
    });
  }

  const shopIdParam = searchParams.get('shopId');
  // "null" string = all-shops; null in URL = no shop filter; "" = no shop assigned
  const shopId: string | null =
    shopIdParam === null || shopIdParam === 'null'
      ? null
      : shopIdParam ?? null;

  const repo = new EvalCalibrationRepository();
  const rows = await repo.listBySlice(botIdRaw, shopId);

  return apiSuccess({ rows }, HttpStatus.OK);
});

// POST /api/eval/calibration — perform lifecycle action on a calibration row
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const userId = getAuthenticatedUserId(request) ?? 'unknown';

  const { data: body, error: parseError } = await parseJsonBody<{
    action?: string;
    id?: string;
  }>(request);

  if (parseError) return parseError;

  const { action, id } = body ?? {};

  if (!id || typeof id !== 'string') {
    return apiError('缺少或无效的 id', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_ID',
    });
  }

  if (!action || typeof action !== 'string') {
    return apiError('缺少或无效的 action', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_ACTION',
    });
  }

  const repo = new EvalCalibrationRepository();

  if (action === 'promote') {
    const updated = await repo.promote(id, userId);
    return apiSuccess({ row: updated, action }, HttpStatus.OK);
  }

  if (action === 'rollback') {
    const updated = await repo.archive(id);
    return apiSuccess({ row: updated, action }, HttpStatus.OK);
  }

  if (action === 'pause') {
    const updated = await repo.archive(id);
    return apiSuccess({ row: updated, action }, HttpStatus.OK);
  }

  return apiError('不支持的 action 类型', {
    status: HttpStatus.BAD_REQUEST,
    code: 'INVALID_ACTION',
  });
});
