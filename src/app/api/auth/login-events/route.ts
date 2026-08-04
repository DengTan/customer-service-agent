/**
 * GET /api/auth/login-events
 * Admin API: Get recent login events for security monitoring
 */
import { withApi } from '@/lib/api/with-api';
import { LoginSecurityService } from '@/lib/auth/login-security';

export const GET = withApi(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit') || '50';
    const limit = Math.min(parseInt(limitParam, 10), 100);

    const events = LoginSecurityService.getRecentEvents(limit);

    return new Response(JSON.stringify({ ok: true, events, total: events.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
