/**
 * POST /api/eval/regression/run
 *
 * Admin-only.  Triggers a regression gate run against the locked evaluation dataset
 * and a candidate calibration configuration, then persists the result.
 *
 * Body: { datasetVersionId: string; candidateConfig: CalibrationConfig }
 * Body (optional): runKind?: 'ci' | 'continuous' | 'manual'  (default: 'manual')
 */

import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { RegressionGateService } from '@/server/services/eval/regression-gate-service';
import type { CalibrationConfig } from '@/server/services/eval/calibration-service';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/api-utils';

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const userId = getAuthenticatedUserId(request) ?? 'unknown';

    const body = await request.json().catch(() => ({}));
    const { datasetVersionId, candidateConfig, runKind } = body as {
      datasetVersionId?: string;
      candidateConfig?: CalibrationConfig;
      runKind?: 'ci' | 'continuous' | 'manual';
    };

    if (!datasetVersionId || typeof datasetVersionId !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 datasetVersionId', code: 'MISSING_DATASET_VERSION_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!candidateConfig || typeof candidateConfig !== 'object') {
      return new Response(JSON.stringify({ error: '缺少或无效的 candidateConfig', code: 'MISSING_CANDIDATE_CONFIG' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { min_score, rerank_backend, claim_verifier_threshold, confidence_gate } = candidateConfig;

    if (typeof min_score !== 'number' || typeof rerank_backend !== 'string' ||
        typeof claim_verifier_threshold !== 'number' || typeof confidence_gate !== 'number') {
      return new Response(JSON.stringify({ error: 'candidateConfig 包含无效字段', code: 'INVALID_CANDIDATE_CONFIG' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const triggeredBy = runKind ?? 'manual';

    logger.info('[Eval/Regression/Run] Starting regression gate', {
      userId,
      datasetVersionId,
      triggeredBy,
    });

    const service = new RegressionGateService();
    const result = await service.run({
      datasetVersionId,
      candidateConfig,
      triggeredBy,
      triggeredByUserId: userId,
    });

    logger.info('[Eval/Regression/Run] Regression gate complete', {
      userId,
      datasetVersionId,
      runId: result.id,
      status: result.status,
    });

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
