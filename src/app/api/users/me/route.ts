import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, getAuthenticatedUserId } from '@/lib/api-utils';
import { UserService } from '@/server/services/user-service';
import type { UpdateUserInput } from '@/server/repositories/user-repository';

const userService = new UserService();

/**
 * GET /api/users/me - Get current user profile
 */
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiSuccess({ user: null });
  }

  const user = await userService.getUser(userId);
  return apiSuccess({ user });
});

/**
 * PATCH /api/users/me - Update current user profile
 */
export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => ({}));
  const updates: UpdateUserInput = {
    id: userId,
    avatar: body.avatar,
  };

  const user = await userService.updateUser(updates);
  return apiSuccess({ user });
});
