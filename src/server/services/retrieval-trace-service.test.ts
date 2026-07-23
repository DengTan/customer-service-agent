/**
 * P3 Phase 1 — Retrieval trace persistence unit tests.
 *
 * Coverage:
 *  - buildFromBundle produces deterministic shape (idempotent given same inputs).
 *  - effective_query_digest is sha256 of normalized query (whitespace trimmed, NFC-normalized).
 *  - persist swallows errors from the Supabase client (mock rejects → still resolves).
 *  - getByMessageId returns the persisted row when the repository returns it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  RetrievalTraceService,
  computeEffectiveQueryDigest,
} from '@/server/services/retrieval-trace-service';
import type { RetrievalTraceRow } from '@/server/repositories/retrieval-trace-repository';
import type { EvidenceBundle, EvidenceTrace } from '@/server/services/retrieval-orchestrator';
import type { RetrievalGateDecision } from '@/server/services/retrieval-gating-service';

function makeDecision(overrides: Partial<RetrievalGateDecision> = {}): RetrievalGateDecision {
  return {
    action: 'retrieve',
    reasonCode: 'answerable',
    effectiveQuery: '如何退货',
    confidence: 0.92,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceTrace> = {}): EvidenceBundle {
  const trace: EvidenceTrace = {
    provenanceVersion: 2,
    retrievalRan: true,
    rerankDegraded: false,
    rerankBackend: 'bge',
    hybridSearch: true,
    candidateCount: 12,
    acceptedCount: 5,
    citationCount: 3,
    minScore: 0.75,
    executionTimeMs: 180,
    degradationReasons: [],
    modelVersion: 'doubao-seed-2-0-lite-260215',
    ...overrides,
  };
  return {
    candidates: [],
    accepted: [],
    citations: [],
    trace,
  };
}

describe('RetrievalTraceService', () => {
  describe('computeEffectiveQueryDigest', () => {
    it('produces a sha256 hex digest', () => {
      const digest = computeEffectiveQueryDigest('hello world');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
      const a = computeEffectiveQueryDigest('退款流程');
      const b = computeEffectiveQueryDigest('退款流程');
      expect(a).toBe(b);
    });

    it('trims leading/trailing whitespace before hashing', () => {
      const a = computeEffectiveQueryDigest('退款流程');
      const b = computeEffectiveQueryDigest('   退款流程   ');
      expect(a).toBe(b);
    });

    it('collapses internal whitespace runs to a single space', () => {
      const a = computeEffectiveQueryDigest('hello world');
      const b = computeEffectiveQueryDigest('hello   world');
      expect(a).toBe(b);
    });

    it('NFC-normalizes Unicode before hashing', () => {
      // 'é' as 'e' + combining accent (decomposed) vs single 'é' (precomposed)
      const decomposed = 'e\u0301';
      const precomposed = '\u00e9';
      const a = computeEffectiveQueryDigest(decomposed);
      const b = computeEffectiveQueryDigest(precomposed);
      expect(a).toBe(b);
    });
  });

  describe('buildFromBundle', () => {
    it('produces a row with all required fields', () => {
      const svc = new RetrievalTraceService();
      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        decision: makeDecision(),
        evidence: makeEvidence(),
        userMessage: '如何退货？',
        botId: 'bot-1',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      });

      expect(row.conversation_id).toBe('conv-1');
      expect(row.message_id).toBe('msg-1');
      expect(row.decision_action).toBe('retrieve');
      expect(row.decision_reason_code).toBe('answerable');
      expect(row.effective_query).toBe('如何退货');
      expect(row.rerank_backend).toBe('bge');
      expect(row.rerank_degraded).toBe(false);
      expect(row.hybrid_search).toBe(true);
      expect(row.candidate_count).toBe(12);
      expect(row.accepted_count).toBe(5);
      expect(row.citation_count).toBe(3);
      expect(row.min_score).toBe(0.75);
      expect(row.model_version).toBe('doubao-seed-2-0-lite-260215');
      expect(row.execution_time_ms).toBe(123);
      expect(row.bot_id).toBe('bot-1');
      expect(row.synthetic_v1_backfill).toBe(false);
      expect(row.trace_started_at).toBe('2023-11-14T22:13:20.000Z');
      expect(row.trace_completed_at).toBe('2023-11-14T22:13:20.123Z');
    });

    it('is idempotent given identical inputs (timestamps aside)', () => {
      const svc = new RetrievalTraceService();
      const args = {
        conversationId: 'conv-1',
        messageId: 'msg-1',
        decision: makeDecision(),
        evidence: makeEvidence(),
        userMessage: '如何退货？',
        botId: 'bot-1',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      };
      const a = svc.buildFromBundle(args);
      const b = svc.buildFromBundle(args);
      expect(a).toEqual(b);
    });

    it('truncates effective_query at 1000 chars for log safety', () => {
      const svc = new RetrievalTraceService();
      const longQuery = '问'.repeat(2000);
      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: null,
        decision: makeDecision({ effectiveQuery: longQuery }),
        evidence: makeEvidence(),
        userMessage: 'long',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      });
      expect(row.effective_query.length).toBeLessThanOrEqual(1001); // 1000 chars + ellipsis
      expect(row.effective_query.endsWith('…')).toBe(true);
    });

    it('computes effective_query_digest matching the helper', () => {
      const svc = new RetrievalTraceService();
      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: null,
        decision: makeDecision({ effectiveQuery: '退款流程' }),
        evidence: makeEvidence(),
        userMessage: '退款',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      });
      expect(row.effective_query_digest).toBe(computeEffectiveQueryDigest('退款流程'));
    });

    it('handles a null botId', () => {
      const svc = new RetrievalTraceService();
      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: null,
        decision: makeDecision(),
        evidence: makeEvidence(),
        userMessage: '如何退货',
        botId: null,
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      });
      expect(row.bot_id).toBeNull();
    });

    it('flips synthetic_v1_backfill when set', () => {
      const svc = new RetrievalTraceService();
      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: null,
        decision: makeDecision(),
        evidence: makeEvidence(),
        userMessage: '如何退货',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
        syntheticV1Backfill: true,
      });
      expect(row.synthetic_v1_backfill).toBe(true);
    });
  });

  describe('persist', () => {
    it('calls repository insert and resolves on success', async () => {
      const insertMock = vi.fn().mockResolvedValue('trace-row-id');
      const fakeRepo = { insert: insertMock } as unknown as ConstructorParameters<typeof RetrievalTraceService>[0];
      const svc = new RetrievalTraceService(fakeRepo);

      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: null,
        decision: makeDecision(),
        evidence: makeEvidence(),
        userMessage: '如何退货',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      });

      await expect(svc.persist(row)).resolves.toBeUndefined();
      expect(insertMock).toHaveBeenCalledTimes(1);
    });

    it('swallows errors from the repository (does NOT throw to caller)', async () => {
      const insertMock = vi.fn().mockRejectedValue(new Error('connection refused'));
      const fakeRepo = { insert: insertMock } as unknown as ConstructorParameters<typeof RetrievalTraceService>[0];
      const svc = new RetrievalTraceService(fakeRepo);

      const row = svc.buildFromBundle({
        conversationId: 'conv-1',
        messageId: null,
        decision: makeDecision(),
        evidence: makeEvidence(),
        userMessage: '如何退货',
        startedAtMs: 1700000000000,
        completedAtMs: 1700000000123,
      });

      // persist must NOT reject — the SSE stream depends on it being best-effort.
      await expect(svc.persist(row)).resolves.toBeUndefined();
    });
  });

  describe('getByMessageId', () => {
    it('returns the row when the repository returns it', async () => {
      const persistedRow: RetrievalTraceRow = {
        id: 'trace-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        decision_action: 'retrieve',
        decision_reason_code: 'answerable',
        effective_query: '如何退货',
        effective_query_digest: 'abc',
        rerank_backend: 'bge',
        rerank_degraded: false,
        hybrid_search: true,
        candidate_count: 10,
        accepted_count: 5,
        citation_count: 3,
        min_score: 0.75,
        model_version: 'doubao',
        execution_time_ms: 100,
        degradation_reasons: [],
        synthetic_v1_backfill: false,
        bot_id: 'bot-1',
        trace_started_at: '2023-11-14T22:13:20.000Z',
        trace_completed_at: '2023-11-14T22:13:20.100Z',
        created_at: '2023-11-14T22:13:20.100Z',
      };
      const getMock = vi.fn().mockResolvedValue(persistedRow);
      const fakeRepo = { getByMessageId: getMock } as unknown as ConstructorParameters<typeof RetrievalTraceService>[0];
      const svc = new RetrievalTraceService(fakeRepo);

      const result = await svc.getByMessageId('msg-1');
      expect(result).toEqual(persistedRow);
    });

    it('returns null when the repository throws (graceful degradation)', async () => {
      const getMock = vi.fn().mockRejectedValue(new Error('db down'));
      const fakeRepo = { getByMessageId: getMock } as unknown as ConstructorParameters<typeof RetrievalTraceService>[0];
      const svc = new RetrievalTraceService(fakeRepo);

      const result = await svc.getByMessageId('msg-1');
      expect(result).toBeNull();
    });
  });
});