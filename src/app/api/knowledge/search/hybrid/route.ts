import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { getHybridSearchService } from '@/server/services/hybrid-search-service';
import { getKnowledgeSearchService } from '@/server/services/knowledge-search-service';
import { logger } from '@/lib/logger';

const MAX_QUERY_LENGTH = 500;
const VALID_LIMIT_RANGE = { min: 1, max: 50 };
const VALID_MIN_SCORE_RANGE = { min: 0, max: 1 };

// GET /api/knowledge/search/hybrid - Test hybrid search
// Query params: query, limit, min_score, skip_rerank, show_filtered
export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const query = searchParams.get('query');

      if (!query) {
        return new Response(JSON.stringify({ error: 'query parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const trimmedQuery = query.trim();
      if (trimmedQuery.length === 0) {
        return new Response(JSON.stringify({ error: 'query cannot be empty' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        return new Response(JSON.stringify({ error: `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let limit: number | undefined;
      const limitStr = searchParams.get('limit');
      if (limitStr !== null) {
        limit = parseInt(limitStr, 10);
        if (!Number.isFinite(limit) || limit < VALID_LIMIT_RANGE.min || limit > VALID_LIMIT_RANGE.max) {
          return new Response(JSON.stringify({ error: `limit must be between ${VALID_LIMIT_RANGE.min} and ${VALID_LIMIT_RANGE.max}` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      let minScore: number | undefined;
      const minScoreStr = searchParams.get('min_score');
      if (minScoreStr !== null) {
        minScore = parseFloat(minScoreStr);
        if (!Number.isFinite(minScore) || minScore < VALID_MIN_SCORE_RANGE.min || minScore > VALID_MIN_SCORE_RANGE.max) {
          return new Response(JSON.stringify({ error: `min_score must be between ${VALID_MIN_SCORE_RANGE.min} and ${VALID_MIN_SCORE_RANGE.max}` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      const skipRerank = searchParams.get('skip_rerank') === 'true';
      const showFiltered = searchParams.get('show_filtered') === 'true';

      const hybridService = getHybridSearchService();
      const hybridResult = await hybridService.search(trimmedQuery, {
        limit,
        minScore,
        skipRerank,
      });

      const vectorSearchStart = Date.now();
      const searchService = getKnowledgeSearchService();
      const vectorResult = await searchService.search(trimmedQuery, minScore, limit);
      const vectorSearchTimeMs = Date.now() - vectorSearchStart;

      const hybridScores = hybridResult.results.map(r => r.score);
      const vectorScores = vectorResult.sources.map(s => s.score);
      const avgHybridScore = hybridScores.length > 0
        ? hybridScores.reduce((a, b) => a + b, 0) / hybridScores.length
        : 0;
      const avgVectorScore = vectorScores.length > 0
        ? vectorScores.reduce((a, b) => a + b, 0) / vectorScores.length
        : 0;

      const response: Record<string, unknown> = {
        query: trimmedQuery,
        hybrid: {
          results: hybridResult.results,
          total: hybridResult.total,
          execution_time_ms: hybridResult.executionTimeMs,
          vector_results: hybridResult.vectorResults,
          bm25_results: hybridResult.bm25Results,
          rerank_applied: hybridResult.rerankApplied,
          rerank_backend: hybridResult.rerankBackend,
          rerank_degraded: hybridResult.rerankDegraded,
          avg_score: Math.round(avgHybridScore * 1000) / 1000,
        },
        vector: {
          sources: vectorResult.sources,
          total: vectorResult.sources.length,
          confidence: Math.round((vectorResult.confidence || 0) * 1000) / 1000,
          avg_score: Math.round(avgVectorScore * 1000) / 1000,
          execution_time_ms: vectorSearchTimeMs,
        },
        comparison: {
          hybrid_improvement: avgVectorScore > 0
            ? Math.round(((avgHybridScore - avgVectorScore) / avgVectorScore) * 100)
            : 0,
          hybrid_better: hybridResult.results.length > vectorResult.sources.length,
          hybrid_coverage: hybridResult.results.length,
          vector_coverage: vectorResult.sources.length,
        },
      };

      if (showFiltered) {
        const effectiveMinScore = minScore ?? hybridResult.config.minScoreThreshold;
        const filteredItems = hybridResult.candidates
          .filter(r => r.score < effectiveMinScore)
          .map(r => ({
            id: r.id,
            content: r.content.slice(0, 200),
            score: Math.round(r.score * 1000) / 1000,
            filterReason: `score < minScore (${Math.round(r.score * 1000) / 1000} < ${effectiveMinScore})`,
            name: r.name,
            category: r.category,
          }));

        response.filtered = {
          total: filteredItems.length,
          items: filteredItems,
        };

        const queryTerms = trimmedQuery
          .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
          .split(/\s+/)
          .filter(t => t.length >= 1)
          .slice(0, 20);

        const allContents = [
          ...hybridResult.results.map(r => r.content),
          ...(vectorResult.sources || []).map(s => s.content || ''),
        ].join(' ');

        const matchedTerms = queryTerms.filter(term => {
          const lowerTerm = term.toLowerCase();
          return allContents.toLowerCase().includes(lowerTerm);
        });

        const unmatchedTerms = queryTerms.filter(term => !matchedTerms.includes(term));

        response.termAnalysis = {
          queryTerms,
          matchedTerms,
          unmatchedTerms,
        };

        logger.agent.debug('[HybridSearch] show_filtered enabled', {
          query: trimmedQuery.slice(0, 30),
          filteredCount: (response.filtered as Record<string, unknown>).total,
        });
      }

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('Failed to run hybrid search test', { error });
      return new Response(JSON.stringify({ error: 'Failed to run hybrid search test' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
