import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { getRetrievalEvalService } from '@/server/services/retrieval-eval-service';
import { logger } from '@/lib/logger';

// GET /api/knowledge/eval - Get aggregated evaluation metrics
// POST /api/knowledge/eval - Run evaluation
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const days = searchParams.get('days') ? parseInt(searchParams.get('days')!) : 30;
    const configId = searchParams.get('config_id') || undefined;

    const evalService = getRetrievalEvalService();
    const metrics = await evalService.getAggregatedMetrics({ days, configId });

    return NextResponse.json({
      metrics,
      period_days: days,
      config_id: configId,
    });
  } catch (error) {
    logger.api.error('Failed to get evaluation metrics', { error });
    return NextResponse.json({ error: 'Failed to get evaluation metrics' }, { status: 500 });
  }
}

// POST /api/knowledge/eval - Run evaluation on test set
export async function POST(request: NextRequest) {
  try {
    // Only admin can run evaluation
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { test_case_ids, top_k, rerank_enabled, vector_weight, bm25_weight } = body;

    const evalService = getRetrievalEvalService();
    const results = await evalService.runEvaluation(
      test_case_ids,
      {
        topK: top_k || 5,
        rerankEnabled: rerank_enabled ?? true,
        vectorWeight: vector_weight || 0.6,
        bm25Weight: bm25_weight || 0.4,
      }
    );

    // Calculate aggregated metrics
    const total = results.length;
    const avgRecall = results.reduce((sum, r) => sum + r.metrics.recallAtK, 0) / Math.max(total, 1);
    const avgMrr = results.reduce((sum, r) => sum + r.metrics.mrr, 0) / Math.max(total, 1);
    const avgNdcg = results.reduce((sum, r) => sum + r.metrics.ndcgAtK, 0) / Math.max(total, 1);
    const avgPrecision = results.reduce((sum, r) => sum + r.metrics.precisionAtK, 0) / Math.max(total, 1);

    return NextResponse.json({
      results,
      summary: {
        total_tests: total,
        avg_recall_at_k: Math.round(avgRecall * 1000) / 1000,
        avg_mrr: Math.round(avgMrr * 1000) / 1000,
        avg_ndcg_at_k: Math.round(avgNdcg * 1000) / 1000,
        avg_precision_at_k: Math.round(avgPrecision * 1000) / 1000,
      },
      config: {
        top_k: top_k || 5,
        rerank_enabled: rerank_enabled ?? true,
        vector_weight: vector_weight || 0.6,
        bm25_weight: bm25_weight || 0.4,
      },
    });
  } catch (error) {
    logger.api.error('Failed to run evaluation', { error });
    return NextResponse.json({ error: 'Failed to run evaluation' }, { status: 500 });
  }
}
