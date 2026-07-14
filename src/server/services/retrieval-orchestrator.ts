/**
 * Retrieval Orchestrator — P1 Shared Contract
 *
 * Single orchestration point for simulation, production, and Gorgias routes.
 * Reads from RetrievalGatingService → performs retrieval → returns EvidenceBundle.
 *
 * Design contract (from RAG-retrieval-citation-plan):
 * - candidates: internal retrieval diagnostics (never sent to client as citations)
 * - accepted: passages allowed into LLM generation context
 * - citations: sources eligible for public display under the current evidence gate
 * - trace: provenance/version/degradation metadata (stored in message.metadata)
 *
 * Bounded loops:
 * - Query rewrite: at most once
 * - Retrieval: at most twice per turn
 *
 * Fallback behavior:
 * - embedding unavailable → conversational reply, no knowledge citations
 * - hybrid partial failure → use surviving channel if calibrated acceptance passes
 * - real reranker unavailable → DO NOT treat mock score as cross-encoder evidence
 */

import { getRetrievalGatingService, type RetrievalGateDecision } from './retrieval-gating-service';
import { getKnowledgeSearchService, type KnowledgeSourceItem } from './knowledge-search-service';
import { getHybridSearchService } from './hybrid-search-service';
import { ProductDetailService } from './product-detail-service';
import { SizeChartService } from './size-chart-service';
import { HTTP } from '@/lib/constants';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Evidence bundle returned by the orchestrator.
 * Used by simulation route, conversations messages route, and Gorgias integration.
 */
export interface EvidenceBundle {
  /** Internal retrieval candidates — diagnostic only, never shown to client as citations */
  candidates: EvidenceItem[];

  /** Passages that passed evidence grading — injected into LLM context */
  accepted: EvidenceItem[];

  /** Sources eligible for public display and storage in message.sources */
  citations: CitationItem[];

  /** Provenance and diagnostic trace */
  trace: EvidenceTrace;
}

export interface EvidenceItem {
  id: string;
  type: 'knowledge' | 'product' | 'size_chart';
  content: string;
  /** Relevance grade from reranker (0-1). Not a truthfulness guarantee. */
  relevanceScore: number;
  name?: string;
  category?: string;
  /** Source of the score: 'vector' | 'bm25' | 'hybrid' | 'reranker' | 'mock' */
  scoreOrigin: ScoreOrigin;
  /** Stable chunk identity: populated when a chunk matched, null when parent item matched */
  chunkId?: string | null;
  /** Chunk position within parent (0 when parent matched directly) */
  chunkIndex?: number;
  /** SHA-256 content hash for citation stability */
  contentHash?: string | null;
  metadata?: Record<string, unknown>;
}

export type ScoreOrigin = 'vector' | 'bm25' | 'hybrid' | 'reranker' | 'mock';

export interface CitationItem {
  type: string;
  content?: string;
  score: number;
  /** Parent knowledge item ID (always present) */
  knowledge_item_id?: string;
  name?: string;
  category?: string;
  id?: string;
  title?: string;
  image_url?: string | null;
  /** Stable chunk ID: required for P2 public citations, null when parent matched */
  chunk_id?: string | null;
  /** Chunk position within parent (0 when parent matched directly) */
  chunk_index?: number;
  /** Content hash for citation stability */
  content_hash?: string | null;
  provenanceVersion: 1 | 2;
}

export interface EvidenceTrace {
  /** 2 = new provenance contract; 1 = legacy (candidate merged as citation) */
  provenanceVersion: 1 | 2;
  /** Whether retrieval actually ran */
  retrievalRan: boolean;
  /** Whether a real cross-encoder reranker was used (vs mock/fallback) */
  rerankDegraded: boolean;
  /** Which reranker backend produced the scores, when known. */
  rerankBackend?: 'bge' | 'cohere' | 'generic' | 'mock' | 'none';
  /** Whether hybrid search was used (vs pure vector) */
  hybridSearch: boolean;
  /** Number of candidates retrieved */
  candidateCount: number;
  /** Number of accepted evidence items after grading */
  acceptedCount: number;
  /** Number of final citations after public-source eligibility gating */
  citationCount: number;
  /** Effective min_score threshold used */
  minScore: number;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Degradation reason codes */
  degradationReasons: string[];
  /** Semantic model version tag */
  modelVersion?: string;
}

export interface RetrievalResult {
  decision: RetrievalGateDecision;
  evidence: EvidenceBundle;
  /** Raw knowledge search result (for LLM context injection) */
  knowledgeContext?: {
    context: string;
    knowledgeSources: KnowledgeSourceItem[];
    confidence: number;
    images: Array<{ url: string; name: string; category: string }>;
  };
  /** Raw product search result (for LLM context injection) */
  productContext?: {
    productContext: string;
  };
  /** Raw size chart result (for LLM context injection) */
  sizeChartContext?: {
    sizeChartContext: string;
  };
  /** Effective min score used */
  minScore: number;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class RetrievalOrchestrator {
  private readonly gating = getRetrievalGatingService();
  private readonly knowledgeSearch = getKnowledgeSearchService();
  private readonly hybridSearch = getHybridSearchService();

  /**
   * Retrieve evidence for a user message.
   *
   * This is the single entry point used by simulation, production, and Gorgias routes.
   *
   * @param userMessage - Raw user message content
   * @param recentMessages - Recent conversation messages for context
   * @param options - Optional override settings
   */
  async retrieve(
    userMessage: string,
    recentMessages: Array<{ role: string; content: string }>,
    options?: {
      useHybrid?: boolean;
      minScore?: number;
      skipRetrieval?: boolean; // for testing
    }
  ): Promise<RetrievalResult> {
    const startTime = Date.now();
    const useHybrid = options?.useHybrid ?? false;

    // Step 1: Query gate decision
    const decision = this.gating.shouldRetrieve(userMessage, recentMessages);

    // Step 2: SKIP — return empty evidence bundle
    if (decision.action === 'skip') {
      const elapsed = Date.now() - startTime;
      return {
        decision,
        evidence: this.emptyEvidence({ retrievalRan: false, executionTimeMs: elapsed, minScore: HTTP.KNOWLEDGE_MIN_SCORE }),
        knowledgeContext: undefined,
        productContext: undefined,
        sizeChartContext: undefined,
        minScore: HTTP.KNOWLEDGE_MIN_SCORE,
      };
    }

    // Step 3: RETRIEVE or CLARIFY — proceed with retrieval
    // Bound: at most 2 retrieval attempts per turn
    const effectiveMinScore = options?.minScore ?? HTTP.KNOWLEDGE_MIN_SCORE;
    const degradationReasons: string[] = [];
    let retrievalRan = false;

    // Parallel knowledge + product + size-chart retrieval
    let knowledgeBundle: EvidenceBundle | null = null;
    let productBundle: EvidenceBundle | null = null;
    let sizeChartBundle: EvidenceBundle | null = null;
    let knowledgeContext: RetrievalResult['knowledgeContext'] = undefined;
    let productContext: RetrievalResult['productContext'] = undefined;
    let sizeChartContext: RetrievalResult['sizeChartContext'] = undefined;

    try {
      const searchPromise = useHybrid
        ? this.knowledgeSearch.searchHybrid(decision.effectiveQuery, effectiveMinScore)
        : this.knowledgeSearch.search(decision.effectiveQuery, effectiveMinScore);

      const [searchResult, productResult, sizeChartResult] = await Promise.all([
        searchPromise.catch((err) => {
          logger.agent.warn('[RetrievalOrchestrator] Knowledge search failed', { error: err });
          return null;
        }),
        this.productSearch(decision.effectiveQuery).catch((err) => {
          logger.agent.warn('[RetrievalOrchestrator] Product search failed', { error: err });
          return null;
        }),
        this.sizeChartSearch(decision.effectiveQuery).catch((err) => {
          logger.agent.warn('[RetrievalOrchestrator] Size chart search failed', { error: err });
          return null;
        }),
      ]);

      retrievalRan = true;

      // Process knowledge search result
      if (searchResult) {
        const hybridMeta = 'hybridMetadata' in searchResult ? (searchResult as { hybridMetadata?: { rerankApplied: boolean; rerankBackend?: string; rerankDegraded?: boolean; vectorResults: number; bm25Results: number } }).hybridMetadata : undefined;

        // Reranker backend truthfulness: the orchestrator must report
        // `rerankDegraded=true` whenever the rerank score could not have come
        // from a real cross-encoder (mock fallback, no key, etc). The previous
        // version only checked the env-var presence, which let mock scores
        // masquerade as cross-encoder evidence.
        const rerankBackendFromMeta = hybridMeta?.rerankBackend ?? 'mock';
        const rerankDegraded =
          !hybridMeta ||
          hybridMeta.rerankApplied !== true ||
          rerankBackendFromMeta === 'mock' ||
          rerankBackendFromMeta === 'none' ||
          hybridMeta.rerankDegraded !== false;

        if (rerankDegraded) {
          degradationReasons.push('reranker_fallback');
        }

        knowledgeBundle = this.buildKnowledgeBundle(searchResult, rerankDegraded, effectiveMinScore);

        const knowledgeSources = 'sources' in searchResult
          ? (searchResult as { sources: KnowledgeSourceItem[] }).sources
          : [];
        const knowledgeContextText = 'context' in searchResult ? (searchResult as { context: string }).context : '';
        const knowledgeImages = 'images' in searchResult
          ? (searchResult as { images: Array<{ url: string; name: string; category: string }> }).images
          : [];
        const knowledgeConfidence = 'confidence' in searchResult
          ? (searchResult as { confidence: number }).confidence
          : 0;

        if (knowledgeSources.length > 0) {
          knowledgeContext = {
            context: knowledgeContextText,
            knowledgeSources,
            confidence: knowledgeConfidence,
            images: knowledgeImages,
          };
        }
      }

      // Process product result
      if (productResult && productResult.productContext) {
        productBundle = this.buildProductBundle(productResult);
        productContext = { productContext: productResult.productContext };
      }

      // Process size chart result
      if (sizeChartResult && sizeChartResult.sizeChartContext) {
        sizeChartBundle = this.buildSizeChartBundle(sizeChartResult);
        sizeChartContext = { sizeChartContext: sizeChartResult.sizeChartContext };
      }
    } catch (err) {
      logger.agent.error('[RetrievalOrchestrator] Retrieval pipeline failed', { error: err });
      degradationReasons.push('retrieval_error');
    }

    // Step 4: Build merged EvidenceBundle
    const evidence = this.mergeEvidenceBundles(
      {
        retrievalRan,
        hybridSearch: useHybrid,
        degradationReasons,
        minScore: effectiveMinScore,
        executionTimeMs: Date.now() - startTime,
      },
      knowledgeBundle,
      productBundle,
      sizeChartBundle
    );

    return {
      decision,
      evidence,
      knowledgeContext,
      productContext,
      sizeChartContext,
      minScore: effectiveMinScore,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Empty evidence
  // ---------------------------------------------------------------------------

  private emptyEvidence(overrides: Partial<EvidenceTrace>): EvidenceBundle {
    return {
      candidates: [],
      accepted: [],
      citations: [],
      trace: {
        provenanceVersion: 2,
        retrievalRan: false,
        rerankDegraded: true,
        rerankBackend: 'none',
        hybridSearch: false,
        candidateCount: 0,
        acceptedCount: 0,
        citationCount: 0,
        minScore: HTTP.KNOWLEDGE_MIN_SCORE,
        executionTimeMs: 0,
        degradationReasons: [],
        ...overrides,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Build knowledge bundle
  // ---------------------------------------------------------------------------

  private buildKnowledgeBundle(
    result: { sources: KnowledgeSourceItem[]; confidence: number; hybridMetadata?: { rerankApplied: boolean; rerankBackend?: string; rerankDegraded?: boolean; vectorResults: number; bm25Results: number } },
    rerankDegraded: boolean,
    effectiveMinScore: number
  ): EvidenceBundle {
    const sources = result.sources || [];
    // Derive a clean rerank backend tag from the metadata (defensively default to 'mock').
    const rerankBackend: 'bge' | 'cohere' | 'generic' | 'mock' | 'none' =
      (result.hybridMetadata?.rerankBackend as 'bge' | 'cohere' | 'generic' | 'mock' | 'none') ?? 'mock';

    const candidates: EvidenceItem[] = sources.map(s => {
      const itemId = s.knowledge_item_id || s.id || '';
      return {
        id: itemId,
        type: 'knowledge' as const,
        content: s.content,
        relevanceScore: s.score,
        name: s.name,
        category: s.category,
        scoreOrigin: rerankDegraded ? ('mock' as const) : ('reranker' as const),
        // P2: propagate stable chunk identity from RPC
        chunkId: s.chunk_id ?? null,
        chunkIndex: s.chunk_index ?? 0,
        contentHash: s.content_hash ?? null,
        metadata: { rerankDegraded, rerankBackend, chunkId: s.chunk_id, contentHash: s.content_hash },
      };
    });

    // P0 fail-closed: only accept candidates above min_score
    // Future: implement real reranker grade (relevant/ambiguous/irrelevant)
    const accepted = candidates.filter(c => c.relevanceScore >= effectiveMinScore);

    // P0 fail-closed: public citations are presented only after a real cross-encoder
    // has graded candidate relevance. This is an eligibility gate, not claim-level
    // attribution: it does not prove every generated statement is supported.
    //   - rerankDegraded=true  -> citations=[]
    //   - rerankDegraded=false -> citations=accepted (relevance-graded)
    //
    // Internal context remains available to generation even when public citations
    // are withheld. A future claim verifier can further narrow eligible citations.
    const citations: CitationItem[] = rerankDegraded
      ? []
      : accepted.map(c => ({
          type: 'knowledge',
          content: c.content,
          score: c.relevanceScore,
          // P2: stable chunk identity on every citation
          knowledge_item_id: c.id,
          chunk_id: c.chunkId ?? null,
          chunk_index: c.chunkIndex ?? 0,
          content_hash: c.contentHash ?? null,
          name: c.name,
          category: c.category,
          provenanceVersion: 2 as const,
        }));

    const trace: EvidenceTrace = {
      provenanceVersion: 2,
      retrievalRan: true,
      rerankDegraded,
      hybridSearch: !!result.hybridMetadata,
      candidateCount: candidates.length,
      acceptedCount: accepted.length,
      citationCount: citations.length,
      minScore: effectiveMinScore,
      executionTimeMs: 0,
      degradationReasons: rerankDegraded ? ['reranker_fallback'] : [],
      // P1: include the rerank backend tag (e.g. 'mock' vs 'bge') so callers can
      // tell the difference between "real cross-encoder" and "fallback" scores.
      rerankBackend,
    };

    return { candidates, accepted, citations, trace };
  }

  // ---------------------------------------------------------------------------
  // Private: Build product bundle
  // ---------------------------------------------------------------------------

  private buildProductBundle(result: { productContext?: string; productSources?: unknown[] }): EvidenceBundle {
    return {
      candidates: [],
      accepted: [],
      citations: [],
      trace: {
        provenanceVersion: 2,
        retrievalRan: !!result.productContext,
        rerankDegraded: true,
        rerankBackend: 'none',
        hybridSearch: false,
        candidateCount: 0,
        acceptedCount: 0,
        citationCount: 0,
        minScore: 0,
        executionTimeMs: 0,
        degradationReasons: result.productContext ? ['product_citation_unverified'] : [],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Build size chart bundle
  // ---------------------------------------------------------------------------

  private buildSizeChartBundle(result: { sizeChartContext?: string }): EvidenceBundle {
    return {
      candidates: [],
      accepted: [],
      citations: [],
      trace: {
        provenanceVersion: 2,
        retrievalRan: !!result.sizeChartContext,
        rerankDegraded: true,
        rerankBackend: 'none',
        hybridSearch: false,
        candidateCount: 0,
        acceptedCount: 0,
        citationCount: 0,
        minScore: 0,
        executionTimeMs: 0,
        degradationReasons: result.sizeChartContext ? ['size_chart_citation_unverified'] : [],
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Merge evidence bundles
  // ---------------------------------------------------------------------------

  private mergeEvidenceBundles(
    meta: {
      retrievalRan: boolean;
      hybridSearch: boolean;
      degradationReasons: string[];
      minScore: number;
      executionTimeMs: number;
    },
    knowledge?: EvidenceBundle | null,
    product?: EvidenceBundle | null,
    sizeChart?: EvidenceBundle | null
  ): EvidenceBundle {
    const allCandidates = [
      ...(knowledge?.candidates || []),
      ...(product?.candidates || []),
      ...(sizeChart?.candidates || []),
    ];
    const allAccepted = [
      ...(knowledge?.accepted || []),
      ...(product?.accepted || []),
      ...(sizeChart?.accepted || []),
    ];
    const allCitations = [
      ...(knowledge?.citations || []),
      ...(product?.citations || []),
      ...(sizeChart?.citations || []),
    ];

    // Treat only present bundles; missing = no information, do NOT force degraded=true.
    const presentBundles = [knowledge, product, sizeChart].filter(
      (b): b is EvidenceBundle => b !== null && b !== undefined
    );

    const rerankDegraded =
      presentBundles.length === 0
        ? !meta.retrievalRan
        : presentBundles.some(b => b.trace.rerankDegraded);
    const degradationReasons = [
      ...new Set([
        ...meta.degradationReasons,
        ...presentBundles.flatMap(bundle => bundle.trace.degradationReasons),
      ]),
    ];

    // Prefer the most informative rerank backend (any non-mock value wins over 'mock')
    const backendOrder: Record<string, number> = { 'none': 0, 'mock': 1, 'generic': 2, 'cohere': 3, 'bge': 4 };
    const rerankBackend: 'bge' | 'cohere' | 'generic' | 'mock' | 'none' =
      presentBundles.length === 0
        ? (meta.retrievalRan ? 'mock' : 'none')
        : (presentBundles
            .map(b => b.trace.rerankBackend ?? 'mock')
            .sort((a, b) => (backendOrder[b] || 0) - (backendOrder[a] || 0))[0] as 'bge' | 'cohere' | 'generic' | 'mock' | 'none');

    return {
      candidates: allCandidates,
      accepted: allAccepted,
      citations: allCitations,
      trace: {
        provenanceVersion: 2,
        retrievalRan: meta.retrievalRan,
        rerankDegraded,
        rerankBackend,
        hybridSearch: meta.hybridSearch,
        candidateCount: allCandidates.length,
        acceptedCount: allAccepted.length,
        citationCount: allCitations.length,
        minScore: meta.minScore,
        executionTimeMs: meta.executionTimeMs,
        degradationReasons,
      },
    };
  }

// ---------------------------------------------------------------------------
// Private: Product search
// ---------------------------------------------------------------------------

  private async productSearch(query: string): Promise<{ productContext?: string; productSources?: unknown[] }> {
    const productService = new ProductDetailService();
    if ('searchProductsForLLM' in productService) {
      return productService.searchProductsForLLM(query);
    }
    return {};
  }

  // ---------------------------------------------------------------------------
  // Private: Size chart search
  // ---------------------------------------------------------------------------

  private async sizeChartSearch(query: string): Promise<{ sizeChartContext?: string }> {
    const sizeChartService = new SizeChartService();
    if ('searchSizeChartsForLLM' in sizeChartService) {
      return sizeChartService.searchSizeChartsForLLM(query);
    }
    return {};
  }
}
