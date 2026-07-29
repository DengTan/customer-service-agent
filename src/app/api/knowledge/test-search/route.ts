import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

interface TestSearchRequest {
  query: string;
  mode: 'vector' | 'hybrid';
  min_score: number;
  limit: number;
  show_filtered?: boolean;
  rerank_enabled?: boolean;
}

interface SearchResult {
  id: string;
  content: string;
  score: number;
  name?: string;
  category?: string;
  source?: string;
}

interface TestSearchResponse {
  success: boolean;
  query: string;
  mode: string;
  results: SearchResult[];
  total: number;
  execution_time_ms: number;
  vector_results?: number;
  bm25_results?: number;
  rerank_requested?: boolean;
  rerank_applied?: boolean;
  rerank_backend?: 'bge' | 'cohere' | 'generic' | 'mock' | 'none';
  rerank_degraded?: boolean;
  avg_score?: number;
  filtered?: {
    total: number;
    items: Array<{
      id: string;
      content: string;
      score: number;
      filterReason: string;
      name?: string;
      category?: string;
    }>;
  };
  termAnalysis?: {
    queryTerms: string[];
    matchedTerms: string[];
    unmatchedTerms: string[];
  };
  error?: string;
}

const MAX_QUERY_LENGTH = 500;
const VALID_LIMIT_RANGE = { min: 1, max: 20 };
const VALID_MIN_SCORE_RANGE = { min: 0, max: 1 };
const REQUEST_TIMEOUT_MS = 30000;

// POST /api/knowledge/test-search - Test search API
// Note: This is a test/debug endpoint that operates within the authenticated session.
// Actual knowledge retrieval in production goes through /api/conversations/[id]/messages
// which requires authentication. This endpoint is for QA/debugging purposes only.
export async function POST(request: NextRequest) {
  try {
    const body: TestSearchRequest = await request.json();
    const { query, mode, min_score, limit, show_filtered, rerank_enabled } = body;

    // Track detailed error for hybrid API failure
    let hybridError = '';

    // Validate required fields
    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'query is required' },
        { status: 400 }
      );
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { success: false, error: `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` },
        { status: 400 }
      );
    }

    if (!mode || !['vector', 'hybrid'].includes(mode)) {
      return NextResponse.json(
        { success: false, error: 'mode must be "vector" or "hybrid"' },
        { status: 400 }
      );
    }

    // Validate and clamp min_score
    const rawMinScore = min_score ?? 0.75;
    if (typeof rawMinScore !== 'number' || !Number.isFinite(rawMinScore)) {
      return NextResponse.json(
        { success: false, error: 'min_score must be a valid number' },
        { status: 400 }
      );
    }
    const effectiveMinScore = Math.max(
      VALID_MIN_SCORE_RANGE.min,
      Math.min(VALID_MIN_SCORE_RANGE.max, rawMinScore)
    );

    // Validate and clamp limit
    const rawLimit = limit ?? 5;
    if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
      return NextResponse.json(
        { success: false, error: 'limit must be a valid number' },
        { status: 400 }
      );
    }
    const effectiveLimit = Math.max(
      VALID_LIMIT_RANGE.min,
      Math.min(VALID_LIMIT_RANGE.max, Math.round(rawLimit))
    );

    // Default: rerank enabled for hybrid, disabled for vector
    const effectiveRerankEnabled = mode === 'vector'
      ? false
      : (rerank_enabled ?? true);
    const effectiveSkipRerank = !effectiveRerankEnabled;

    // Build URL for hybrid search API
    const params = new URLSearchParams({
      query: trimmedQuery,
      min_score: String(effectiveMinScore),
      limit: String(effectiveLimit),
    });

    if (show_filtered) {
      params.set('show_filtered', 'true');
    }

    if (effectiveSkipRerank) {
      params.set('skip_rerank', 'true');
    }

    // Call hybrid search API
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000';
    const hybridResponse = await fetch(
      `${baseUrl}/api/knowledge/search/hybrid?${params.toString()}`,
      {
        headers: {
          'Content-Type': 'application/json',
          // No cookie forwarding — both APIs are same-process Next.js route handlers
        },
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
      return NextResponse.json(
        { success: false, error: 'Search service error', detail: hybridError },
        { status: 502 }
      );
    }

    const hybridData = await hybridResponse.json();

    // Extract results based on mode
    let results: SearchResult[] = [];
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
        score: Number.isFinite(r.score as number)
          ? Math.round((r.score as number) * 1000) / 1000
          : 0,
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
      // Vector mode — extract raw vector results from the already-fetched hybrid response.
      // The hybrid API returns both hybrid.* and vector.* data in one call.
      results = (hybridData.vector?.sources || []).map((r: Record<string, unknown>, index: number) => ({
        id: (r.knowledge_item_id as string) || `vector-${index}`,
        content: r.content as string,
        score: Number.isFinite(r.score as number)
          ? Math.round((r.score as number) * 1000) / 1000
          : 0,
        name: r.name as string | undefined,
        category: r.category as string | undefined,
        source: 'vector',
      }));
      executionTimeMs = hybridData.vector?.execution_time_ms || 0;
      vectorResults = hybridData.vector?.sources?.length ?? 0;
      avgScore = hybridData.vector?.avg_score ?? 0;
      // BM25 is not used in vector-only mode
    }

    const response: TestSearchResponse = {
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

    // Add filtered results if requested
    if (show_filtered && hybridData.filtered) {
      response.filtered = hybridData.filtered;
    }

    // Add term analysis if requested
    if (show_filtered && hybridData.termAnalysis) {
      response.termAnalysis = hybridData.termAnalysis;
    }

    logger.agent.debug('[TestSearch] Search completed', {
      query: query.slice(0, 30),
      mode,
      resultCount: results.length,
      executionTimeMs,
    });

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.agent.error('[TestSearch] Search failed', { error: errorMessage });
    return NextResponse.json(
      { success: false, error: 'Internal server error', detail: errorMessage },
      { status: 500 }
    );
  }
}

// GET /api/knowledge/test-search - Get default config
export async function GET() {
  return NextResponse.json({
    defaultMinScore: 0.75,
    defaultLimit: 5,
    maxLimit: 20,
    minLimit: 1,
    modes: ['vector', 'hybrid'],
    description: 'Knowledge retrieval test API. POST with query, mode, min_score, limit, show_filtered.',
  });
}
