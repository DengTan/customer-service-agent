/**
 * Retrieval Orchestrator contract tests.
 *
 * These tests verify the canonical RAG contract:
 *   1. Query gate: SKIP / RETRIEVE / CLARIFY decisions
 *   2. Candidate vs citation separation (candidates are NOT public sources)
 *   3. Provenance version stamping (v2 = new contract, v1 = legacy)
 *   4. Rerank fail-closed behavior (mock scores never masquerade as cross-encoder)
 *
 * External services (embedding, Supabase) are stubbed via vi.mock so these
 * tests are deterministic and don't depend on a running Ollama, Supabase,
 * real rerank API, or any network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub external services so the orchestrator runs deterministically.
// We mock:
//   - KnowledgeSearchService (inline mock return values)
//   - HybridSearchService (also mocked, but pulled in by orchestrator)
//   - EmbeddingService (NOT invoked since search() is mocked entirely)
//   - ProductDetailService / SizeChartService (no-op functions)
// ---------------------------------------------------------------------------

const mockKnowledgeSearchFn = vi.fn();
const mockHybridSearchFn = vi.fn();
const mockProductSearchFn = vi.fn();
const mockSizeChartSearchFn = vi.fn();

vi.mock('@/server/services/knowledge-search-service', () => {
  class MockKnowledgeSearchService {
    search = mockKnowledgeSearchFn;
    searchHybrid = mockHybridSearchFn;
    getMinScore = vi.fn().mockResolvedValue(0.75);
    getSearchLimit = vi.fn().mockResolvedValue(5);
    getImageSearchLimit = vi.fn().mockResolvedValue(3);
  }
  return {
    KnowledgeSearchService: MockKnowledgeSearchService,
    getKnowledgeSearchService: () => new MockKnowledgeSearchService(),
    invalidateKnowledgeSearchSettingsCache: () => {},
    __mockKnowledgeSearchFn: mockKnowledgeSearchFn,
  };
});

vi.mock('@/server/services/hybrid-search-service', () => {
  class MockHybridSearchService {
    search = mockHybridSearchFn;
  }
  return {
    HybridSearchService: MockHybridSearchService,
    getHybridSearchService: () => new MockHybridSearchService(),
  };
});

vi.mock('@/server/services/embedding-service', () => ({
  EmbeddingService: class { embed = vi.fn().mockResolvedValue([0.0]); },
  getEmbeddingService: () => ({ embed: vi.fn().mockResolvedValue([0.0]) }),
}));

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
  }),
  isDemoMode: () => false,
}));

vi.mock('@/server/services/product-detail-service', () => ({
  ProductDetailService: class {
    searchProductsForLLM = mockProductSearchFn;
  },
}));

vi.mock('@/server/services/size-chart-service', () => ({
  SizeChartService: class {
    searchSizeChartsForLLM = mockSizeChartSearchFn;
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetrievalOrchestrator — query gate', () => {
  let RetrievalOrchestrator: typeof import('@/server/services/retrieval-orchestrator').RetrievalOrchestrator;
  let orchestrator: InstanceType<typeof RetrievalOrchestrator>;

  beforeEach(async () => {
    mockKnowledgeSearchFn.mockReset();
    mockHybridSearchFn.mockReset();
    ({ RetrievalOrchestrator } = await import('@/server/services/retrieval-orchestrator'));
    orchestrator = new RetrievalOrchestrator();
  });

  it('SKIP on "1" with no numbered-choice context — no retrieval triggered', async () => {
    const result = await orchestrator.retrieve('1', []);
    expect(result.decision.action).toBe('skip');
    expect(mockKnowledgeSearchFn).not.toHaveBeenCalled();
    expect(mockHybridSearchFn).not.toHaveBeenCalled();
    expect(result.evidence.citations).toEqual([]);
    expect(result.evidence.candidates).toEqual([]);
    expect(result.evidence.trace.retrievalRan).toBe(false);
    expect(result.evidence.trace.provenanceVersion).toBe(2);
    expect(result.knowledgeContext).toBeUndefined();
  });

  it('SKIP on "。" punctuation only', async () => {
    const result = await orchestrator.retrieve('。', []);
    expect(result.decision.action).toBe('skip');
    expect(mockKnowledgeSearchFn).not.toHaveBeenCalled();
    expect(result.evidence.citations).toEqual([]);
  });

  it('SKIP on "嗯" acknowledgement', async () => {
    const result = await orchestrator.retrieve('嗯', []);
    expect(result.decision.action).toBe('skip');
    expect(result.evidence.citations).toEqual([]);
  });

  it('SKIP on "好的" Chinese acknowledgement', async () => {
    const result = await orchestrator.retrieve('好的', []);
    expect(result.decision.action).toBe('skip');
    expect(result.evidence.citations).toEqual([]);
  });

  it('SKIP on "谢谢" Chinese acknowledgement', async () => {
    const result = await orchestrator.retrieve('谢谢', []);
    expect(result.decision.action).toBe('skip');
    expect(result.evidence.citations).toEqual([]);
  });

  it('SKIP on empty / whitespace input', async () => {
    const result = await orchestrator.retrieve('', []);
    expect(result.decision.action).toBe('skip');
    expect(result.evidence.citations).toEqual([]);
  });

  it('RETRIEVE on a substantive refund question → candidates exist but citations=0 (fail-closed without real reranker)', async () => {
    mockKnowledgeSearchFn.mockResolvedValue({
      context: '[资料1] 退货政策说明',
      sources: [
        { type: 'knowledge', content: '退货政策说明', score: 0.85, knowledge_item_id: 'k1', name: '退货政策', category: '退换货' },
      ],
      confidence: 0.85,
      images: [],
    });

    const result = await orchestrator.retrieve('签收后第六天可以无理由退货吗？', []);
    expect(result.decision.action).toBe('retrieve');
    expect(mockKnowledgeSearchFn).toHaveBeenCalled();
    // Non-hybrid path: no real cross-encoder → rerankDegraded=true → citations=[] (fail-closed).
    // Candidates exist internally for LLM context but MUST NOT appear as public sources.
    expect(result.evidence.candidates.length).toBeGreaterThan(0); // internal OK
    expect(result.evidence.citations.length).toBe(0); // PUBLIC blocked — fail-closed
    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.trace.rerankBackend).toBe('mock');
  });

  it('RETRIEVE on refund question WITH real bge reranker → citations>0 and provenanceVersion=2', async () => {
    mockHybridSearchFn.mockResolvedValue({
      context: '[资料1] 退货政策说明',
      sources: [
        { type: 'knowledge', content: '退货政策说明', score: 0.85, knowledge_item_id: 'k1', name: '退货政策', category: '退换货' },
      ],
      confidence: 0.85,
      images: [],
      hybridMetadata: {
        vectorResults: 5,
        bm25Results: 3,
        rerankApplied: true,
        rerankBackend: 'bge',
        rerankDegraded: false,
        executionTimeMs: 12,
      },
    });

    const result = await orchestrator.retrieve('签收后第六天可以无理由退货吗？', [], { useHybrid: true });
    expect(result.decision.action).toBe('retrieve');
    // Real bge reranker → not degraded → citations published with provenanceVersion=2.
    expect(result.evidence.trace.rerankDegraded).toBe(false);
    expect(result.evidence.trace.rerankBackend).toBe('bge');
    expect(result.evidence.citations.length).toBeGreaterThan(0);
    expect(result.evidence.citations[0]).toMatchObject({
      type: 'knowledge',
      provenanceVersion: 2,
    });
  });

  it('fail-closed: candidate below min_score produces ZERO citations', async () => {
    mockKnowledgeSearchFn.mockResolvedValue({
      context: '[资料1] 内容',
      sources: [
        { type: 'knowledge', content: '...', score: 0.5, knowledge_item_id: 'k1', name: '弱相关', category: '其他' },
        { type: 'knowledge', content: '...', score: 0.4, knowledge_item_id: 'k2', name: '极弱相关', category: '其他' },
      ],
      confidence: 0.45,
      images: [],
    });

    const result = await orchestrator.retrieve('空调具体能效参数如何？', []);
    expect(result.decision.action).toBe('retrieve');
    // Candidates exist but none meet the 0.75 threshold; citations must be empty.
    expect(result.evidence.candidates.length).toBe(2);
    expect(result.evidence.accepted.length).toBe(0);
    expect(result.evidence.citations.length).toBe(0);
    // Trace must surface rerankDegraded=true because no real cross-encoder is configured.
    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.trace.rerankBackend).toBe('mock');
  });
});

describe('RetrievalOrchestrator — rerank provenance', () => {
  let RetrievalOrchestrator: typeof import('@/server/services/retrieval-orchestrator').RetrievalOrchestrator;

  beforeEach(async () => {
    mockKnowledgeSearchFn.mockReset();
    mockHybridSearchFn.mockReset();
    ({ RetrievalOrchestrator } = await import('@/server/services/retrieval-orchestrator'));
  });

  it('SKIP path always reports rerankDegraded=true with backend="none"', async () => {
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('.', []);
    expect(result.decision.action).toBe('skip');
    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.trace.rerankBackend).toBe('none');
  });

  it('RETRIEVE path without hybrid metadata exposes rerankDegraded=true', async () => {
    mockKnowledgeSearchFn.mockResolvedValue({
      context: '[资料1] text',
      sources: [
        { type: 'knowledge', content: 'text', score: 0.9, knowledge_item_id: 'k1', name: 'n', category: 'c' },
      ],
      confidence: 0.9,
      images: [],
    });
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('some question about returns', []);
    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.trace.rerankBackend).toBe('mock');
    // The candidates must be tagged with scoreOrigin = 'mock' for downstream traceability.
    expect(result.evidence.candidates[0].scoreOrigin).toBe('mock');
  });

  it('RETRIEVE with hybrid metadata rerankDegraded=true → rerank fail-closed: citations MUST be empty', async () => {
    mockHybridSearchFn.mockResolvedValue({
      context: '[资料1] text',
      sources: [
        { type: 'knowledge', content: 'text', score: 0.9, knowledge_item_id: 'k1', name: 'n', category: 'c' },
      ],
      confidence: 0.9,
      images: [],
      hybridMetadata: {
        vectorResults: 5,
        bm25Results: 3,
        rerankApplied: true,
        rerankBackend: 'mock',
        rerankDegraded: true,
        executionTimeMs: 12,
      },
    });
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('retrieval question here', [], { useHybrid: true });
    // Even though rerankApplied=true and score=0.9 (above threshold), the reranker is
    // mock → rerankDegraded=true → citations MUST be empty (fail-closed).
    // Candidates and accepted exist internally, but public sources are blocked.
    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.trace.rerankBackend).toBe('mock');
    expect(result.evidence.trace.degradationReasons).toContain('reranker_fallback');
    expect(result.evidence.candidates.length).toBeGreaterThan(0); // internal diagnostics OK
    expect(result.evidence.citations.length).toBe(0); // PUBLIC sources blocked — fail-closed
  });

  it('RETRIEVE with missing rerankDegraded metadata remains fail-closed', async () => {
    mockHybridSearchFn.mockResolvedValue({
      context: '[资料1] text',
      sources: [
        { type: 'knowledge', content: 'text', score: 0.9, knowledge_item_id: 'k1', name: 'n', category: 'c' },
      ],
      confidence: 0.9,
      images: [],
      hybridMetadata: {
        vectorResults: 5,
        bm25Results: 3,
        rerankApplied: true,
        rerankBackend: 'bge',
        executionTimeMs: 12,
      },
    });

    const result = await new RetrievalOrchestrator().retrieve('retrieval question here', [], { useHybrid: true });

    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.citations).toEqual([]);
  });

  it('RETRIEVE with rerankDegraded=false + non-mock backend → rerankDegraded=false', async () => {
    mockHybridSearchFn.mockResolvedValue({
      context: '[资料1] text',
      sources: [
        { type: 'knowledge', content: 'text', score: 0.9, knowledge_item_id: 'k1', name: 'n', category: 'c' },
      ],
      confidence: 0.9,
      images: [],
      hybridMetadata: {
        vectorResults: 5,
        bm25Results: 3,
        rerankApplied: true,
        rerankBackend: 'bge',
        rerankDegraded: false,
        executionTimeMs: 12,
      },
    });
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('retrieval question here', [], { useHybrid: true });
    expect(result.evidence.trace.rerankDegraded).toBe(false);
    expect(result.evidence.trace.rerankBackend).toBe('bge');
    expect(result.evidence.trace.degradationReasons).not.toContain('reranker_fallback');
  });
});

describe('RetrievalOrchestrator — citation provenance', () => {
  let RetrievalOrchestrator: typeof import('@/server/services/retrieval-orchestrator').RetrievalOrchestrator;

  beforeEach(async () => {
    mockKnowledgeSearchFn.mockReset();
    ({ RetrievalOrchestrator } = await import('@/server/services/retrieval-orchestrator'));
  });

  it('citations from orchestrator with real reranker all carry provenanceVersion=2', async () => {
    mockHybridSearchFn.mockResolvedValue({
      context: 'x',
      sources: [
        { type: 'knowledge', content: 'first', score: 0.9, knowledge_item_id: 'a', name: 'n1', category: 'c' },
        { type: 'knowledge', content: 'second', score: 0.85, knowledge_item_id: 'b', name: 'n2', category: 'c' },
      ],
      confidence: 0.87,
      images: [],
      hybridMetadata: {
        vectorResults: 5,
        bm25Results: 3,
        rerankApplied: true,
        rerankBackend: 'bge',
        rerankDegraded: false,
        executionTimeMs: 12,
      },
    });
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('substantive question here', [], { useHybrid: true });
    // With real bge reranker, citations are published.
    expect(result.evidence.citations.length).toBeGreaterThan(0);
    for (const c of result.evidence.citations) {
      expect(c.provenanceVersion).toBe(2);
    }
  });

  it('citations are NEVER published without real reranker (fail-closed)', async () => {
    // Non-hybrid path → rerankDegraded=true → citations must be empty.
    mockKnowledgeSearchFn.mockResolvedValue({
      context: 'x',
      sources: [
        { type: 'knowledge', content: 'high-score-candidate', score: 0.9, knowledge_item_id: 'a', name: 'n1', category: 'c' },
        { type: 'knowledge', content: 'another-candidate', score: 0.8, knowledge_item_id: 'b', name: 'n2', category: 'c' },
      ],
      confidence: 0.85,
      images: [],
    });
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('any question here', []);
    // Candidates exist (LLM context), but citations MUST be empty without real reranker.
    expect(result.evidence.candidates.length).toBeGreaterThan(0);
    expect(result.evidence.citations.length).toBe(0);
    expect(result.evidence.trace.rerankDegraded).toBe(true);
  });

  it('SKIP path never produces citations regardless of candidate-list history', async () => {
    const orchestrator = new RetrievalOrchestrator();
    const result = await orchestrator.retrieve('好的', []);
    expect(result.evidence.citations).toEqual([]);
    expect(result.evidence.candidates).toEqual([]);
  });
});

describe('RetrievalOrchestrator — structured context citation safety', () => {
  let RetrievalOrchestrator: typeof import('@/server/services/retrieval-orchestrator').RetrievalOrchestrator;

  beforeEach(async () => {
    mockKnowledgeSearchFn.mockReset();
    mockHybridSearchFn.mockReset();
    mockProductSearchFn.mockReset();
    mockSizeChartSearchFn.mockReset();
    mockKnowledgeSearchFn.mockResolvedValue({ context: '', sources: [], confidence: 0, images: [] });
    mockProductSearchFn.mockResolvedValue({ productContext: '' });
    mockSizeChartSearchFn.mockResolvedValue({ sizeChartContext: '' });
    ({ RetrievalOrchestrator } = await import('@/server/services/retrieval-orchestrator'));
  });

  it('keeps product context for generation without publishing it as a citation', async () => {
    mockProductSearchFn.mockResolvedValue({ productContext: '商品 SKU-001 的结构化详情' });

    const result = await new RetrievalOrchestrator().retrieve('请介绍 SKU-001 的参数', []);

    expect(result.productContext).toEqual({ productContext: '商品 SKU-001 的结构化详情' });
    expect(result.evidence.citations).toEqual([]);
    expect(result.evidence.trace.citationCount).toBe(0);
    expect(result.evidence.trace.degradationReasons).toContain('product_citation_unverified');
  });

  it('keeps size-chart context for generation without publishing it as a citation', async () => {
    mockSizeChartSearchFn.mockResolvedValue({ sizeChartContext: '身高 170cm 建议 M 码' });

    const result = await new RetrievalOrchestrator().retrieve('身高 170 应该选什么尺码', []);

    expect(result.sizeChartContext).toEqual({ sizeChartContext: '身高 170cm 建议 M 码' });
    expect(result.evidence.citations).toEqual([]);
    expect(result.evidence.trace.citationCount).toBe(0);
    expect(result.evidence.trace.degradationReasons).toContain('size_chart_citation_unverified');
  });

  it('fails closed when knowledge retrieval throws while preserving other channel isolation', async () => {
    mockKnowledgeSearchFn.mockRejectedValue(new Error('vector backend unavailable'));
    mockProductSearchFn.mockResolvedValue({ productContext: '商品上下文' });

    const result = await new RetrievalOrchestrator().retrieve('请介绍商品参数', []);

    expect(result.productContext?.productContext).toBe('商品上下文');
    expect(result.knowledgeContext).toBeUndefined();
    expect(result.evidence.citations).toEqual([]);
    expect(result.evidence.trace.rerankDegraded).toBe(true);
    expect(result.evidence.trace.degradationReasons).toContain('product_citation_unverified');
  });

  it('does not leak product or size-chart pseudo-citations when merging real knowledge citations', async () => {
    mockHybridSearchFn.mockResolvedValue({
      context: '经过 rerank 的知识内容',
      sources: [{ type: 'knowledge', content: '经过 rerank 的知识内容', score: 0.9, knowledge_item_id: 'k1' }],
      confidence: 0.9,
      images: [],
      hybridMetadata: {
        vectorResults: 1,
        bm25Results: 1,
        rerankApplied: true,
        rerankBackend: 'bge',
        rerankDegraded: false,
      },
    });
    mockProductSearchFn.mockResolvedValue({ productContext: '商品上下文' });
    mockSizeChartSearchFn.mockResolvedValue({ sizeChartContext: '尺码上下文' });

    const result = await new RetrievalOrchestrator().retrieve('请结合商品和尺码说明退换规则', [], { useHybrid: true });

    expect(result.productContext?.productContext).toBe('商品上下文');
    expect(result.sizeChartContext?.sizeChartContext).toBe('尺码上下文');
    expect(result.evidence.citations).toHaveLength(1);
    expect(result.evidence.citations[0]).toMatchObject({ type: 'knowledge', knowledge_item_id: 'k1' });
    expect(result.evidence.citations.some(c => c.type === 'product' || c.type === 'size_chart')).toBe(false);
  });
});

describe('RetrievalOrchestrator — default threshold alignment', () => {
  it('uses HTTP.KNOWLEDGE_MIN_SCORE = 0.75 as the orchestrator default', async () => {
    const { HTTP } = await import('@/lib/constants');
    expect(HTTP.KNOWLEDGE_MIN_SCORE).toBe(0.75);
  });
});
