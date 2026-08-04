import type { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { logger } from '@/lib/logger';
import { PushSecretService } from '@/server/services/push-secret-service';

const pushSecretService = new PushSecretService();

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'write' },
  },
  async () => {
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
}, );

export { POSTHandler as POST };
