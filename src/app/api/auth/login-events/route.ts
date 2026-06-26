/**
 * GET /api/auth/login-events
 * Admin API: Get recent login events for security monitoring
 * 
 * Only accessible to admin role
 */
import { NextRequest } from 'next/server';
import { requireRole, withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { LoginSecurityService } from '@/lib/auth/login-security';

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // Check admin permission
  const authResponse = await requireRole(request, ['admin']);
  if (authResponse) return authResponse;

  // Get query params
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const limitParam = searchParams.get('limit') || '50';
  const limit = Math.min(parseInt(limitParam, 10), 100);
  
  const events = LoginSecurityService.getRecentEvents(limit);

  return apiSuccess({
    events,
    total: events.length,
  });
});
