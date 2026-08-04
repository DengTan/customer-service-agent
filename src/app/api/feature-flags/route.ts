import { apiSuccess, apiError, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { FeatureFlagService } from '@/server/services/feature-flag-service';
import { logger } from '@/lib/logger';
import { GET as defineGet, PUT as definePut } from '@/lib/api/with-api';

const featureFlagService = new FeatureFlagService();

/**
 * GET /api/feature-flags
 *
 * Returns the full feature flag list. Admin-only. Audit logged.
 */
export const GET = defineGet(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request, user }) => {
    const userId = user?.sub ?? 'unknown';
    logger.info('[FeatureFlags] GET — list flags', { userId });

    const flags = await featureFlagService.listFlags();
    return apiSuccess({ flags });
  },
);

/**
 * PUT /api/feature-flags
 *
 * Updates a single feature flag. Admin-only.
 * Body: { key: string, value: string }
 * Key must be in the allow-list (FEATURE_FLAG_KEYS).
 * Writes via FeatureFlagService.setFlag; returns the new row.
 */
export const PUT = definePut(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request, user }) => {
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

    const userId = user?.sub ?? 'unknown';

    // setFlag validates against FEATURE_FLAG_KEYS and throws ServiceError on invalid key
    await featureFlagService.setFlag(key, value, userId);

    logger.info('[FeatureFlags] PUT — flag updated', { userId, key, value });

    return apiSuccess({ key, value }, HttpStatus.OK);
  },
);
