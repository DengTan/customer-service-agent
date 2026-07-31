import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, getAuthenticatedUserId } from '@/lib/api-utils';
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
 * Note: Users can only update their own profile (avatar only, name/email require admin)
 */
export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const body = await request.json().catch(() => ({}));
  
  // Only allow avatar field to be updated by users themselves
  const avatar = body.avatar;
  
  // Validate avatar field if provided
  if (avatar !== undefined && avatar !== null) {
    if (typeof avatar !== 'string') {
      return apiError('头像必须是有效的 URL', { status: 400, code: 'INVALID_AVATAR' });
    }
    // Basic URL validation (must be a valid URL string)
    if (avatar.length > 2048) {
      return apiError('头像 URL 长度不能超过 2048 字符', { status: 400, code: 'AVATAR_TOO_LONG' });
    }
    try {
      if (avatar) {
        new URL(avatar);
      }
    } catch {
      return apiError('头像必须是有效的 URL', { status: 400, code: 'INVALID_AVATAR' });
    }
  }

  const updates: UpdateUserInput = {
    id: userId,
    avatar: avatar,
  };

  const user = await userService.updateUser(updates);
  return apiSuccess({ user });
});
