import { HEARTBEAT } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { apiSuccess } from '@/lib/api-utils';
import { UserRepository } from '@/server/repositories/user-repository';
import { POST as definePost } from '@/lib/api/with-api';

/**
 * In-memory throttle map: userId → timestamp of last accepted heartbeat.
 * Entries are evicted after THROTTLE_TTL_MS to keep the map bounded.
 */
const throttleMap = new Map<string, number>();

/**
 * Periodic cleanup of stale throttle entries.
 * Runs every THROTTLE_TTL_MS to remove entries older than THROTTLE_TTL_MS.
 */
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of throttleMap.entries()) {
    if (now - timestamp > HEARTBEAT.THROTTLE_TTL_MS) {
      throttleMap.delete(userId);
    }
  }
  // Hard cap: evict oldest entries if map exceeds max size
  if (throttleMap.size > HEARTBEAT.THROTTLE_MAP_MAX_SIZE) {
    const entries = Array.from(throttleMap.entries());
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, entries.length - HEARTBEAT.THROTTLE_MAP_MAX_SIZE);
    for (const [userId] of toRemove) {
      throttleMap.delete(userId);
    }
  }
}, HEARTBEAT.THROTTLE_TTL_MS);

const userRepository = new UserRepository();

/**
 * POST /api/users/me/heartbeat
 * Update current user's last_active_at timestamp.
 *
 * - Server-side throttle: 30s minimum interval between writes per user.
 * - Always returns 200 so client is never penalized.
 * - Demo mode: graceful degradation (no-op).
 */
export const POST = definePost(
  { auth: 'required' },
  async ({ user }) => {
    const userId = user?.sub;
    if (!userId) {
      return apiSuccess({ ok: false, reason: 'unauthenticated' });
    }

    // Server-side throttle check
    const lastSent = throttleMap.get(userId);
    const now = Date.now();
    if (lastSent !== undefined && now - lastSent < HEARTBEAT.MIN_WRITE_INTERVAL_MS) {
      // Silently skip — within throttle window
      return apiSuccess({ ok: true, throttled: true });
    }

    try {
      await userRepository.touchLastActive(userId);
      throttleMap.set(userId, now);
    } catch (err) {
      // Log but return 200 — heartbeat must never break the client
      logger.warn('[heartbeat] Failed to update last_active_at', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return apiSuccess({ ok: true, throttled: false });
  },
);
