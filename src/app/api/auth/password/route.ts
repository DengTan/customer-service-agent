/**
 * POST /api/auth/password
 * Set or reset user password (admin only)
 * 
 * Used by administrators to:
 * - Set initial password for new users
 * - Reset password for existing users
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requireRole, parseJsonBody } from '@/lib/api-utils';
import { UserRepository } from '@/server/repositories/user-repository';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { checkRateLimit } from '@/lib/api-utils';

const userRepo = new UserRepository();

// Password change rate limit: 10 attempts per 5 minutes per IP
const PASSWORD_RATE_LIMIT = { maxRequests: 10, windowMs: 5 * 60 * 1000 };

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // Rate limiting
  const rateLimitResponse = checkRateLimit(request, PASSWORD_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  // Only admin can set passwords
  const forbidden = requireRole(request, ['admin']);
  if (forbidden) return forbidden;

  // Parse request body
  const { data: body, error: parseError } = await parseJsonBody<{
    userId?: string;
    email?: string;
    password?: string;
  }>(request);
  if (parseError) return parseError;
  if (!body) {
    return apiError('请求体无效', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_BODY',
    });
  }

  const { userId, email, password } = body;

  // Validate input
  if (!password) {
    return apiError('请提供新密码', {
      status: HttpStatus.BAD_REQUEST,
      code: 'MISSING_PASSWORD',
    });
  }

  // Validate password strength
  const validation = validatePasswordStrength(password);
  if (!validation.isValid) {
    return apiError(validation.error || '密码强度不足', {
      status: HttpStatus.BAD_REQUEST,
      code: 'WEAK_PASSWORD',
    });
  }

  // Find user by ID or email
  let user = null;
  if (userId) {
    user = await userRepo.findById(userId);
  } else if (email) {
    user = await userRepo.findByEmail(email);
  }

  if (!user) {
    return apiError('用户不存在', {
      status: HttpStatus.NOT_FOUND,
      code: 'USER_NOT_FOUND',
    });
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Update user password
  await userRepo.updatePassword(user.id, passwordHash);

  return apiSuccess({ success: true, message: '密码设置成功' });
});
