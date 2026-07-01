/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { UserRepository } from '@/server/repositories/user-repository';
import { verifyPassword, validatePasswordStrength } from '@/lib/auth/password';
import { generateToken, getTokenCookieOptions } from '@/lib/auth/jwt';
import { checkRateLimit } from '@/lib/api-utils';
import { LoginSecurityService } from '@/lib/auth/login-security';
import { z } from 'zod';

const userRepo = new UserRepository();

// Login rate limit: 5 attempts per 5 minutes per IP
const LOGIN_RATE_LIMIT = { maxRequests: 5, windowMs: 5 * 60 * 1000 };

// Zod schema for login input validation
const LoginSchema = z.object({
  email: z.string()
    .min(1, '请填写邮箱')
    .email('邮箱格式不正确'),
  password: z.string()
    .min(1, '请填写密码'),
});

// Email format regex for additional server-side check (defense in depth)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // Rate limiting (IP-based)
  const rateLimitResponse = checkRateLimit(request, LOGIN_RATE_LIMIT);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  // Parse request body
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return apiError('请求体格式无效', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_JSON',
    });
  }

  // Validate input with Zod schema
  const validationResult = LoginSchema.safeParse(body);
  if (!validationResult.success) {
    return apiError(validationResult.error.issues[0]?.message || '输入格式不正确', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const { email, password } = validationResult.data;

  // Additional regex check for defense in depth (Zod already validates email format)
  if (!EMAIL_REGEX.test(email)) {
    return apiError('邮箱格式不正确', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_EMAIL_FORMAT',
    });
  }

  // Check account lockout status BEFORE revealing any info
  const lockoutStatus = LoginSecurityService.isLockedOut(email);
  
  if (lockoutStatus.locked) {
    // Always record failure even when locked out
    LoginSecurityService.recordFailure(email, 'ACCOUNT_LOCKED', request);
    
    // Don't reveal exact lockout time for security (round up)
    const minutesRemaining = Math.ceil(lockoutStatus.remainingSeconds / 60);
    return apiError(
      `账户已被锁定，请 ${minutesRemaining} 分钟后重试或联系管理员`,
      {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'ACCOUNT_LOCKED',
        meta: {
          retryAfterSeconds: lockoutStatus.remainingSeconds,
          attemptsLeft: lockoutStatus.attemptsLeft,
        },
      }
    );
  }

  // Find user by email (with password hash)
  const user = await userRepo.findByEmailWithPassword(email);

  if (!user) {
    // Simulate consistent timing for user enumeration prevention
    // Always perform the same operations regardless of whether user exists
    await verifyPassword(password, '$2b$12$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmn');
    
    // Record failure for rate limiting (but use a generic reason)
    LoginSecurityService.recordFailure(email, 'INVALID_CREDENTIALS', request);
    
    // Return generic error message - same for all failures
    return apiError('邮箱或密码错误', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_CREDENTIALS',
    });
  }

  // Check if user is active
  if (user.status !== 'active') {
    LoginSecurityService.recordFailure(email, 'ACCOUNT_DISABLED', request);
    
    return apiError('账户已被禁用，请联系管理员', {
      status: HttpStatus.FORBIDDEN,
      code: 'ACCOUNT_DISABLED',
    });
  }

  // Check if user has a password set
  if (!user.password_hash) {
    LoginSecurityService.recordFailure(email, 'NO_PASSWORD_SET', request);
    
    return apiError('该账户未设置密码，请联系管理员重置密码', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'NO_PASSWORD_SET',
    });
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash);

  if (!isValidPassword) {
    // Record failure and potentially trigger lockout
    LoginSecurityService.recordFailure(email, 'INVALID_CREDENTIALS', request);
    
    // Re-check lockout after recording
    const newLockoutStatus = LoginSecurityService.isLockedOut(email);
    
    if (newLockoutStatus.locked) {
      return apiError(
        '账户已被锁定，请稍后再试或联系管理员',
        {
          status: HttpStatus.TOO_MANY_REQUESTS,
          code: 'ACCOUNT_LOCKED_NOW',
          meta: {
            attemptsLeft: newLockoutStatus.attemptsLeft,
            retryAfterSeconds: newLockoutStatus.remainingSeconds,
          },
        }
      );
    }
    
    // Show remaining attempts
    return apiError(`邮箱或密码错误（剩余 ${newLockoutStatus.attemptsLeft} 次尝试机会）`, {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_CREDENTIALS',
      meta: {
        attemptsLeft: newLockoutStatus.attemptsLeft,
      },
    });
  }

  // Record successful login
  LoginSecurityService.recordSuccess(email, user.id, request);

  // Generate JWT token
  const token = generateToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role as 'admin' | 'agent' | 'observer',
    avatar: user.avatar ?? null,
  });

  // Create response with token cookie
  const response = apiSuccess({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
    },
  });

  // Determine if request is HTTPS for secure cookie
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const isHttps = forwardedProto === 'https' || request.url.startsWith('https://');
  
  // Set HTTP-only cookie
  const cookieOptions = getTokenCookieOptions(isHttps);
  response.cookies.set('auth_token', token, cookieOptions);

  return response;
});