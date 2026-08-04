/**
 * Knowledge eval config API
 */

import { withApi } from '@/lib/api/with-api';
import { getHybridSearchService } from '@/server/services/hybrid-search-service';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async () => {
    try {
      if (isDemoMode()) {
        return new Response(JSON.stringify({
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
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const client = getSupabaseClient();
      const { data } = await client
        .from('retrieval_configs')
        .select('*')
        .eq('is_active', true)
        .single();

      return new Response(JSON.stringify({
        config: data?.config_value || {},
        is_demo: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      logger.api.error('Failed to get retrieval config', { error });
      return new Response(JSON.stringify({ error: 'Failed to get retrieval config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    try {
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

      if (
        (vector_weight !== undefined && (vector_weight < 0 || vector_weight > 1)) ||
        (bm25_weight !== undefined && (bm25_weight < 0 || bm25_weight > 1))
      ) {
        return new Response(JSON.stringify({ error: 'Weights must be between 0 and 1' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
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

      const service = getHybridSearchService();
      await service.updateConfig(config);

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

      return new Response(JSON.stringify({ config, updated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Failed to update retrieval config', { error });
      return new Response(JSON.stringify({ error: 'Failed to update retrieval config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
