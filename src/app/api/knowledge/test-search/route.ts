import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { logger } from '@/lib/logger';

const MAX_QUERY_LENGTH = 500;
const VALID_LIMIT_RANGE = { min: 1, max: 20 };
const VALID_MIN_SCORE_RANGE = { min: 0, max: 1 };
const REQUEST_TIMEOUT_MS = 30000;

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async () => {
    return new Response(JSON.stringify({
      defaultMinScore: 0.75,
      defaultLimit: 5,
      maxLimit: 20,
      minLimit: 1,
      modes: ['vector', 'hybrid'],
      description: 'Knowledge retrieval test API. POST with query, mode, min_score, limit, show_filtered.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const { query, mode, min_score, limit, show_filtered, rerank_enabled } = body;

      let hybridError = '';

      if (!query || query.trim().length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'query is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const trimmedQuery = query.trim();
      if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        return new Response(JSON.stringify({ success: false, error: `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!mode || !['vector', 'hybrid'].includes(mode)) {
        return new Response(JSON.stringify({ success: false, error: 'mode must be "vector" or "hybrid"' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rawMinScore = min_score ?? 0.75;
      if (typeof rawMinScore !== 'number' || !Number.isFinite(rawMinScore)) {
        return new Response(JSON.stringify({ success: false, error: 'min_score must be a valid number' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const effectiveMinScore = Math.max(VALID_MIN_SCORE_RANGE.min, Math.min(VALID_MIN_SCORE_RANGE.max, rawMinScore));

      const rawLimit = limit ?? 5;
      if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
        return new Response(JSON.stringify({ success: false, error: 'limit must be a valid number' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const effectiveLimit = Math.max(VALID_LIMIT_RANGE.min, Math.min(VALID_LIMIT_RANGE.max, Math.round(rawLimit)));

      const effectiveRerankEnabled = mode === 'vector' ? false : (rerank_enabled ?? true);
      const effectiveSkipRerank = !effectiveRerankEnabled;

      const params = new URLSearchParams({
        query: trimmedQuery,
        min_score: String(effectiveMinScore),
        limit: String(effectiveLimit),
      });

      if (show_filtered) params.set('show_filtered', 'true');
      if (effectiveSkipRerank) params.set('skip_rerank', 'true');

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000';
      const hybridResponse = await fetch(
        `${baseUrl}/api/knowledge/search/hybrid?${params.toString()}`,
        {
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );

      if (!hybridResponse.ok) {
        const errorText = await hybridResponse.text();
        hybridError = `[${hybridResponse.status}] ${errorText.slice(0, 200)}`;
        logger.agent.error('[TestSearch] Hybrid API failed', {
          status: hybridResponse.status,
          error: errorText,
        });
        return new Response(JSON.stringify({ success: false, error: 'Search service error', detail: hybridError }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const hybridData = await hybridResponse.json();

      let results: Array<{id: string; content: string; score: number; name?: string; category?: string; source?: string}> = [];
      let executionTimeMs = 0;
      let vectorResults = 0;
      let bm25Results = 0;
      let rerankApplied = false;
      let rerankBackend: 'bge' | 'cohere' | 'generic' | 'mock' | 'none' = 'none';
      let rerankDegraded = false;
      let avgScore = 0;

      if (mode === 'hybrid') {
        results = (hybridData.hybrid?.results || []).map((r: Record<string, unknown>) => ({
          id: r.id as string,
          content: r.content as string,
          score: Number.isFinite(r.score as number) ? Math.round((r.score as number) * 1000) / 1000 : 0,
          name: r.name as string | undefined,
          category: r.category as string | undefined,
          source: r.source as string | undefined,
        }));
        executionTimeMs = hybridData.hybrid?.execution_time_ms || 0;
        vectorResults = hybridData.hybrid?.vector_results || 0;
        bm25Results = hybridData.hybrid?.bm25_results || 0;
        rerankApplied = hybridData.hybrid?.rerank_applied ?? false;
        rerankBackend = hybridData.hybrid?.rerank_backend ?? 'none';
        rerankDegraded = hybridData.hybrid?.rerank_degraded ?? false;
        avgScore = hybridData.hybrid?.avg_score ?? 0;
      } else {
        results = (hybridData.vector?.sources || []).map((r: Record<string, unknown>, index: number) => ({
          id: (r.knowledge_item_id as string) || `vector-${index}`,
          content: r.content as string,
          score: Number.isFinite(r.score as number) ? Math.round((r.score as number) * 1000) / 1000 : 0,
          name: r.name as string | undefined,
          category: r.category as string | undefined,
          source: 'vector',
        }));
        executionTimeMs = hybridData.vector?.execution_time_ms || 0;
        vectorResults = hybridData.vector?.sources?.length ?? 0;
        avgScore = hybridData.vector?.avg_score ?? 0;
      }

      const response: Record<string, unknown> = {
        success: true,
        query,
        mode,
        results,
        total: results.length,
        execution_time_ms: executionTimeMs,
        vector_results: vectorResults,
        bm25_results: bm25Results,
        rerank_requested: effectiveRerankEnabled,
        rerank_applied: rerankApplied,
        rerank_backend: rerankBackend,
        rerank_degraded: rerankDegraded,
        avg_score: avgScore,
      };

      if (show_filtered && hybridData.filtered) {
        response.filtered = hybridData.filtered;
      }

      if (show_filtered && hybridData.termAnalysis) {
        response.termAnalysis = hybridData.termAnalysis;
      }

      logger.agent.debug('[TestSearch] Search completed', {
        query: query.slice(0, 30),
        mode,
        resultCount: results.length,
        executionTimeMs,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.agent.error('[TestSearch] Search failed', { error: errorMessage });
      return new Response(JSON.stringify({ success: false, error: 'Internal server error', detail: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
