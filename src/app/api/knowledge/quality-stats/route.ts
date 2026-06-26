import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeFeedbackService } from '@/server/services/knowledge-feedback-service';

const feedbackService = new KnowledgeFeedbackService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('item_id') || undefined;
  const minHitRaw = searchParams.get('min_hit');
  const minHit = minHitRaw ? parseInt(minHitRaw, 10) : 0;
  const limitRaw = searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 100;

  const result = await feedbackService.getQualityStats({ item_id: itemId, minHit, limit });
  return apiSuccess(result);
});
