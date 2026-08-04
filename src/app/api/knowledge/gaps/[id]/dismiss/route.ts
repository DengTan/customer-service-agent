import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const service = new KnowledgeGapService();

interface DismissBody {
  notes?: string;
}

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request, params }) => {
    const { id } = params as { id: string };
    if (!id) {
      return new Response(JSON.stringify({ ok: false, error: 'id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json().catch(() => ({})) as DismissBody;
    const gap = await service.dismissGap(id, {
      resolvedBy: id,
      notes: body?.notes,
    });
    return new Response(JSON.stringify({ ok: true, gap }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
