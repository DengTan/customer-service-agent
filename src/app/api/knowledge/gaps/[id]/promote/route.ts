import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandler, requireRole } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const ADMIN_ONLY = ['admin'];
const gapService = new KnowledgeGapService();

interface PromoteBody {
  category?: string;
}

/**
 * Convert a knowledge gap into a candidate in knowledge_learning_queue.
 * The admin/agent can then review it like any other learning candidate.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!id) return apiSuccess({ success: false, error: 'id is required' });

  const { data: body } = await parseJsonBody<PromoteBody>(request);
  const gap = await gapService.getGap(id);
  if (!gap) {
    return apiSuccess({ success: false, error: 'gap not found' });
  }

  const { getSupabaseClient } = await import('@/storage/database/supabase-client');
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('knowledge_learning_queue')
    .insert({
      question: gap.sample_question,
      answer: '', // empty — agent must fill in
      confidence: gap.last_top_score ?? 0,
      conversation_id: gap.source_conversation_ids?.[0] ?? null,
      conversation_title: '来自知识缺口',
      source_context: JSON.stringify({
        from_gap_id: gap.id,
        from_gap_hash: gap.question_hash,
        from_gap_frequency: gap.frequency,
      }),
      category: body?.category ?? gap.question_category ?? '待定',
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) {
    return apiSuccess({ success: false, error: error.message });
  }

  // Mark the gap as in_progress and link to the new candidate
  const updatedGap = await gapService.startProgress(gap.id);

  return apiSuccess({ success: true, candidate_id: (data as { id: string })?.id, gap: updatedGap });
});
