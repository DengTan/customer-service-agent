import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const service = new KnowledgeGapService();

export const GET = withApi(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const minFrequency = url.searchParams.get('min_frequency');
    const limit = url.searchParams.get('limit');
    const search = url.searchParams.get('search');

    const statusFilter = status
      ? (status.split(',').filter(Boolean) as ('open' | 'in_progress' | 'resolved' | 'dismissed')[])
      : undefined;

    const gaps = await service.listGaps({
      status: statusFilter,
      minFrequency: minFrequency ? parseInt(minFrequency, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      search: search ?? undefined,
    });

    const total = await service.countGaps({
      status: statusFilter,
      minFrequency: minFrequency ? parseInt(minFrequency, 10) : undefined,
      search: search ?? undefined,
    });

    return new Response(JSON.stringify({ ok: true, gaps, total }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
