/**
 * Admin migration API
 */
import { withApi } from '@/lib/api/with-api';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    return new Response(JSON.stringify({
      type: '/problems/gone',
      title: 'Gone',
      status: 410,
      detail:
        '/api/admin/migrate has been deprecated. Run migrations via the Supabase CLI ' +
        'or the internal scheduler (POST /api/admin/scheduler/run) instead.',
    }), {
      status: 410,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    return new Response(JSON.stringify({
      type: '/problems/gone',
      title: 'Gone',
      status: 410,
      detail:
        '/api/admin/migrate has been deprecated. Run migrations via the Supabase CLI ' +
        'or the internal scheduler (POST /api/admin/scheduler/run) instead.',
    }), {
      status: 410,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  },
);
