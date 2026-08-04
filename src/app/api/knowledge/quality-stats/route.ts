import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeFeedbackService } from '@/server/services/knowledge-feedback-service';

const feedbackService = new KnowledgeFeedbackService();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('item_id') || undefined;
    const minHitRaw = searchParams.get('min_hit');
    const minHit = minHitRaw ? parseInt(minHitRaw, 10) : 0;
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 100;

    const result = await feedbackService.getQualityStats({ item_id: itemId, minHit, limit });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
