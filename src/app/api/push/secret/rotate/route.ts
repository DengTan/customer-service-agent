import type { NextRequest } from 'next/server';
import { apiSuccess, requireRole, withErrorHandlerSimple } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { PushSecretService } from '@/server/services/push-secret-service';

const ADMIN_ONLY = ['admin'];
const pushSecretService = new PushSecretService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  try {
    const result = await pushSecretService.rotate();
    logger.security.info('Push webhook secret rotated', {
      last4: result.last4,
      rotatedAt: result.rotated_at,
    });
    return apiSuccess(result);
  } catch (error) {
    logger.security.error('Push webhook secret rotation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});
