/**
 * P3 Phase 2 — Provenance governance pure-function tests.
 *
 * Coverage:
 *  - v2 citation → kept untouched
 *  - v1 citation, no trace → suppressed, reason stale_trace
 *  - v1 citation, fresh trace, chunk_id present in knownChunkIds → kept, version rewritten to 2
 *  - v1 citation, fresh trace, chunk_id present but NOT in knownChunkIds → invalidated
 *  - v1 citation, fresh trace, no chunk_id, knowledge_item_id NOT in knownItemIds → invalidated
 *  - v1 citation, fresh trace, no chunk_id, knowledge_item_id in knownItemIds → kept, version rewritten to 2
 *  - Deterministic: two calls with same inputs produce equal outputs
 */

import { describe, it, expect } from 'vitest';
import { governProvenance } from '@/server/services/provenance-governance';
import type { PublicCitationItem } from '@/server/services/llm-streaming-service';
import type { RetrievalTraceRow } from '@/server/repositories/retrieval-trace-repository';

function makeCitation(overrides: Partial<PublicCitationItem> = {}): PublicCitationItem {
  return {
    type: 'knowledge',
    score: 0.92,
    provenanceVersion: 2,
    ...overrides,
  };
}

function makeTrace(overrides: Partial<RetrievalTraceRow> = {}): RetrievalTraceRow {
  const now = new Date();
  return {
    id: 'trace-1',
    conversation_id: 'conv-1',
    message_id: 'msg-1',
    decision_action: 'retrieve',
    decision_reason_code: 'answerable',
    effective_query: '退货',
    effective_query_digest: 'abc',
    rerank_backend: 'bge',
    rerank_degraded: false,
    hybrid_search: true,
    candidate_count: 8,
    accepted_count: 5,
    citation_count: 3,
    min_score: 0.75,
    model_version: null,
    execution_time_ms: 100,
    degradation_reasons: [],
    synthetic_v1_backfill: false,
    bot_id: null,
    trace_started_at: now.toISOString(),
    trace_completed_at: now.toISOString(),
    created_at: now.toISOString(),
    ...overrides,
  };
}

const NOW_MS = 1700000000000; // 2023-11-14 22:13:20 UTC

describe('governProvenance', () => {
  // -------------------------------------------------------------------------
  // Rule 1: v2
  // -------------------------------------------------------------------------
  describe('v2 citations', () => {
    it('v2 → kept as trusted_v2 (provenanceVersion untouched)', () => {
      const citations = [makeCitation({ provenanceVersion: 2 })];
      const result = governProvenance(citations, { nowMs: NOW_MS });
      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].provenanceVersion).toBe(2);
      expect(result.suppressed).toHaveLength(0);
    });

    it('v2 citation is not mutated — original reference unchanged', () => {
      const original = makeCitation({ provenanceVersion: 2 });
      const citations = [original];
      governProvenance(citations, { nowMs: NOW_MS });
      expect(original.provenanceVersion).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 2: v1, no trace
  // -------------------------------------------------------------------------
  describe('v1 citations with no trace', () => {
    it('undefined provenanceVersion (defaults to 1) → suppressed stale_trace', () => {
      const citations = [makeCitation({ provenanceVersion: undefined })];
      const result = governProvenance(citations, { nowMs: NOW_MS });
      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(1);
      expect(result.suppressed[0]).toEqual({ kind: 'suppress_with_legacy_badge', originalVersion: 1, reason: 'stale_trace' });
    });

    it('v1 + no trace → suppressed stale_trace', () => {
      const citations = [makeCitation({ provenanceVersion: 1 })];
      const result = governProvenance(citations, { nowMs: NOW_MS });
      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(1);
      expect(result.suppressed[0]).toMatchObject({ kind: 'suppress_with_legacy_badge', reason: 'stale_trace' });
    });

    it('v1 + trace map present but no entry for this citation → suppressed', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1' })];
      const traceByMsgId = new Map<string, RetrievalTraceRow>();
      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId });
      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(1);
      expect(result.suppressed[0]).toMatchObject({ kind: 'suppress_with_legacy_badge', reason: 'stale_trace' });
    });
  });

  // -------------------------------------------------------------------------
  // Rule 3: v1, fresh trace + chunk_id valid
  // -------------------------------------------------------------------------
  describe('v1 citations with fresh trace and valid chunk_id', () => {
    it('v1 + fresh trace + chunk_id in knownChunkIds → kept, provenanceVersion rewritten to 2', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: 'chunk-abc' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);
      const knownChunkIds = new Set(['chunk-abc']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownChunkIds });

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].provenanceVersion).toBe(2);
      expect(result.suppressed).toHaveLength(0);
    });

    it('v1 + fresh trace + chunk_id in knownChunkIds — version rewritten is a NEW object', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: 'chunk-abc' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);
      const knownChunkIds = new Set(['chunk-abc']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownChunkIds });

      // The original citation must NOT be mutated.
      expect(citations[0].provenanceVersion).toBe(1);
      // The kept copy must have version 2.
      expect(result.kept[0].provenanceVersion).toBe(2);
    });

    it('v1 + fresh trace + chunk_id in knownChunkIds (no knownChunkIds provided) → kept optimistically', () => {
      // When knownChunkIds is absent, we take the optimistic path for v1 citations
      // with a chunk_id present (rule 6 — assume it still exists).
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: 'chunk-abc' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId });

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].provenanceVersion).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 4: v1, fresh trace + chunk_id gone
  // -------------------------------------------------------------------------
  describe('v1 citations with fresh trace but chunk_id not in knownChunkIds', () => {
    it('chunk_id NOT in knownChunkIds → invalidated chunk_identity_gone', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: 'chunk-gone' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);
      const knownChunkIds = new Set(['chunk-other']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownChunkIds });

      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(1);
      expect(result.suppressed[0]).toMatchObject({ kind: 'invalidated_v1', reason: 'chunk_identity_gone' });
    });
  });

  // -------------------------------------------------------------------------
  // Rule 5: v1, fresh trace + no chunk_id + item_id gone
  // -------------------------------------------------------------------------
  describe('v1 citations with fresh trace but no chunk_id and item_id not in knownItemIds', () => {
    it('no chunk_id + knowledge_item_id NOT in knownItemIds → invalidated', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: null, knowledge_item_id: 'item-gone' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);
      const knownItemIds = new Set(['item-other']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownItemIds });

      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(1);
      expect(result.suppressed[0]).toMatchObject({ kind: 'invalidated_v1', reason: 'chunk_identity_gone' });
    });
  });

  // -------------------------------------------------------------------------
  // Rule 6: v1, fresh trace + no chunk_id + item_id valid
  // -------------------------------------------------------------------------
  describe('v1 citations with fresh trace, no chunk_id, but item_id in knownItemIds', () => {
    it('no chunk_id + knowledge_item_id in knownItemIds → kept, rewritten to v2', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: null, knowledge_item_id: 'item-abc' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);
      const knownItemIds = new Set(['item-abc']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownItemIds });

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].provenanceVersion).toBe(2);
    });

    it('no chunk_id + no knownItemIds provided → kept optimistically', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: null, knowledge_item_id: 'item-abc' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['msg-1', trace]]);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId });

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].provenanceVersion).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Freshness threshold (Rule 2 extended)
  // -------------------------------------------------------------------------
  describe('v1 trace freshness', () => {
    it('trace older than 24h → suppressed stale_trace (same as no trace)', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 25 * 60 * 60 * 1000).toISOString() }); // 25h ago
      const traceByMsgId = new Map([['msg-1', trace]]);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId });

      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(1);
      expect(result.suppressed[0]).toMatchObject({ kind: 'suppress_with_legacy_badge', reason: 'stale_trace' });
    });

    it('trace at exactly 24h boundary → kept (fresh within threshold)', () => {
      const citations = [makeCitation({ provenanceVersion: 1, id: 'msg-1', chunk_id: 'chunk-abc' })];
      const trace = makeTrace({ message_id: 'msg-1', created_at: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString() }); // exactly 24h
      const traceByMsgId = new Map([['msg-1', trace]]);
      const knownChunkIds = new Set(['chunk-abc']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownChunkIds });

      expect(result.kept).toHaveLength(1);
      expect(result.kept[0].provenanceVersion).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed citations
  // -------------------------------------------------------------------------
  describe('mixed citations (v2 + v1 various states)', () => {
    it('handles a mix of v2, v1-trusted, and v1-suppressed correctly', () => {
      const citations: PublicCitationItem[] = [
        makeCitation({ provenanceVersion: 2, id: 'c1' }),
        makeCitation({ provenanceVersion: 1, id: 'c2', chunk_id: 'chunk-abc' }),
        makeCitation({ provenanceVersion: 1, id: 'c3', chunk_id: null }), // no trace → suppressed
        makeCitation({ provenanceVersion: 1, id: 'c4', chunk_id: 'chunk-gone' }), // chunk gone
      ];
      const traceC2 = makeTrace({ message_id: 'c2', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceC4 = makeTrace({ message_id: 'c4', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['c2', traceC2], ['c4', traceC4]]);
      const knownChunkIds = new Set(['chunk-abc']);

      const result = governProvenance(citations, { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownChunkIds });

      expect(result.kept).toHaveLength(2);
      expect(result.kept.find(c => c.id === 'c1')?.provenanceVersion).toBe(2);
      expect(result.kept.find(c => c.id === 'c2')?.provenanceVersion).toBe(2);
      expect(result.suppressed).toHaveLength(2);
      expect(result.suppressed[0]).toMatchObject({ kind: 'suppress_with_legacy_badge', reason: 'stale_trace' });
      expect(result.suppressed[1]).toMatchObject({ kind: 'invalidated_v1', reason: 'chunk_identity_gone' });
    });
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------
  describe('determinism', () => {
    it('two calls with identical inputs produce equal outputs', () => {
      const citations = [
        makeCitation({ provenanceVersion: 1, id: 'c1', chunk_id: 'chunk-abc' }),
        makeCitation({ provenanceVersion: 1, id: 'c2', chunk_id: null }),
        makeCitation({ provenanceVersion: 2, id: 'c3' }),
      ];
      const traceC1 = makeTrace({ message_id: 'c1', created_at: new Date(NOW_MS - 1000).toISOString() });
      const traceByMsgId = new Map([['c1', traceC1]]);
      const knownChunkIds = new Set(['chunk-abc']);
      const opts = { nowMs: NOW_MS, traceByMessageId: traceByMsgId, knownChunkIds };

      const a = governProvenance(citations, opts);
      const b = governProvenance(citations, opts);

      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('empty citations array → empty result', () => {
      const result = governProvenance([], { nowMs: NOW_MS });
      expect(result.kept).toHaveLength(0);
      expect(result.suppressed).toHaveLength(0);
    });
  });
});
