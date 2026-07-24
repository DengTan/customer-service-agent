/**
 * GET /api/auth/me
 * Get current authenticated user from JWT token
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { verifyToken, extractTokenFromCookies } from '@/lib/auth/jwt';
import { UserRepository } from '@/server/repositories/user-repository';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const userRepo = new UserRepository();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // Extract token from cookie
  const cookieHeader = request.headers.get('cookie');
  const token = extractTokenFromCookies(cookieHeader);

  if (!token) {
    return apiError('未登录，请先登录', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'NO_TOKEN',
    });
  }

  const payload = verifyToken(token);

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
