/**
 * POST /api/auth/logout
 * Clear authentication cookie and log out user
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { getIsHttps, isSameOriginRequest } from '@/lib/auth/proxy-utils';
import { HTTP } from '@/lib/constants';

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

  const response = apiSuccess({ success: true });

  // Determine if request is HTTPS for secure cookie
  const isHttps = getIsHttps(request);

  // Clear auth_token cookie
  response.cookies.set(HTTP.JWT_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,  // Expire immediately
  });

  return response;
});
