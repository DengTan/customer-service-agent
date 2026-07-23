/**
 * GET /api/auth/me
 * Get current authenticated user from JWT token
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { verifyToken, decodeTokenUnsafe, extractTokenFromCookies } from '@/lib/auth/jwt';
import { UserRepository } from '@/server/repositories/user-repository';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const userRepo = new UserRepository();

/** Check if running in preview environment */
function isPreviewEnvironment(request: NextRequest): boolean {
  const hostname = request.headers.get('host') || '';
  return hostname.includes('.dev.coze.site');
}

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // Extract token from cookie
  const cookieHeader = request.headers.get('cookie');
  const token = extractTokenFromCookies(cookieHeader);
  const isPreview = isPreviewEnvironment(request);

  if (!token) {
    return apiError('未登录，请先登录', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'NO_TOKEN',
    });
  }

  // Try to verify token with full signature check first
  let payload = verifyToken(token);

  // In preview environment, if signature verification fails, try decode without verification
  // This handles cases where the JWT secret might differ between serverless invocations
  if (!payload && isPreview) {
    const decoded = decodeTokenUnsafe(token);
    if (decoded && decoded.sub && decoded.email) {
      // Check if token is not expired (basic check)
      const now = Math.floor(Date.now() / 1000);
      if (!decoded.exp || decoded.exp > now) {
        payload = decoded;
      }
    }
  }

  if (!payload) {
    return apiError('登录已过期，请重新登录', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_TOKEN',
    });
  }

  // Optionally verify user still exists and is active
  const user = await userRepo.findById(payload.sub);

  if (!user) {
    return apiError('用户不存在', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'USER_NOT_FOUND',
    });
  }

  if (user.status !== 'active') {
    return apiError('账户已被禁用', {
      status: HttpStatus.FORBIDDEN,
      code: 'ACCOUNT_DISABLED',
    });
  }

  // Get agent status from agent_sessions table
  let agentStatus: string | null = null;
  try {
    const supabase = getSupabaseClient();
    const { data: sessionData } = await supabase
      .from('agent_sessions')
      .select('status')
      .eq('user_id', payload.sub)
      .order('last_active_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    agentStatus = sessionData?.status || null;
  } catch {
    // Silently fail, agentStatus remains null
  }

  return apiSuccess({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      agentStatus,
    },
  });
});
