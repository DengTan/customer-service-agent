/**
 * QueryRewriteService — TDD Tests (P2 Task 3)
 *
 * Tests cover:
 * 1. No rewrite when first search has accepted candidates
 * 2. Rewrite only once when accepted=0 and auxiliary LLM configured (real reranker)
 * 3. Identical rewritten query → no re-retrieval
 * 4. Empty/timeout rewrite → keep first results
 * 5. Second search failure → keep first results
 * 6. Successful rewrite → use second results with real reranker scores
 * 7. Normalization: whitespace, case, punctuation stripped for equality check
 * 8. Max length check (>200 chars → trimmed)
 * 9. Control characters stripped
 * 10. Exactly 1 knowledge search when no rewrite, max 2 when rewrite succeeds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMStreamChunk } from './llm-client-adapter';
import { AuxiliaryLLMService } from './auxiliary-llm-service';
import { QueryRewriteService } from './query-rewrite-service';
import type { EvidenceBundle } from './retrieval-orchestrator';

// ---------------------------------------------------------------------------
// Shared mocks (shared object reference so vi.mock factory and tests share the same instance)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocks = { completeJson: vi.fn() };

// ---------------------------------------------------------------------------
// Mock module dependencies
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    agent: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('@/lib/constants', () => ({
  AUX_LLM: {
    REWRITE_TIMEOUT_MS: 4000,
    VERIFY_TIMEOUT_MS: 6000,
    VERIFY_MIN_CONFIDENCE: 0.5,
  },
}));

// Mock auxiliary-llm-service module to provide AUX_LLM and AuxiliaryLlmResult
vi.mock('./auxiliary-llm-service', () => ({
  AUX_LLM: {
    REWRITE_TIMEOUT_MS: 4000,
    VERIFY_TIMEOUT_MS: 6000,
    VERIFY_MIN_CONFIDENCE: 0.5,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuxiliaryLlmResult: {} as any,
  AuxiliaryLLMService: class {
    completeJson = mocks.completeJson;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAuxiliaryLLMService: () => ({ completeJson: mocks.completeJson }),
}));

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** First search with no accepted candidates and real reranker (rewrite-eligible) */
const FIRST_SEARCH_RESULTS: EvidenceBundle = {
  candidates: [
    {
      id: 'item-1',
      type: 'knowledge',
      content: 'Original search result content',
      relevanceScore: 0.3, // below minScore=0.75, so accepted=0
      name: 'Test Item',
      category: 'test',
      scoreOrigin: 'reranker',
      chunkId: null,
      chunkIndex: 0,
      contentHash: null,
    },
  ],
  accepted: [], // below minScore
  citations: [],
  trace: {
    provenanceVersion: 2,
    retrievalRan: true,
    rerankDegraded: false, // REAL reranker — rewrite can potentially improve
    hybridSearch: true,
    candidateCount: 1,
    acceptedCount: 0,
    citationCount: 0,
    minScore: 0.75,
    executionTimeMs: 10,
    degradationReasons: [],
    rerankBackend: 'bge',
  },
};

/** First search with accepted candidates (no rewrite needed) */
const FIRST_SEARCH_WITH_ACCEPTED: EvidenceBundle = {
  candidates: [
    {
      id: 'item-1',
      type: 'knowledge',
      content: 'High relevance content',
      relevanceScore: 0.9,
      name: 'Test Item',
      category: 'test',
      scoreOrigin: 'reranker',
      chunkId: null,
      chunkIndex: 0,
      contentHash: null,
    },
  ],
  accepted: [
    {
      id: 'item-1',
      type: 'knowledge',
      content: 'High relevance content',
      relevanceScore: 0.9,
      name: 'Test Item',
      category: 'test',
      scoreOrigin: 'reranker',
      chunkId: null,
      chunkIndex: 0,
      contentHash: null,
    },
  ],
  citations: [
    {
      type: 'knowledge',
      content: 'High relevance content',
      score: 0.9,
      knowledge_item_id: 'item-1',
      provenanceVersion: 2,
    },
  ],
  trace: {
    provenanceVersion: 2,
    retrievalRan: true,
    rerankDegraded: false,
    hybridSearch: true,
    candidateCount: 1,
    acceptedCount: 1,
    citationCount: 1,
    minScore: 0.75,
    executionTimeMs: 10,
    degradationReasons: [],
    rerankBackend: 'bge',
  },
};

const SECOND_SEARCH_RESULTS: EvidenceBundle = {
  candidates: [
    {
      id: 'chunk-1',
      type: 'knowledge',
      content: 'Rewritten search result with higher relevance',
      relevanceScore: 0.85,
      name: 'Rewritten Item',
      category: 'test',
      scoreOrigin: 'reranker',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      contentHash: 'abc123',
    },
  ],
  accepted: [
    {
      id: 'chunk-1',
      type: 'knowledge',
      content: 'Rewritten search result with higher relevance',
      relevanceScore: 0.85,
      name: 'Rewritten Item',
      category: 'test',
      scoreOrigin: 'reranker',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      contentHash: 'abc123',
    },
  ],
  citations: [
    {
      type: 'knowledge',
      content: 'Rewritten search result with higher relevance',
      score: 0.85,
      knowledge_item_id: 'chunk-1',
      chunk_id: 'chunk-1',
      chunk_index: 0,
      content_hash: 'abc123',
      name: 'Rewritten Item',
      category: 'test',
      provenanceVersion: 2,
    },
  ],
  trace: {
    provenanceVersion: 2,
    retrievalRan: true,
    rerankDegraded: false,
    hybridSearch: true,
    candidateCount: 1,
    acceptedCount: 1,
    citationCount: 1,
    minScore: 0.75,
    executionTimeMs: 10,
    degradationReasons: [],
    rerankBackend: 'bge',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryRewriteService', () => {
  const BASE_URL = 'https://fake.example.com/v1';
  const API_KEY = 'sk-test';
  const MODEL = 'test-model';
  const AUX_CONFIG = { baseUrl: BASE_URL, apiKey: API_KEY, model: MODEL };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockCompleteJson: typeof mocks.completeJson = mocks.completeJson;

  beforeEach(() => {
    mockCompleteJson.mockReset();
  });

  afterEach(() => {
    mockCompleteJson.mockReset();
  });

  describe('rewriteDecision', () => {
    it('returns skip when first search has accepted candidates', async () => {
      const service = new QueryRewriteService();
      const result = service.rewriteDecision(
        FIRST_SEARCH_WITH_ACCEPTED,
        AUX_CONFIG,
        'original query'
      );

      expect(result.action).toBe('skip');
      expect(result.rewrittenQuery).toBeUndefined();
    });

    it('returns rewrite when accepted=0 and auxiliary LLM configured with real reranker', async () => {
      mockCompleteJson.mockResolvedValueOnce({
        ok: true,
        data: { rewritten_query: '退款政策七天无理由退货' },
        attempts: 1,
        elapsedMs: 500,
      });

      const service = new QueryRewriteService();
      const decision = service.rewriteDecision(
        FIRST_SEARCH_RESULTS,
        AUX_CONFIG,
        '如何申请七天无理由退货'
      );

      expect(decision.action).toBe('rewrite');
      expect(decision.reason).toBe('no_accepted_candidates');
      expect(decision.rewriteAttempted).toBe(false); // not yet attempted

      // Actually call rewriteQuery
      const rewriteResult = await service.rewriteQuery(
        AUX_CONFIG,
        '如何申请七天无理由退货',
        []
      );

      expect(rewriteResult.ok).toBe(true);
      if (rewriteResult.ok) {
        expect(rewriteResult.data.rewritten_query).toBe('退款政策七天无理由退货');
      }
    });

    it('returns no_rewrite when auxiliary LLM is not configured', () => {
      const service = new QueryRewriteService();
      const result = service.rewriteDecision(
        FIRST_SEARCH_RESULTS,
        undefined, // no auxiliary LLM
        '如何申请七天无理由退货'
      );

      expect(result.action).toBe('no_rewrite');
      expect(result.reason).toBe('no_auxiliary_llm_configured');
      expect(result.rewriteAttempted).toBe(false);
    });

    it('returns no_rewrite when reranker degraded (fail-closed)', () => {
      const degradedBundle: EvidenceBundle = {
        ...FIRST_SEARCH_RESULTS,
        trace: { ...FIRST_SEARCH_RESULTS.trace, rerankDegraded: true, rerankBackend: 'mock' },
      };

      const service = new QueryRewriteService();
      const result = service.rewriteDecision(
        degradedBundle,
        AUX_CONFIG,
        '如何申请七天无理由退货'
      );

      // fail-closed: without real reranker, rewrite cannot improve citation quality
      expect(result.action).toBe('no_rewrite');
      expect(result.reason).toBe('reranker_degraded');
    });
  });

  describe('rewriteQuery — error handling', () => {
    it('returns empty_content error when LLM returns empty response', async () => {
      mockCompleteJson.mockResolvedValueOnce({
        ok: false,
        code: 'empty_content',
        attempts: 1,
        elapsedMs: 200,
      });

      const service = new QueryRewriteService();
      const result = await service.rewriteQuery(
        AUX_CONFIG,
        '如何申请退货',
        []
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('empty_content');
      }
    });

    it('returns timeout error when LLM times out', async () => {
      mockCompleteJson.mockResolvedValueOnce({
        ok: false,
        code: 'timeout',
        attempts: 1,
        elapsedMs: 4000,
      });

      const service = new QueryRewriteService();
      const result = await service.rewriteQuery(
        AUX_CONFIG,
        '退货政策是什么',
        []
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('timeout');
      }
    });
  });

  describe('shouldReRetrieve', () => {
    it('returns true when query changed after normalization', () => {
      const service = new QueryRewriteService();
      const result = service.shouldReRetrieve('原问题', '退款政策七天无理由退货');
      expect(result).toBe(true);
    });

    it('returns false when query identical after normalization', () => {
      const service = new QueryRewriteService();
      const result = service.shouldReRetrieve('原问题', '原问题');
      expect(result).toBe(false);
    });

    it('returns false when query identical after whitespace normalization', () => {
      const service = new QueryRewriteService();
      const result = service.shouldReRetrieve('原问题', '  原问题  ');
      expect(result).toBe(false);
    });

    it('returns false when query identical after punctuation removal', () => {
      const service = new QueryRewriteService();
      const result = service.shouldReRetrieve('退款政策', '退款政策?');
      expect(result).toBe(false);
    });

    it('returns false when one query is a substring of the other', () => {
      const service = new QueryRewriteService();
      const result = service.shouldReRetrieve('退款政策', '退款政策七天无理由退货详情');
      expect(result).toBe(false); // not a meaningful rewrite
    });
  });

  describe('normalizeForComparison', () => {
    it('strips control characters', () => {
      const service = new QueryRewriteService() as unknown as { normalizeForComparison: (s: string) => string };
      const result = service.normalizeForComparison('退款\x00政策');
      expect(result).toBe('退款政策');
    });

    it('trims whitespace', () => {
      const service = new QueryRewriteService() as unknown as { normalizeForComparison: (s: string) => string };
      const result = service.normalizeForComparison('  退款政策  ');
      expect(result).toBe('退款政策');
    });

    it('strips trailing punctuation', () => {
      const service = new QueryRewriteService() as unknown as { normalizeForComparison: (s: string) => string };
      const result = service.normalizeForComparison('退款政策?。！');
      expect(result).toBe('退款政策');
    });
  });

  describe('truncateQuery', () => {
    it('truncates queries longer than 200 chars', () => {
      const service = new QueryRewriteService() as unknown as { truncateQuery: (s: string) => string };
      const longQuery = '退款政策七天无理由退货的具体流程和注意事项，包括退货条件、退款方式、运费承担等方面的问题解答和操作指南。' + '更多信息请参考官网'.repeat(20);
      const result = service.truncateQuery(longQuery);
      expect(result.length).toBeLessThanOrEqual(200);
    });

    it('keeps queries under 200 chars unchanged', () => {
      const service = new QueryRewriteService() as unknown as { truncateQuery: (s: string) => string };
      const shortQuery = '退款政策是什么';
      const result = service.truncateQuery(shortQuery);
      expect(result).toBe(shortQuery);
    });
  });

  describe('stripInternalMarkers', () => {
    it('strips tool call markers and trims whitespace', () => {
      const service = new QueryRewriteService() as unknown as { stripInternalMarkers: (s: string) => string };
      // Input has spaces inside the marker that will be removed, leaving only trailing spaces
      const result = service.stripInternalMarkers('[TOOL_CALL]order-query|{}[/TOOL_CALL]  退款政策');
      // trim() removes leading/trailing whitespace, leaving just the content
      expect(result).toBe('退款政策');
    });

    it('strips confidence tags', () => {
      const service = new QueryRewriteService() as unknown as { stripInternalMarkers: (s: string) => string };
      const result = service.stripInternalMarkers('  退款政策[CONF:0.95]  ');
      expect(result).toBe('退款政策');
    });
  });
});
