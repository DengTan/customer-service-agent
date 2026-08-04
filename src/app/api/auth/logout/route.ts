/**
 * POST /api/auth/logout
 * Clear authentication cookie and log out user
 */
import { withApi } from '@/lib/api/with-api';
import { getIsHttps, isSameOriginRequest } from '@/lib/auth/proxy-utils';
import { HTTP } from '@/lib/constants';

export const POST = withApi(
  { auth: 'public' },
  async ({ request }) => {
    if (!isSameOriginRequest(request)) {
      return new Response(JSON.stringify({ ok: false, error: '禁止跨站请求', code: 'CSRF_VIOLATION' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isHttps = getIsHttps(request);

    return new Response(JSON.stringify({ ok: true, success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${HTTP.JWT_COOKIE_NAME}=; HttpOnly; Secure=${isHttps}; SameSite=Lax; Path=/; Max-Age=0`,
      },
    });
  },
);
