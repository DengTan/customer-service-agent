import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, withErrorHandlerSimple, requireRole, HttpStatus, getAuthenticatedUserId } from '@/lib/api-utils';
import { FeatureFlagService } from '@/server/services/feature-flag-service';
import { logger } from '@/lib/logger';

const featureFlagService = new FeatureFlagService();
const ADMIN_ONLY = ['admin'];

/**
 * GET /api/feature-flags
 *
 * Returns the full feature flag list. Admin-only. Audit logged.
 */
// Sprint 7 scope-creep triage: this route was added outside the Sprint 6 plan and has not been Standards-axis reviewed. See Sprint 7 review notes.

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const userId = getAuthenticatedUserId(request) ?? 'unknown';
  logger.info('[FeatureFlags] GET — list flags', { userId });

  const flags = await featureFlagService.listFlags();
  return apiSuccess({ flags });
});

/**
 * PUT /api/feature-flags
 *
 * Updates a single feature flag. Admin-only.
 * Body: { key: string, value: string }
 * Key must be in the allow-list (FEATURE_FLAG_KEYS).
 * Writes via FeatureFlagService.setFlag; returns the new row.
 */
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody<{ key?: string; value?: string }>(request);
  if (parseError) return parseError;

  const { key, value } = body ?? {};

  if (!key || typeof key !== 'string') {
    return apiError('缺少或无效的 flag key', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_KEY',
    });
  }

  if (value === undefined || typeof value !== 'string') {
    return apiError('缺少或无效的 flag value', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_VALUE',
    });
  }

  const userId = getAuthenticatedUserId(request) ?? 'unknown';

  // setFlag validates against FEATURE_FLAG_KEYS and throws ServiceError on invalid key
  await featureFlagService.setFlag(key, value, userId);

  logger.info('[FeatureFlags] PUT — flag updated', { userId, key, value });

  return apiSuccess({ key, value }, HttpStatus.OK);
});
