import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const gapService = new KnowledgeGapService();

interface PromoteBody {
  category?: string;
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

    const body = await request.json().catch(() => ({})) as PromoteBody;
    const gap = await gapService.getGap(id);
    if (!gap) {
      return new Response(JSON.stringify({ ok: false, error: 'gap not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (gap.status === 'in_progress') {
      return new Response(JSON.stringify({ ok: false, error: '缺口已在处理中' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (gap.status === 'resolved') {
      return new Response(JSON.stringify({ ok: false, error: '缺口已解决，不能转入学习队列' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('knowledge_learning_queue')
      .insert({
        question: gap.sample_question,
        answer: '',
        confidence: gap.last_top_score ?? 0,
        conversation_id: gap.source_conversation_ids?.[0] ?? null,
        conversation_title: '来自知识缺口',
        source_context: {
          from_gap_id: gap.id,
          from_gap_hash: gap.question_hash,
          from_gap_frequency: gap.frequency,
        },
        category: body?.category ?? gap.question_category ?? '待定',
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatedGap = await gapService.startProgress(gap.id);
    return new Response(JSON.stringify({ ok: true, candidate_id: (data as { id: string })?.id, gap: updatedGap }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
