/**
 * POST /api/auth/logout
 * Clear authentication cookie and log out user
 */

import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const response = apiSuccess({ success: true });

  // Determine if request is HTTPS for secure cookie
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const isHttps = forwardedProto === 'https' || request.url.startsWith('https://');

  // Clear auth_token cookie
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,  // Expire immediately
  });

  return response;
});
