import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { getHybridSearchService } from '@/server/services/hybrid-search-service';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

// GET /api/knowledge/eval/config - Get retrieval config
// PUT /api/knowledge/eval/config - Update retrieval config
export async function GET() {
  try {
    if (isDemoMode()) {
      return NextResponse.json({
        config: {
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
        },
        is_demo: true,
      });
    }

    const client = getSupabaseClient();
    const { data } = await client
      .from('retrieval_configs')
      .select('*')
      .eq('is_active', true)
      .single();

    return NextResponse.json({
      config: data?.config_value || {},
      is_demo: false,
    });
  } catch (error) {
    logger.api.error('Failed to get retrieval config', { error });
    return NextResponse.json({ error: 'Failed to get retrieval config' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Only admin can update config
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const {
      vector_weight,
      bm25_weight,
      rerank_enabled,
      rerank_top_n,
      rerank_model,
      vector_top_k,
      bm25_top_k,
      rrf_k,
      min_score_threshold,
      parent_chunk_enabled,
    } = body;

    // Validate weights
    if (
      (vector_weight !== undefined && (vector_weight < 0 || vector_weight > 1)) ||
      (bm25_weight !== undefined && (bm25_weight < 0 || bm25_weight > 1))
    ) {
      return NextResponse.json({ error: 'Weights must be between 0 and 1' }, { status: 400 });
    }

    const config = {
      vectorWeight: vector_weight ?? 0.6,
      bm25Weight: bm25_weight ?? 0.4,
      rerankEnabled: rerank_enabled ?? true,
      rerankTopN: rerank_top_n ?? 5,
      rerankModel: rerank_model ?? 'bge-reranker-v2-m3',
      vectorTopK: vector_top_k ?? 20,
      bm25TopK: bm25_top_k ?? 20,
      rrfK: rrf_k ?? 60,
      minScoreThreshold: min_score_threshold ?? 0.75,
      parentChunkEnabled: parent_chunk_enabled ?? false,
    };

    // Update in-memory service
    const service = getHybridSearchService();
    await service.updateConfig(config);

    // Persist to database
    if (!isDemoMode()) {
      const client = getSupabaseClient();
      await client
        .from('retrieval_configs')
        .update({
          config_value: config,
          updated_at: new Date().toISOString(),
        })
        .eq('is_active', true);
    }

    return NextResponse.json({ config, updated: true });
  } catch (error) {
    logger.api.error('Failed to update retrieval config', { error });
    return NextResponse.json({ error: 'Failed to update retrieval config' }, { status: 500 });
  }
}
