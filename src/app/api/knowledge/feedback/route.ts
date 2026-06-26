import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { KnowledgeFeedbackService } from '@/server/services/knowledge-feedback-service';

const feedbackService = new KnowledgeFeedbackService();

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { message_id, conversation_id, knowledge_item_id, knowledge_name, knowledge_score, feedback_type, reason, comment } = body ?? {};

  const result = await feedbackService.recordFeedback({
    message_id,
    conversation_id: conversation_id ?? null,
    knowledge_item_id: knowledge_item_id ?? null,
    knowledge_name: knowledge_name ?? null,
    knowledge_score: knowledge_score ?? null,
    feedback_type,
    reason: reason ?? null,
    comment: comment ?? null,
  });
  return apiSuccess(result, 201);
});
