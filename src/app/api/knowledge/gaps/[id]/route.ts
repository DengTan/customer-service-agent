import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const service = new KnowledgeGapService();

export const GET = withApi(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async ({ params }) => {
    const { id } = params as { id: string };
    const gap = id ? await service.getGap(id) : null;
    return new Response(JSON.stringify({ ok: true, gap }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
