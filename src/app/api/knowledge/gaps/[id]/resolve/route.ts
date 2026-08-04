import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const service = new KnowledgeGapService();

interface ResolveBody {
  linkedKnowledgeItemId?: string;
  linked_knowledge_item_id?: string;
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

    const body = await request.json().catch(() => ({})) as ResolveBody;

    const gap = await service.resolveGap(id, {
      resolvedBy: id,
      linkedKnowledgeItemId: body?.linkedKnowledgeItemId ?? body?.linked_knowledge_item_id,
      notes: body?.notes,
    });
    return new Response(JSON.stringify({ ok: true, gap }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
