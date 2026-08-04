import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const service = new KnowledgeGapService();

interface ScanBody {
  windowDays?: number;
  dryRun?: boolean;
}

const STOP_WORDS = new Set(['的', '了', '和', '是', '就', '都', '而', '及', '与', '或']);
const MIN_LENGTH = 4;
const MAX_SAMPLES_SEEN = 10000;

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request }) => {
    const body = await request.json().catch(() => ({})) as ScanBody;
    const windowDays = Math.min(Math.max(body?.windowDays ?? 7, 1), 30);
    const dryRun = Boolean(body?.dryRun);

    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const client = getSupabaseClient();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: convs, error: convErr } = await client
      .from('conversations')
      .select('id, status, handoff_reason, message_count, updated_at')
      .gte('updated_at', since);
    if (convErr) {
      return new Response(JSON.stringify({ ok: true, scanned: 0, gaps_found: 0, error: convErr.message }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const convsCount = (convs ?? []).length;
    if (convsCount === 0) {
      return new Response(JSON.stringify({ ok: true, scanned: 0, gaps_found: 0, since, debug: 'no_conversations' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let scanned = 0;
    let gapsFound = 0;
    const sampleSeen = new Set<string>();

    for (const conv of (convs ?? []) as Array<{
      id: string;
      status: string;
      handoff_reason: string | null;
      message_count: number;
      updated_at: string;
    }>) {
      if (sampleSeen.size >= MAX_SAMPLES_SEEN) break;

      const { data: msgs } = await client
        .from('messages')
        .select('id, role, content, sources, conversation_id')
        .eq('conversation_id', conv.id)
        .eq('role', 'user')
        .order('inserted_at', { ascending: true })
        .limit(50);
      if (!msgs) continue;

      for (const m of msgs as Array<{ id: string; content: string; conversation_id: string }>) {
        const content = (m.content || '').trim();
        if (content.length < MIN_LENGTH) continue;
        if (STOP_WORDS.has(content.toLowerCase())) continue;
        scanned += 1;

        const { data: aiMsgs } = await client
          .from('messages')
          .select('sources, confidence')
          .eq('conversation_id', m.conversation_id)
          .eq('role', 'assistant')
          .order('id', { ascending: true })
          .limit(10);
        const userMsgIndex = msgs?.findIndex(msg => msg.id === m.id) ?? -1;
        const ai = (aiMsgs ?? []).find((msg, idx) => idx > userMsgIndex) as { sources?: unknown; confidence?: number } | undefined;
        const sources = (ai?.sources as Array<{ score?: number }> | null) ?? [];
        const topScore = sources.length
          ? Math.max(...sources.map((s) => Number(s.score ?? 0)))
          : null;
        const triggeredHandoff = conv.status === 'handoff' || !!conv.handoff_reason;

        const isGap =
          sources.length === 0 ||
          topScore === null ||
          topScore < 0.5 ||
          triggeredHandoff;

        if (!isGap) continue;

        const hash = service.hashQuestion(content);
        if (sampleSeen.has(hash)) continue;
        sampleSeen.add(hash);

        gapsFound += 1;
        if (!dryRun) {
          await service.analyzeAndRecord({
            userQuestion: content,
            sources: sources as never,
            triggeredHandoff,
            conversationId: conv.id,
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned, gaps_found: gapsFound, window_days: windowDays, dry_run: dryRun }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
