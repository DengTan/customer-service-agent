/**
 * POST /api/eval/calibration/run
 *
 * Admin-only. Runs the calibration pipeline for a slice.
 * Body: { datasetVersionId: string; botId: string; shopId?: string }
 *
 * Per-slice advisory lock prevents concurrent calibration for the same slice.
 * Lock key: computed by PostgreSQL eval_calibration_slice_lock RPC
 *           (uses built-in hashtext() so the key always matches
 *            pg_advisory_xact_lock's internal computation).
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
import { CalibrationService } from '@/server/services/eval/calibration-service';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

const ADMIN_ONLY = ['admin'];

/**
 * Acquires a per-slice advisory lock using pg_advisory_xact_lock via a
 * PostgreSQL RPC.  The lock key is computed server-side using PostgreSQL's
 * built-in hashtext() so it always matches pg_advisory_xact_lock's
 * internal computation — avoiding the risk of JS reimplementation drift.
 */
async function acquireSliceLock(botId: string, shopId: string | null): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.rpc('eval_calibration_slice_lock', {
    p_bot_id: botId,
    p_shop_id: shopId,
  });

  if (error) {
    logger.warn('[Eval/Calibration/Run] Advisory lock warning (will proceed without lock)', {
      botId,
      shopId,
      error: error.message,
    });
  }
}

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // --- Admin-only gate ---
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const userId = getAuthenticatedUserId(request) ?? 'unknown';

  // --- Parse body ---
  const { data: body, error: parseError } = await parseJsonBody<{
    datasetVersionId?: string;
    botId?: string;
    shopId?: string;
  }>(request);

  if (parseError) return parseError;

  const { datasetVersionId, botId, shopId } = body ?? {};

  // --- Validate required fields ---
  if (!datasetVersionId || typeof datasetVersionId !== 'string') {
    return apiError('缺少或无效的 datasetVersionId', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_DATASET_VERSION_ID',
    });
  }

  if (!botId || typeof botId !== 'string') {
    return apiError('缺少或无效的 botId', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_BOT_ID',
    });
  }

  // --- Validate optional shopId ---
  // If provided, must be a non-empty string (empty string would bypass null filter)
  if (shopId !== undefined && (typeof shopId !== 'string' || shopId.trim() === '')) {
    return apiError('shopId 必须为非空字符串', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_SHOP_ID',
    });
  }

  const effectiveShopId = shopId?.trim() || null;

  logger.info('[Eval/Calibration/Run] Starting calibration', {
    userId,
    datasetVersionId,
    botId,
    shopId: effectiveShopId,
  });

  // --- Acquire per-slice advisory lock ---
  await acquireSliceLock(botId, effectiveShopId);

  // --- Run calibration ---
  const calibrationService = new CalibrationService();
  const result = await calibrationService.run({
    datasetVersionId,
    botId,
    shopId: effectiveShopId,
    operatorId: userId,
  });

  logger.info('[Eval/Calibration/Run] Calibration complete', {
    userId,
    datasetVersionId,
    botId,
    shopId: effectiveShopId,
    chosenComposite: result.chosen?.composite,
    overfitSuspect: result.overfit_suspect,
  });

  return apiSuccess(result, HttpStatus.OK);
});
