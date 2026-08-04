import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const service = new KnowledgeGapService();

export const GET = withApi(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async () => {
    const stats = await service.getStats();
    return new Response(JSON.stringify({ ok: true, stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
