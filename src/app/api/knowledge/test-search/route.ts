import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

interface TestSearchRequest {
  query: string;
  mode: 'vector' | 'hybrid';
  min_score: number;
  limit: number;
  show_filtered?: boolean;
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
  rerank_applied?: boolean;
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
export async function POST(request: NextRequest) {
  try {
    const body: TestSearchRequest = await request.json();
    const { query, mode, min_score, limit, show_filtered } = body;

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

    // Build URL for hybrid search API
    const params = new URLSearchParams({
      query: trimmedQuery,
      min_score: String(effectiveMinScore),
      limit: String(effectiveLimit),
    });

    if (show_filtered) {
      params.set('show_filtered', 'true');
    }

    // Call hybrid search API
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000';
    const hybridResponse = await fetch(
      `${baseUrl}/api/knowledge/search/hybrid?${params.toString()}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...Object.fromEntries(
            Object.entries(request.headers).filter(([key]) =>
              ['cookie', 'authorization'].includes(key.toLowerCase())
            )
          ),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!hybridResponse.ok) {
      const errorText = await hybridResponse.text();
      logger.agent.error('[TestSearch] Hybrid API failed', {
        status: hybridResponse.status,
        error: errorText,
      });
      return NextResponse.json(
        { success: false, error: 'Search service error' },
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
    let avgScore = 0;

    if (mode === 'hybrid') {
      results = (hybridData.hybrid?.results || []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        content: r.content as string,
        score: Math.round((r.score as number) * 1000) / 1000,
        name: r.name as string | undefined,
        category: r.category as string | undefined,
        source: r.source as string | undefined,
      }));
      executionTimeMs = hybridData.hybrid?.execution_time_ms || 0;
      vectorResults = hybridData.hybrid?.vector_results || 0;
      bm25Results = hybridData.hybrid?.bm25_results || 0;
      rerankApplied = hybridData.hybrid?.rerank_applied || false;
      avgScore = hybridData.hybrid?.avg_score || 0;
    } else {
      // Vector mode - get raw vector results without filtering
      const rawParams = new URLSearchParams({
        query: query.trim(),
        min_score: '0', // Get all results
        limit: String(effectiveLimit * 4), // Get more to see what's filtered
        skip_rerank: 'true',
      });

      if (show_filtered) {
        rawParams.set('show_filtered', 'true');
      }

      const vectorResponse = await fetch(
        `${baseUrl}/api/knowledge/search/hybrid?${rawParams.toString()}`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...Object.fromEntries(
              Object.entries(request.headers).filter(([key]) =>
                ['cookie', 'authorization'].includes(key.toLowerCase())
              )
            ),
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );

      if (vectorResponse.ok) {
        const vectorData = await vectorResponse.json();
        results = (vectorData.vector?.sources || []).map((r: Record<string, unknown>) => ({
          id: r.knowledge_item_id as string || String(Math.random()),
          content: r.content as string,
          score: Math.round((r.score as number) * 1000) / 1000,
          name: r.name as string | undefined,
          category: r.category as string | undefined,
          source: 'vector',
        }));
        executionTimeMs = hybridData.vector?.execution_time_ms || 0;
        vectorResults = vectorData.vector?.total || 0;
        avgScore = vectorData.vector?.avg_score || 0;
      }
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
      rerank_applied: rerankApplied,
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
    logger.agent.error('[TestSearch] Search failed', { error });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
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
