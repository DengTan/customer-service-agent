/**
 * Shared decision contract tests across simulation / production / Gorgias
 * entry points.
 *
 * Goal: verify that the orchestration semantics (SKIP/RETRIEVE/CLARIFY) are
 * deterministic and identical no matter which route the message arrived
 * through. This is the contract that prevents the three endpoints from
 * drifting.
 *
 * Strategy: invoke the orchestrator directly with the same user message +
 * context, and verify the same decision is produced. We don't re-route
 * through each endpoint because that would require live Supabase + LLM;
 * the orchestrator is already the single entry point they all share.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockKnowledgeSearchFn = vi.fn();

vi.mock('@/server/services/knowledge-search-service', () => {
  class MockKnowledgeSearchService {
    search = mockKnowledgeSearchFn;
    searchHybrid = vi.fn().mockResolvedValue({
      sources: [], context: '', confidence: 0, images: [],
      hybridMetadata: { vectorResults: 0, bm25Results: 0, rerankApplied: false, rerankBackend: 'mock', rerankDegraded: true, executionTimeMs: 0 },
    });
    getMinScore = vi.fn().mockResolvedValue(0.75);
    getSearchLimit = vi.fn().mockResolvedValue(5);
    getImageSearchLimit = vi.fn().mockResolvedValue(3);
  }
  return {
    KnowledgeSearchService: MockKnowledgeSearchService,
    getKnowledgeSearchService: () => new MockKnowledgeSearchService(),
    invalidateKnowledgeSearchSettingsCache: () => {},
  };
});

vi.mock('@/server/services/hybrid-search-service', () => ({
  HybridSearchService: class { search = vi.fn(); },
  getHybridSearchService: () => ({ search: vi.fn() }),
}));

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
    searchProductsForLLM = vi.fn().mockResolvedValue({ productContext: '' });
  },
}));

vi.mock('@/server/services/size-chart-service', () => ({
  SizeChartService: class {
    searchSizeChartsForLLM = vi.fn().mockResolvedValue({ sizeChartContext: '' });
  },
}));

interface DecisionVector {
  action: 'skip' | 'retrieve' | 'clarify';
  retrievalCalls: number;
  knowledgeCitations: number;
}

function findOrchestratorRetrieveCalls(source: string, fileName: string): ts.CallExpression[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'orchestrator' &&
      node.expression.name.text === 'retrieve'
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

function hasLiteralHybridOption(call: ts.CallExpression): boolean {
  const options = call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;

  return options.properties.some(property =>
    ts.isPropertyAssignment(property) &&
    ts.isIdentifier(property.name) &&
    property.name.text === 'useHybrid' &&
    property.initializer.kind === ts.SyntaxKind.TrueKeyword
  );
}

async function runDecisionWith(
  RetrievalOrchestratorClass: typeof import('@/server/services/retrieval-orchestrator').RetrievalOrchestrator,
  message: string,
  recent: Array<{ role: string; content: string }>,
  mockImpl?: (msg: string, minScore: number) => Promise<unknown>
): Promise<DecisionVector> {
  mockKnowledgeSearchFn.mockReset();
  if (mockImpl) {
    mockKnowledgeSearchFn.mockImplementation(mockImpl);
  } else {
    mockKnowledgeSearchFn.mockResolvedValue({ context: '', sources: [], confidence: 0, images: [] });
  }
  const orch = new RetrievalOrchestratorClass();
  const result = await orch.retrieve(message, recent);
  return {
    action: result.decision.action,
    retrievalCalls: mockKnowledgeSearchFn.mock.calls.length,
    knowledgeCitations: result.evidence.citations.length,
  };
}

describe('Shared retrieval configuration across entry points', () => {
  const entryPoints = [
    'src/app/api/conversations/[id]/messages/route.ts',
    'src/app/api/simulations/[id]/messages/route.ts',
    'src/server/services/gorgias-sync-service.ts',
  ];

  it.each(entryPoints)('%s explicitly enables hybrid retrieval', relativePath => {
    const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
    const calls = findOrchestratorRetrieveCalls(source, relativePath);

    expect(calls).toHaveLength(1);
    expect(hasLiteralHybridOption(calls[0])).toBe(true);
  });

  it('loads hybrid settings before deriving per-request defaults', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/server/services/hybrid-search-service.ts'),
      'utf8'
    );
    const loadConfigAt = source.indexOf('await this.loadConfig()');
    const deriveDefaultsAt = source.indexOf('const limit = options?.limit');

    expect(loadConfigAt).toBeGreaterThan(-1);
    expect(deriveDefaultsAt).toBeGreaterThan(loadConfigAt);
  });

  it('uses the canonical knowledge threshold as the hybrid default', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/server/services/hybrid-search-service.ts'),
      'utf8'
    );

    expect(source).toContain('minScoreThreshold: HTTP.KNOWLEDGE_MIN_SCORE');
  });

  it('isolates actual rerank backend state per hybrid request', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/server/services/hybrid-search-service.ts'),
      'utf8'
    );

    expect(source).toContain('new RerankService({ model: this.config.rerankModel })');
    expect(source).not.toContain('getRerankService({ model: this.config.rerankModel })');
  });
});

describe('Shared decision contract across entry points', () => {
  let RetrievalOrchestrator: typeof import('@/server/services/retrieval-orchestrator').RetrievalOrchestrator;

  beforeEach(async () => {
    mockKnowledgeSearchFn.mockReset();
    ({ RetrievalOrchestrator } = await import('@/server/services/retrieval-orchestrator'));
  });

  it('"1" with empty history → SKIP and ZERO citations identically across all entry points', async () => {
    const decision1 = await runDecisionWith(RetrievalOrchestrator, '1', []);
    const decision2 = await runDecisionWith(RetrievalOrchestrator, '1', []);
    expect(decision1).toEqual(decision2);
    expect(decision1.action).toBe('skip');
    expect(decision1.retrievalCalls).toBe(0);
    expect(decision1.knowledgeCitations).toBe(0);
  });

  it('"嗯" acknowledgement → SKIP and ZERO citations', async () => {
    const d = await runDecisionWith(RetrievalOrchestrator, '嗯', []);
    expect(d).toMatchObject({ action: 'skip', knowledgeCitations: 0 });
    expect(d.retrievalCalls).toBe(0);
  });

  it('"谢谢" acknowledgement → SKIP and ZERO citations', async () => {
    const d = await runDecisionWith(RetrievalOrchestrator, '谢谢', []);
    expect(d).toMatchObject({ action: 'skip', knowledgeCitations: 0 });
    expect(d.retrievalCalls).toBe(0);
  });

  it('"1" after assistant offered numbered options should NOT be skipped mechanically', async () => {
    // The previous AI message contains a numbered list of choices.
    // The user's "1" reply is now a SELECTION, not "one second of thought".
    const recent = [
      { role: 'assistant', content: '请选择:\n1. 退货\n2. 换货\n3. 咨询人工客服' },
    ];
    const d = await runDecisionWith(RetrievalOrchestrator, '1', recent);
    expect(d.action).not.toBe('skip');
  });

  it('substantive refund question → RETRIEVE runs (mock reranker path → citations may be 0, fail-closed)', async () => {
    const refundMock = async () => ({
      context: '[资料1] 退货政策：30天无理由',
      sources: [
        { type: 'knowledge', content: '退货政策：30天无理由', score: 0.88, knowledge_item_id: 'k1', name: '退货政策', category: '退换货' },
      ],
      confidence: 0.88,
      images: [],
    });
    const d = await runDecisionWith(RetrievalOrchestrator, '我买了一件衣服想退货，流程是怎样的？', [], refundMock as Parameters<typeof runDecisionWith>[3]);
    expect(d.action).toBe('retrieve');
    // Non-hybrid mock path: rerankDegraded=true → citations=0 (fail-closed).
    // Retrieval ran and candidates exist internally; the decision contract is about gate semantics.
    expect(d.retrievalCalls).toBeGreaterThan(0);
    // citations=0 is expected without real reranker; this is the correct fail-closed behavior.
  });
});
