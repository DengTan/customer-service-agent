import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import {
  RetrievalTraceRepository,
  type InsertRetrievalTraceParams,
  type RetrievalTraceRow,
} from '@/server/repositories/retrieval-trace-repository';
import type { EvidenceBundle } from './retrieval-orchestrator';
import type { RetrievalGateDecision, ReasonCode } from './retrieval-gating-service';

/**
 * P3 Phase 1 — Retrieval trace persistence.
 *
 * Every assistant message that runs the LLM stream produces a `retrieval_traces`
 * row alongside the existing `messages` row. The trace row contains the
 * `RetrievalGateDecision` and a serialized `EvidenceBundle.trace`, allowing
 * operators to audit, reproduce, and regress-test every citation the assistant
 * emitted.
 *
 * Persist is fire-and-forget and MUST NOT throw to the caller.
 */
export class RetrievalTraceService {
  private readonly repo: RetrievalTraceRepository;

  constructor(repo?: RetrievalTraceRepository) {
    this.repo = repo ?? new RetrievalTraceRepository();
  }

  /**
   * Pure: build a trace row from a decision + evidence bundle + user message.
   * Idempotent: same inputs → same output (modulo timestamps).
   */
  buildFromBundle(args: {
    conversationId: string;
    messageId: string | null;
    decision: RetrievalGateDecision;
    evidence: EvidenceBundle;
    userMessage: string;
    botId?: string | null;
    startedAtMs: number;
    completedAtMs: number;
    syntheticV1Backfill?: boolean;
  }): Omit<RetrievalTraceRow, 'created_at'> {
    const { decision, evidence, userMessage } = args;
    const trace = evidence.trace;
    const effectiveQuery = decision.effectiveQuery ?? '';
    const effectiveQueryDigest = computeEffectiveQueryDigest(effectiveQuery);

    return {
      id: 'trace-' + args.conversationId + '-' + args.startedAtMs.toString(36),
      conversation_id: args.conversationId,
      message_id: args.messageId,
      decision_action: decision.action,
      decision_reason_code: decision.reasonCode,
      effective_query: truncateForLog(effectiveQuery, 1000),
      effective_query_digest: effectiveQueryDigest,
      rerank_backend: trace.rerankBackend ?? 'none',
      rerank_degraded: !!trace.rerankDegraded,
      hybrid_search: !!trace.hybridSearch,
      candidate_count: trace.candidateCount,
      accepted_count: trace.acceptedCount,
      citation_count: trace.citationCount,
      min_score: trace.minScore,
      model_version: trace.modelVersion ?? null,
      execution_time_ms: Math.max(0, args.completedAtMs - args.startedAtMs),
      degradation_reasons: trace.degradationReasons ?? [],
      synthetic_v1_backfill: !!args.syntheticV1Backfill,
      bot_id: args.botId ?? null,
      trace_started_at: new Date(args.startedAtMs).toISOString(),
      trace_completed_at: new Date(args.completedAtMs).toISOString(),
    };
  }

  /**
   * Persist a trace row.
   *
   * Fire-and-forget: errors are swallowed with a warn-level log entry. The
   * caller MUST NOT be blocked by trace failures — the SSE stream must keep
   * flowing even when the trace table is missing or overloaded.
   */
  async persist(row: Omit<RetrievalTraceRow, 'created_at'>): Promise<void> {
    const params: InsertRetrievalTraceParams = {
      conversation_id: row.conversation_id,
      message_id: row.message_id,
      decision_action: row.decision_action,
      decision_reason_code: row.decision_reason_code,
      effective_query: row.effective_query,
      effective_query_digest: row.effective_query_digest,
      rerank_backend: row.rerank_backend,
      rerank_degraded: row.rerank_degraded,
      hybrid_search: row.hybrid_search,
      candidate_count: row.candidate_count,
      accepted_count: row.accepted_count,
      citation_count: row.citation_count,
      min_score: row.min_score,
      model_version: row.model_version,
      execution_time_ms: row.execution_time_ms,
      degradation_reasons: row.degradation_reasons,
      synthetic_v1_backfill: row.synthetic_v1_backfill,
      bot_id: row.bot_id,
      trace_started_at: row.trace_started_at,
    };

    try {
      await this.repo.insert(params);
    } catch (err) {
      logger.api.warn('retrieval-trace-persist-failed', {
        error: err instanceof Error ? err.message : String(err),
        conversationId: row.conversation_id,
        messageId: row.message_id,
      });
    }
  }

  async getByMessageId(messageId: string): Promise<RetrievalTraceRow | null> {
    try {
      return await this.repo.getByMessageId(messageId);
    } catch (err) {
      logger.api.warn('retrieval-trace-get-by-message-id-failed', {
        error: err instanceof Error ? err.message : String(err),
        messageId,
      });
      return null;
    }
  }

  async getByConversationId(
    conversationId: string,
    opts: { limit: number; beforeMs?: number },
  ): Promise<RetrievalTraceRow[]> {
    try {
      return await this.repo.getByConversationId(conversationId, opts);
    } catch (err) {
      logger.api.warn('retrieval-trace-get-by-conversation-id-failed', {
        error: err instanceof Error ? err.message : String(err),
        conversationId,
      });
      return [];
    }
  }

  async listRecent(opts: { limit: number; rerankBackend?: string }): Promise<RetrievalTraceRow[]> {
    try {
      return await this.repo.listRecent(opts);
    } catch (err) {
      logger.api.warn('retrieval-trace-list-recent-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

/**
 * SHA-256 hex of the normalized effective query.
 *
 * Normalization rules:
 *   - trim leading/trailing whitespace
 *   - NFC-normalize Unicode
 *   - collapse internal whitespace runs to a single space
 *
 * The digest is indexed (`retrieval_traces_digest_idx`) so traces are
 * searchable by query without PII risk.
 */
export function computeEffectiveQueryDigest(query: string): string {
  const normalized = query
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

function truncateForLog(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export type { RetrievalTraceRow } from '@/server/repositories/retrieval-trace-repository';
export type { ReasonCode };