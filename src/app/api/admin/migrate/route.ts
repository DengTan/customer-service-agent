/**
 * POST /api/admin/migrate
 *
 * Stage A / A6: deprecated. Migrate via the Supabase CLI / scheduled jobs
 * instead. Returns 410 Gone so any stale callers fail loud and visible.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      type: '/problems/gone',
      title: 'Gone',
      status: 410,
      detail:
        '/api/admin/migrate has been deprecated. Run migrations via the Supabase CLI ' +
        'or the internal scheduler (POST /api/admin/scheduler/run) instead.',
    },
    {
      status: 410,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  );
}

export const GET = POST;
