/**
 * POST /api/eval/calibration/run
 *
 * Admin-only. Runs the calibration pipeline for a slice.
 * Body: { datasetVersionId: string; botId: string; shopId?: string }
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { CalibrationService } from '@/server/services/eval/calibration-service';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/api-utils';

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

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const userId = getAuthenticatedUserId(request) ?? 'unknown';

    const body = await request.json().catch(() => ({}));
    const { datasetVersionId, botId, shopId } = body as {
      datasetVersionId?: string;
      botId?: string;
      shopId?: string;
    };

    if (!datasetVersionId || typeof datasetVersionId !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 datasetVersionId', code: 'MISSING_DATASET_VERSION_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!botId || typeof botId !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 botId', code: 'MISSING_BOT_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (shopId !== undefined && (typeof shopId !== 'string' || shopId.trim() === '')) {
      return new Response(JSON.stringify({ error: 'shopId 必须为非空字符串', code: 'INVALID_SHOP_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const effectiveShopId = shopId?.trim() || null;

    logger.info('[Eval/Calibration/Run] Starting calibration', {
      userId,
      datasetVersionId,
      botId,
      shopId: effectiveShopId,
    });

    await acquireSliceLock(botId, effectiveShopId);

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

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
