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
import {
  apiSuccess,
  apiError,
  parseJsonBody,
  withErrorHandlerSimple,
  requireRole,
  HttpStatus,
  getAuthenticatedUserId,
} from '@/lib/api-utils';
import { RegressionGateService } from '@/server/services/eval/regression-gate-service';
import type { CalibrationConfig } from '@/server/services/eval/calibration-service';
import { logger } from '@/lib/logger';

const ADMIN_ONLY = ['admin'];

// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // --- Admin-only gate ---
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const userId = getAuthenticatedUserId(request) ?? 'unknown';

  // --- Parse body ---
  const { data: body, error: parseError } = await parseJsonBody<{
    datasetVersionId?: string;
    candidateConfig?: CalibrationConfig;
    runKind?: 'ci' | 'continuous' | 'manual';
  }>(request);

  if (parseError) return parseError;

  const { datasetVersionId, candidateConfig, runKind } = body ?? {};

  // --- Validate required fields ---
  if (!datasetVersionId || typeof datasetVersionId !== 'string') {
    return apiError('缺少或无效的 datasetVersionId', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_DATASET_VERSION_ID',
    });
  }

  if (!candidateConfig || typeof candidateConfig !== 'object') {
    return apiError('缺少或无效的 candidateConfig', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_CANDIDATE_CONFIG',
    });
  }

  const { min_score, rerank_backend, claim_verifier_threshold, confidence_gate } = candidateConfig;

  if (typeof min_score !== 'number' || typeof rerank_backend !== 'string' ||
      typeof claim_verifier_threshold !== 'number' || typeof confidence_gate !== 'number') {
    return apiError('candidateConfig 包含无效字段', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_CANDIDATE_CONFIG',
    });
  }

  const triggeredBy = runKind ?? 'manual';

  logger.info('[Eval/Regression/Run] Starting regression gate', {
    userId,
    datasetVersionId,
    triggeredBy,
  });

  // --- Run regression gate ---
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

  return apiSuccess(result, HttpStatus.OK);
});
