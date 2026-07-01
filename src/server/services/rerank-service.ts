import { logger } from '@/lib/logger';

export interface RerankCandidate {
  id: string;
  content: string;
  originalScore: number;
  metadata?: Record<string, unknown>;
}

export interface RerankResult {
  id: string;
  content: string;
  rerankScore: number;
  originalScore: number;
  rank: number;
  metadata?: Record<string, unknown>;
}

export interface RerankConfig {
  model?: string;
  topN?: number;
  batchSize?: number;
}

const DEFAULT_RERANK_MODEL = 'bge-reranker-v2-m3';
const DEFAULT_TOP_N = 5;
const DEFAULT_BATCH_SIZE = 8;

/**
 * Rerank service using Cross-Encoder models.
 * Supports multiple backends: local model (bge-reranker), Cohere API.
 *
 * Rerank improves precision by re-scoring candidate documents
 * against the query using a more expensive but accurate cross-encoder.
 *
 * Typical pipeline:
 * 1. Vector search → Top-20 candidates
 * 2. BM25 search → Top-20 candidates
 * 3. RRF fusion → Top-30 candidates
 * 4. Rerank → Top-5 final results
 */
export class RerankService {
  private config: RerankConfig;

  constructor(config: RerankConfig = {}) {
    this.config = {
      model: config.model || DEFAULT_RERANK_MODEL,
      topN: config.topN || DEFAULT_TOP_N,
      batchSize: config.batchSize || DEFAULT_BATCH_SIZE,
    };
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<RerankConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Rerank a list of candidate documents.
   * Returns results sorted by cross-encoder relevance score.
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    topN?: number
  ): Promise<RerankResult[]> {
    if (!query || candidates.length === 0) {
      return [];
    }

    const top = topN || this.config.topN || DEFAULT_TOP_N;

    try {
      const startTime = Date.now();

      // Score all candidates using cross-encoder
      const scored = await this.scoreCandidates(query, candidates);

      // Sort by rerank score descending
      scored.sort((a, b) => b.rerankScore - a.rerankScore);

      // Take top-N and assign ranks
      const results: RerankResult[] = scored.slice(0, top).map((item, idx) => ({
        id: item.id,
        content: item.content,
        rerankScore: item.rerankScore,
        originalScore: item.originalScore,
        rank: idx + 1,
        metadata: item.metadata,
      }));

      const elapsed = Date.now() - startTime;
      logger.agent.debug('[Rerank] Completed', {
        model: this.config.model,
        candidates: candidates.length,
        returned: results.length,
        elapsedMs: elapsed,
      });

      return results;
    } catch (err) {
      logger.agent.error('[Rerank] Failed', { error: err, candidates: candidates.length });
      // Fallback: return original order, normalize scores
      return candidates.slice(0, top).map((c, idx) => ({
        id: c.id,
        content: c.content,
        rerankScore: c.originalScore,
        originalScore: c.originalScore,
        rank: idx + 1,
        metadata: c.metadata,
      }));
    }
  }

  /**
   * Score candidates using the configured rerank model.
   * This is a pluggable implementation that can be extended to support different backends.
   */
  private async scoreCandidates(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<Array<RerankCandidate & { rerankScore: number }>> {
    const model = this.config.model || DEFAULT_RERANK_MODEL;

    // Try different rerank backends based on model type
    if (model.startsWith('cohere')) {
      return this.scoreWithCohere(query, candidates);
    } else if (model.startsWith('bge-reranker')) {
      return this.scoreWithBGE(query, candidates);
    } else if (model === 'mock' || !process.env.RERANK_API_URL) {
      // Mock mode: use a simple relevance heuristic as fallback
      return this.scoreWithMock(query, candidates);
    } else {
      // Generic API mode
      return this.scoreWithGenericAPI(query, candidates);
    }
  }

  /**
   * Score using BGE Reranker model via local inference or API.
   */
  private async scoreWithBGE(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<Array<RerankCandidate & { rerankScore: number }>> {
    const apiUrl = process.env.BGE_RERANK_API_URL;
    const apiKey = process.env.BGE_RERANK_API_KEY;

    if (!apiUrl) {
      // Fall back to mock scoring
      return this.scoreWithMock(query, candidates);
    }

    try {
      // BGE Rerank API format
      const response = await fetch(`${apiUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          query,
          documents: candidates.map(c => c.content),
          top_n: candidates.length,
        }),
      });

      if (!response.ok) {
        logger.agent.warn('[Rerank] BGE API error, falling back to mock', {
          status: response.status,
        });
        return this.scoreWithMock(query, candidates);
      }

      const data = await response.json() as {
        results: Array<{ index: number; relevance_score: number }>;
      };

      return candidates.map((c, idx) => ({
        ...c,
        rerankScore: data.results.find(r => r.index === idx)?.relevance_score ?? 0,
      }));
    } catch (err) {
      logger.agent.warn('[Rerank] BGE scoring failed, using mock', { error: err });
      return this.scoreWithMock(query, candidates);
    }
  }

  /**
   * Score using Cohere Rerank API.
   */
  private async scoreWithCohere(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<Array<RerankCandidate & { rerankScore: number }>> {
    const apiKey = process.env.COHERE_API_KEY;

    if (!apiKey) {
      return this.scoreWithMock(query, candidates);
    }

    try {
      const response = await fetch('https://api.cohere.ai/v1/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'rerank-multilingual-v3.0',
          query,
          documents: candidates.map(c => c.content),
          top_n: candidates.length,
          return_documents: false,
        }),
      });

      if (!response.ok) {
        return this.scoreWithMock(query, candidates);
      }

      const data = await response.json() as {
        results: Array<{ index: number; relevance_score: number }>;
      };

      return candidates.map((c, idx) => ({
        ...c,
        rerankScore: data.results.find(r => r.index === idx)?.relevance_score ?? 0,
      }));
    } catch (err) {
      logger.agent.warn('[Rerank] Cohere scoring failed, using mock', { error: err });
      return this.scoreWithMock(query, candidates);
    }
  }

  /**
   * Score using a generic rerank API.
   */
  private async scoreWithGenericAPI(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<Array<RerankCandidate & { rerankScore: number }>> {
    const apiUrl = process.env.RERANK_API_URL;
    const apiKey = process.env.RERANK_API_KEY;

    if (!apiUrl) {
      return this.scoreWithMock(query, candidates);
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query,
          documents: candidates.map(c => ({ id: c.id, content: c.content, ...c.metadata })),
          top_n: candidates.length,
        }),
      });

      if (!response.ok) {
        return this.scoreWithMock(query, candidates);
      }

      const data = await response.json() as {
        scores: Array<{ id: string; score: number }>;
      };

      const scoreMap = new Map(data.scores.map(s => [s.id, s.score]));
      return candidates.map(c => ({
        ...c,
        rerankScore: scoreMap.get(c.id) ?? 0,
      }));
    } catch (err) {
      logger.agent.warn('[Rerank] Generic API scoring failed, using mock', { error: err });
      return this.scoreWithMock(query, candidates);
    }
  }

  /**
   * Mock scoring: use keyword overlap + original score as heuristic.
   * This provides a baseline rerank effect without requiring an external model.
   */
  private scoreWithMock(
    query: string,
    candidates: RerankCandidate[]
  ): Array<RerankCandidate & { rerankScore: number }> {
    // Extract keywords from query
    const queryTerms = new Set(
      query
        .toLowerCase()
        .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g)
        ?.map(t => t.toLowerCase()) || []
    );

    return candidates.map(c => {
      const contentTerms = new Set(
        c.content
          .toLowerCase()
          .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g)
          ?.map(t => t.toLowerCase()) || []
      );

      // Calculate keyword overlap
      let overlap = 0;
      for (const term of queryTerms) {
        if (contentTerms.has(term)) overlap++;
      }
      const overlapScore = queryTerms.size > 0 ? overlap / queryTerms.size : 0;

      // Combine original score (50%) with keyword overlap (50%)
      const rerankScore = c.originalScore * 0.5 + overlapScore * 0.5;

      return { ...c, rerankScore };
    });
  }

  /**
   * Calculate improvement metrics between original and reranked results.
   */
  calculateImprovement(
    originalResults: RerankCandidate[],
    rerankedResults: RerankResult[]
  ): {
    mrrImprovement: number;
    positionChanges: number;
    top1Preserved: boolean;
  } {
    if (originalResults.length === 0 || rerankedResults.length === 0) {
      return { mrrImprovement: 0, positionChanges: 0, top1Preserved: false };
    }

    // Calculate original MRR
    const originalMrr = this.calculateMRR(originalResults.map((r, i) => ({
      ...r,
      rank: i + 1,
    })));

    // Calculate reranked MRR
    const rerankedMrr = this.calculateMRR(rerankedResults);

    // Count position changes
    let positionChanges = 0;
    for (let i = 0; i < Math.min(originalResults.length, rerankedResults.length); i++) {
      const originalIdx = originalResults.findIndex(r => r.id === rerankedResults[i].id);
      if (originalIdx !== -1 && originalIdx !== i) {
        positionChanges++;
      }
    }

    return {
      mrrImprovement: originalMrr > 0 ? ((rerankedMrr - originalMrr) / originalMrr) * 100 : 0,
      positionChanges,
      top1Preserved: rerankedResults[0]?.id === originalResults[0]?.id,
    };
  }

  /**
   * Calculate Mean Reciprocal Rank (MRR).
   */
  private calculateMRR(results: Array<{ id: string; rank: number }>): number {
    if (results.length === 0) return 0;
    // Assuming the "correct" answer is the first in original ranking
    // In practice, this would use ground truth from QA tests
    const reciprocalRank = 1 / results[0].rank;
    return reciprocalRank;
  }
}

// Singleton instance
let rerankServiceInstance: RerankService | null = null;

export function resetRerankService(): void {
  rerankServiceInstance = null;
}

export function getRerankService(config?: RerankConfig): RerankService {
  if (!config) {
    if (rerankServiceInstance) return rerankServiceInstance;
  }
  if (!rerankServiceInstance) {
    rerankServiceInstance = new RerankService(config);
  } else if (config) {
    rerankServiceInstance.updateConfig(config);
  }
  return rerankServiceInstance;
}
