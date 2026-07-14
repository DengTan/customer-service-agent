import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { KnowledgeGapService } from '@/server/services/knowledge-gap-service';

const ADMIN_ONLY = ['admin'];
const service = new KnowledgeGapService();

interface ScanBody {
  windowDays?: number;
  dryRun?: boolean;
}

const STOP_WORDS = new Set(['的', '了', '和', '是', '就', '都', '而', '及', '与', '或']);
const MIN_LENGTH = 4;

/**
 * Manually trigger a gap analysis. Scans user messages from the last `windowDays` days
 * whose associated AI response had no/weak sources or triggered handoff.
 *
 * For V1 this is an OPT-IN admin tool; the realtime path (called from the messages route)
 * is the primary source of new signals.
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body } = await parseJsonBody<ScanBody>(request);
  const windowDays = Math.min(Math.max(body?.windowDays ?? 7, 1), 30);
  const dryRun = Boolean(body?.dryRun);

  const { getSupabaseClient } = await import('@/storage/database/supabase-client');
  const client = getSupabaseClient();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Find user messages in the window whose conversation had at least one AI response
  // with empty/weak sources OR a handoff event.
  const { data: convs, error: convErr } = await client
    .from('conversations')
    .select('id, status, handoff_reason, message_count, updated_at')
    .gte('updated_at', since);
  if (convErr) {
    return apiSuccess({ scanned: 0, gaps_found: 0, error: convErr.message });
  }
  const convsCount = (convs ?? []).length;
  if (convsCount === 0) {
    return apiSuccess({ scanned: 0, gaps_found: 0, since, debug: 'no_conversations' });
  }

  let scanned = 0;
  let gapsFound = 0;
  const sampleSeen = new Set<string>(); // dedupe within scan batch

  for (const conv of (convs ?? []) as Array<{
    id: string;
    status: string;
    handoff_reason: string | null;
    message_count: number;
    updated_at: string;
  }>) {
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

      // Find the AI response that followed this user message
      const { data: aiMsgs } = await client
        .from('messages')
        .select('sources, confidence')
        .eq('conversation_id', m.conversation_id)
        .eq('role', 'assistant')
        .gt('inserted_at', m.id ? '1970-01-01' : '1970-01-01') // safety
        .order('inserted_at', { ascending: true })
        .limit(1);
      const ai = (aiMsgs ?? [])[0] as { sources?: unknown; confidence?: number } | undefined;
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

  return apiSuccess({ scanned, gaps_found: gapsFound, window_days: windowDays, dry_run: dryRun });
});
