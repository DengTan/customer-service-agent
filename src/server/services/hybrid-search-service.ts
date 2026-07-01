import { KnowledgeClient, Config } from 'coze-coding-dev-sdk';
import { Bm25SearchService, getBm25Service, Bm25Result } from './bm25-search-service';
import { getRerankService, resetRerankService, RerankCandidate, RerankResult } from './rerank-service';
import { logger } from '@/lib/logger';
import { SettingsRepository } from '@/server/repositories/settings-repository';

export interface HybridSearchConfig {
  vectorWeight: number;
  bm25Weight: number;
  rerankEnabled: boolean;
  rerankTopN: number;
  rerankModel: string;
  vectorTopK: number;
  bm25TopK: number;
  rrfK: number;
  minScoreThreshold: number;
  parentChunkEnabled: boolean;
}

export interface HybridSearchResult {
  id: string;
  content: string;
  name: string;
  category: string;
  score: number;
  source: 'vector' | 'bm25' | 'hybrid';
  rank: number;
  metadata?: Record<string, unknown>;
}

export interface HybridSearchResponse {
  results: HybridSearchResult[];
  total: number;
  query: string;
  config: HybridSearchConfig;
  executionTimeMs: number;
  vectorResults: number;
  bm25Results: number;
  rerankApplied: boolean;
}

// Default configuration
const DEFAULT_CONFIG: HybridSearchConfig = {
  vectorWeight: 0.6,
  bm25Weight: 0.4,
  rerankEnabled: true,
  rerankTopN: 5,
  rerankModel: 'bge-reranker-v2-m3',
  vectorTopK: 20,
  bm25TopK: 20,
  rrfK: 60,
  minScoreThreshold: 0.75,
  parentChunkEnabled: false,
};

/**
 * Hybrid Search Service
 *
 * Implements the RAG document's recommended hybrid search pipeline:
 * 1. Vector search (semantic understanding) → Top-K1
 * 2. BM25 keyword search → Top-K2
 * 3. RRF (Reciprocal Rank Fusion) → Top-N candidates
 * 4. Rerank (Cross-Encoder) → Top-N final results
 *
 * Benefits:
 * - Vector: handles synonyms, semantic similarity
 * - BM25: exact keyword matching, technical terms
 * - RRF: robust fusion without score normalization
 * - Rerank: precise relevance scoring
 */
export class HybridSearchService {
  private bm25Service: Bm25SearchService;
  private config: HybridSearchConfig;
  private settingsRepository: SettingsRepository;
  private configCache: { config: HybridSearchConfig; cachedAt: number } | null = null;
  private readonly CONFIG_CACHE_TTL_MS = 30_000;

  constructor() {
    this.bm25Service = getBm25Service();
    this.config = { ...DEFAULT_CONFIG };
    this.settingsRepository = new SettingsRepository();
  }

  /**
   * Load configuration from settings table.
   */
  async loadConfig(): Promise<HybridSearchConfig> {
    const now = Date.now();
    if (this.configCache && now - this.configCache.cachedAt < this.CONFIG_CACHE_TTL_MS) {
      return this.configCache.config;
    }

    try {
      const configStr = await this.settingsRepository.get('retrieval_hybrid_config');
      if (configStr) {
        try {
          const parsed = JSON.parse(configStr);
          this.config = { ...DEFAULT_CONFIG, ...parsed };
        } catch (parseErr) {
          logger.agent.warn('[HybridSearch] Failed to parse hybrid config, using defaults', { error: parseErr });
        }
      }
    } catch {
      // Use defaults
    }

    this.configCache = { config: this.config, cachedAt: now };
    return this.config;
  }

  /**
   * Main hybrid search method.
   * Combines vector search + BM25 + RRF + Rerank.
   */
  async search(
    query: string,
    options?: {
      limit?: number;
      minScore?: number;
      skipRerank?: boolean;
    }
  ): Promise<HybridSearchResponse> {
    const startTime = Date.now();
    const limit = options?.limit || this.config.rerankTopN;
    const minScore = options?.minScore ?? this.config.minScoreThreshold;
    const skipRerank = options?.skipRerank ?? !this.config.rerankEnabled;

    // Load fresh config
    await this.loadConfig();

    // Clean query
    const cleanQuery = this.stripToolCallPatterns(query);

    try {
      // Step 1: Parallel vector + BM25 search
      const [vectorResults, bm25Results] = await Promise.all([
        this.vectorSearch(cleanQuery),
        this.bm25Search(cleanQuery),
      ]);

      // Step 2: RRF fusion
      const fusedResults = this.rrfFusion(
        vectorResults,
        bm25Results,
        this.config.vectorTopK,
        this.config.bm25TopK
      );

      // Step 3: Rerank (if enabled)
      let finalResults: HybridSearchResult[];
      let rerankApplied = false;

      if (!skipRerank && fusedResults.length > 0) {
        const rerankService = getRerankService({ model: this.config.rerankModel });
        const candidates: RerankCandidate[] = fusedResults.map(r => ({
          id: r.id,
          content: r.content,
          originalScore: r.score,
          metadata: {
            name: r.name,
            category: r.category,
            source: r.source,
          },
        }));

        const reranked = await rerankService.rerank(cleanQuery, candidates, limit);
        finalResults = this.convertRerankResults(reranked);
        rerankApplied = true;
      } else {
        finalResults = fusedResults.slice(0, limit);
      }

      // Filter by min score
      const filteredResults = finalResults.filter(r => r.score >= minScore);

      const executionTimeMs = Date.now() - startTime;

      logger.agent.debug('[HybridSearch] Search completed', {
        query: cleanQuery.slice(0, 50),
        vectorResults: vectorResults.length,
        bm25Results: bm25Results.length,
        fusedResults: fusedResults.length,
        finalResults: filteredResults.length,
        rerankApplied,
        executionTimeMs,
      });

      return {
        results: filteredResults,
        total: filteredResults.length,
        query: cleanQuery,
        config: this.config,
        executionTimeMs,
        vectorResults: vectorResults.length,
        bm25Results: bm25Results.length,
        rerankApplied,
      };
    } catch (err) {
      logger.agent.error('[HybridSearch] Search failed', { error: err, query: cleanQuery });
      return {
        results: [],
        total: 0,
        query: cleanQuery,
        config: this.config,
        executionTimeMs: Date.now() - startTime,
        vectorResults: 0,
        bm25Results: 0,
        rerankApplied: false,
      };
    }
  }

  /**
   * Vector search using Coze SDK.
   */
  private async vectorSearch(query: string): Promise<HybridSearchResult[]> {
    try {
      const config = new Config();
      const client = new KnowledgeClient(config);

      const result = await client.search(
        query,
        undefined,
        this.config.vectorTopK,
        0 // No pre-filtering, get all results
      );

      if (result.code !== 0 || !result.chunks) {
        return [];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result.chunks as any[]).map(chunk => ({
        id: chunk.id || chunk.knowledge_item_id || `vec_${chunk.doc_id}`,
        content: chunk.content,
        name: chunk.name || '',
        category: chunk.category || '未分类',
        score: chunk.score,
        source: 'vector' as const,
        rank: 0,
        metadata: {
          docId: chunk.doc_id,
          knowledgeItemId: chunk.knowledge_item_id,
          originalScore: chunk.score, // Preserve original vector score for hybrid fusion
        },
      }));
    } catch (err) {
      logger.agent.warn('[HybridSearch] Vector search failed', { error: err });
      return [];
    }
  }

  /**
   * BM25 keyword search.
   */
  private async bm25Search(query: string): Promise<HybridSearchResult[]> {
    try {
      // Ensure index is built
      await this.bm25Service.ensureIndex();

      const results = this.bm25Service.search(query, this.config.bm25TopK);

      return results.map(r => ({
        id: r.id,
        content: r.content,
        name: r.name,
        category: r.category,
        score: r.score,
        source: 'bm25' as const,
        rank: 0,
        metadata: {
          knowledgeItemId: r.knowledge_item_id,
          chunkIndex: r.chunk_index,
          originalScore: r.score, // Preserve original BM25 score for hybrid fusion
        },
      }));
    } catch (err) {
      logger.agent.warn('[HybridSearch] BM25 search failed', { error: err });
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   *
   * Formula: RRF_score(d) = Σ 1/(k + rank_i(d))
   * k = smoothing constant (typically 60)
   *
   * This is robust because it doesn't require score normalization
   * and handles different score distributions well.
   */
  private rrfFusion(
    vectorResults: HybridSearchResult[],
    bm25Results: HybridSearchResult[],
    vectorTopK: number,
    bm25TopK: number
  ): HybridSearchResult[] {
    const k = this.config.rrfK;
    const scoreMap = new Map<string, {
      result: HybridSearchResult;
      rrfScore: number;
    }>();

    // Add vector results with RRF contribution
    for (let i = 0; i < Math.min(vectorResults.length, vectorTopK); i++) {
      const r = vectorResults[i];
      const rrfScore = 1 / (k + i + 1);
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.rrfScore += this.config.vectorWeight * rrfScore;
      } else {
        scoreMap.set(r.id, { result: { ...r }, rrfScore: this.config.vectorWeight * rrfScore });
      }
    }

    // Add BM25 results with RRF contribution
    for (let i = 0; i < Math.min(bm25Results.length, bm25TopK); i++) {
      const r = bm25Results[i];
      const rrfScore = 1 / (k + i + 1);
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.rrfScore += this.config.bm25Weight * rrfScore;
      } else {
        scoreMap.set(r.id, { result: { ...r }, rrfScore: this.config.bm25Weight * rrfScore });
      }
    }

    // Sort by RRF score
    // Compute hybrid scores: combine RRF rank-score with original vector/BM25 relevance
    // This preserves semantic relevance from original scores while benefiting from RRF fusion
    const scored = [...scoreMap.values()].map(item => {
      // Hybrid score: weighted combination of normalized RRF score and original relevance
      // RRF contribution: captures position bonus from being top-ranked in multiple retrieval methods
      // Original score contribution: preserves actual semantic/keyword relevance
      const rrfNormalized = item.rrfScore; // Already scaled by weights
      const originalScore = item.result.metadata?.originalScore as number | undefined;
      
      // Use geometric mean of RRF and original score for balanced fusion
      // This prevents RRF-only ranking and rewards high semantic relevance
      const hybridScore = originalScore !== undefined && originalScore > 0
        ? Math.sqrt(rrfNormalized * originalScore) // Geometric mean
        : rrfNormalized;
      
      return {
        ...item.result,
        score: hybridScore,
        source: 'hybrid' as const,
      };
    });

    const sorted = scored
      .sort((a, b) => b.score - a.score)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    return sorted;
  }

  /**
   * Convert rerank results back to HybridSearchResult format.
   */
  private convertRerankResults(reranked: RerankResult[]): HybridSearchResult[] {
    return reranked.map((r, idx) => ({
      id: r.id,
      content: r.content,
      name: (r.metadata as Record<string, unknown>)?.name as string || '',
      category: (r.metadata as Record<string, unknown>)?.category as string || '未分类',
      score: r.rerankScore,
      source: (r.metadata as Record<string, unknown>)?.source as 'vector' | 'bm25' | 'hybrid' || 'hybrid',
      rank: idx + 1,
      metadata: r.metadata,
    }));
  }

  /**
   * Strip tool call patterns to prevent prompt injection.
   */
  private stripToolCallPatterns(text: string): string {
    return text.replace(/\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g, '[工具调用已过滤]');
  }

  /**
   * Update configuration.
   */
  async updateConfig(config: Partial<HybridSearchConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    this.configCache = null; // Invalidate cache

    // 同步更新 rerank service 配置
    if (config.rerankModel || config.rerankEnabled !== undefined) {
      resetRerankService();
    }

    // Persist to settings
    try {
      await this.settingsRepository.set('retrieval_hybrid_config', JSON.stringify(this.config));
    } catch (err) {
      logger.agent.warn('[HybridSearch] Failed to persist config', { error: err });
    }
  }

  /**
   * Rebuild BM25 index.
   */
  async rebuildBm25Index(): Promise<void> {
    await this.bm25Service.buildIndex();
  }
}

// Singleton instance
let hybridServiceInstance: HybridSearchService | null = null;

export function getHybridSearchService(): HybridSearchService {
  if (!hybridServiceInstance) {
    hybridServiceInstance = new HybridSearchService();
  }
  return hybridServiceInstance;
}
