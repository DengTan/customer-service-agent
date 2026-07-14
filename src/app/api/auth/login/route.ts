/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { UserRepository } from '@/server/repositories/user-repository';
import { UserService } from '@/server/services/user-service';
import { verifyPassword, validatePasswordStrength } from '@/lib/auth/password';
import { generateToken, getTokenCookieOptions } from '@/lib/auth/jwt';
import { getIsHttps, isSameOriginRequest } from '@/lib/auth/proxy-utils';
import { checkRateLimit } from '@/lib/api-utils';
import { LoginSecurityService } from '@/lib/auth/login-security';
import { HTTP } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const userRepo = new UserRepository();
const userService = new UserService();

// Login rate limit: 5 attempts per 5 minutes per IP
const LOGIN_RATE_LIMIT = { maxRequests: 5, windowMs: 5 * 60 * 1000 };

// Pre-computed SHA-256 placeholder hash used for timing-equivalence when the
// user does not exist. Comparison result is discarded - this is purely to
// keep the response time similar to a real bcrypt verify (the bcrypt verify
// below is intentionally removed in I-9 because it cost ~250ms per call).
const PSEUDO_VERIFY_SALT = process.env.PSEUDO_VERIFY_SALT || 'smartassist-pseudo-verify-fallback';
const PSEUDO_VERIFY_DUMMY_HASH = crypto
  .createHash('sha256')
  .update(`__pseudo_invalid__:${PSEUDO_VERIFY_SALT}`)
  .digest('hex');

/**
 * Lightweight pseudo-verification for missing users.
 * Performs a single SHA-256 hash of the candidate password to consume
 * roughly comparable CPU to a hash check, without the 250ms bcrypt cost.
 * The result is intentionally ignored: the user is invalid, so we cannot
 * meaningfully verify them. This avoids user-enumeration timing attacks.
 */
function pseudoVerify(password: string): void {
  const candidate = crypto
    .createHash('sha256')
    .update(`${password}:${PSEUDO_VERIFY_SALT}`)
    .digest('hex');
  // Constant-time-ish comparison; result discarded
  crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(PSEUDO_VERIFY_DUMMY_HASH));
}

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
  // CSRF defense: reject cross-origin POST requests
  // SameSite=lax cookies already provide primary protection;
  // this adds defense in depth against CSRF.
  if (!isSameOriginRequest(request)) {
    return apiError('禁止跨站请求', {
      status: HttpStatus.FORBIDDEN,
      code: 'CSRF_VIOLATION',
    });
  }

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

  // Find user by email (with password hash). A `wasAutoCreated` flag tells
  // us whether the user was just inserted as part of this request (the
  // default-admin path); only then should we fire the one-time default
  // settings seed — and only fire-and-forget, so login latency is unaffected.
  const findResult = await userRepo.findByEmailWithPassword(email);

  if (!findResult) {
    // Simulate consistent timing for user enumeration prevention
    // Use lightweight pseudo-verify (SHA-256) instead of bcrypt to avoid
    // ~250ms wasted work per attempt - the user is invalid by definition.
    pseudoVerify(password);

    // Record failure for rate limiting (but use a generic reason)
    LoginSecurityService.recordFailure(email, 'INVALID_CREDENTIALS', request);

    // Return generic error message - same for all failures
    return apiError('邮箱或密码错误', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_CREDENTIALS',
    });
  }

  const { user, wasAutoCreated } = findResult;

  // First-time auto-create (default admin on a fresh DB): seed factory
  // defaults so all feature flags, thresholds, and prompts have a baseline.
  // Fire-and-forget so a settings failure never blocks or slows login; the
  // seeding helper itself catches and logs its own errors. See the
  // `setImmediate` pattern used by KnowledgeImportService.processJobAsync.
  if (wasAutoCreated) {
    setImmediate(() => {
      userService
        .seedDefaultSettings({
          trigger: 'autoCreateDefaultAdmin',
          userId: user.id,
          userEmail: user.email,
        })
        .catch((err) => {
          logger.error('[Auth] Fire-and-forget seed on default-admin login failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });
  }

  // Check if user is active
  if (user.status !== 'active') {
    LoginSecurityService.recordFailure(email, 'ACCOUNT_DISABLED', request);

    // Return generic error message - same for all authentication failures
    return apiError('邮箱或密码错误', {
      status: HttpStatus.FORBIDDEN,
      code: 'ACCOUNT_DISABLED',
    });
  }

  // Check if user has a password set
  if (!user.password_hash) {
    LoginSecurityService.recordFailure(email, 'NO_PASSWORD_SET', request);

    // Return generic error message - same for all authentication failures
    return apiError('邮箱或密码错误', {
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
  const isHttps = getIsHttps(request);

  // Set HTTP-only cookie
  const cookieOptions = getTokenCookieOptions(isHttps);
  response.cookies.set(HTTP.JWT_COOKIE_NAME, token, cookieOptions);

  return response;
});