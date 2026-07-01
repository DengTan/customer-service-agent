import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, HttpStatus, withErrorHandler, getAuthenticatedUserId, extractUserRole } from '@/lib/api-utils';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { SimulationEvaluation, SimulationEvaluationStats } from '@/lib/types';
import { logger } from '@/lib/logger';
const evalLogger = logger.database;

// Demo mode in-memory storage
const demoEvaluations: SimulationEvaluation[] = [];

const EVAL_SELECT = 'id, simulation_id, user_id, message_id, rating, tags, comment, created_at';

/**
 * Check if user has permission to access evaluations for a simulation
 */
function canAccessSimulation(
  createdBy: string | null | undefined,
  userId: string | null,
  role: string | null,
): boolean {
  if (role === 'admin') return true;
  if (!userId) return false;
  if (createdBy === null || createdBy === undefined) return false;
  return createdBy === userId;
}

// GET /api/simulations/[id]/evaluation - List evaluations + stats
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: simulationId } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  const client = getSupabaseClient();

  if (isDemoMode()) {
    const evals = demoEvaluations.filter(e => e.simulation_id === simulationId);
    const stats = computeStats(evals);
    return apiSuccess({ evaluations: evals, stats });
  }

  // Get simulation to check ownership
  const { data: simulation, error: simError } = await client
    .from('simulation_conversations')
    .select('created_by')
    .eq('id', simulationId)
    .single();

  if (simError || !simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (!canAccessSimulation(simulation.created_by, userId, role)) {
    return apiError('无权限查看此会话的评价', { status: HttpStatus.FORBIDDEN });
  }

  // List evaluations
  const { data: evaluations, error } = await client
    .from('simulation_evaluations')
    .select(EVAL_SELECT)
    .eq('simulation_id', simulationId)
    .order('created_at', { ascending: false });

  if (error) {
    evalLogger.error('[SimulationEvaluation] Failed to list evaluations', { error });
    return apiError('获取评价列表失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  const evals = (evaluations ?? []) as SimulationEvaluation[];
  const stats = computeStats(evals);

  return apiSuccess({ evaluations: evals, stats });
});

function computeStats(evaluations: SimulationEvaluation[]): SimulationEvaluationStats {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;

  for (const e of evaluations) {
    if (e.rating >= 1 && e.rating <= 5) {
      distribution[e.rating] = (distribution[e.rating] || 0) + 1;
      sum += e.rating;
    }
  }

  return {
    total: evaluations.length,
    average: evaluations.length > 0 ? parseFloat((sum / evaluations.length).toFixed(2)) : 0,
    distribution,
  };
}

// POST /api/simulations/[id]/evaluation - Create evaluation
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: simulationId } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    message_id?: string;
    rating?: number;
    tags?: string[];
    comment?: string;
  }>(request);

  if (parseError) return parseError;

  const rating = body?.rating;
  if (!Number.isInteger(rating) || rating === undefined || rating < 1 || rating > 5) {
    return apiError('评分必须是 1-5 的整数', { status: HttpStatus.BAD_REQUEST, code: 'INVALID_RATING' });
  }

  const messageId = body?.message_id || 'overall';
  const tags = Array.isArray(body?.tags) ? body.tags : [];
  const comment = typeof body?.comment === 'string' ? body.comment : null;

  const client = getSupabaseClient();

  if (isDemoMode()) {
    const newEval: SimulationEvaluation = {
      id: `eval-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      simulation_id: simulationId,
      user_id: userId,
      message_id: messageId,
      rating: rating as number,
      tags,
      comment,
      created_at: new Date().toISOString(),
    };
    demoEvaluations.unshift(newEval);
    return apiSuccess({ evaluation: newEval }, HttpStatus.CREATED);
  }

  // Verify simulation exists and user can access
  const { data: simulation, error: simError } = await client
    .from('simulation_conversations')
    .select('created_by')
    .eq('id', simulationId)
    .single();

  if (simError || !simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (!canAccessSimulation(simulation.created_by, userId, role)) {
    return apiError('无权限对此会话进行评价', { status: HttpStatus.FORBIDDEN });
  }

  // Create evaluation
  const { data: newEval, error: insertError } = await client
    .from('simulation_evaluations')
    .insert({
      id: `eval-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      simulation_id: simulationId,
      user_id: userId,
      message_id: messageId,
      rating,
      tags,
      comment,
    })
    .select(EVAL_SELECT)
    .single();

  if (insertError) {
    evalLogger.error('[SimulationEvaluation] Failed to create evaluation', { error: insertError });
    return apiError('创建评价失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  // Update aggregated rating on simulation_conversations (fire-and-forget with error handling)
  const evals = (await client
    .from('simulation_evaluations')
    .select('rating')
    .eq('simulation_id', simulationId)) as { data: { rating: number }[] | null; error: unknown };

  if (!evals.error && evals.data && evals.data.length > 0) {
    const avg = evals.data.reduce((s, e) => s + e.rating, 0) / evals.data.length;
    const { error: updateError } = await client
      .from('simulation_conversations')
      .update({
        evaluation_rating: Math.round(avg),
        evaluation_count: evals.data.length,
      })
      .eq('id', simulationId);

    if (updateError) {
      evalLogger.error('[SimulationEvaluation] Failed to update aggregated rating', { error: updateError, simulationId });
    }
  }

  return apiSuccess({ evaluation: newEval as SimulationEvaluation }, HttpStatus.CREATED);
});

// PATCH /api/simulations/[id]/evaluation - Update evaluation
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: simulationId } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { searchParams } = new URL(request.url);
  const evalId = searchParams.get('evaluation_id');
  if (!evalId) {
    return apiError('缺少评价ID', { status: HttpStatus.BAD_REQUEST, code: 'MISSING_EVAL_ID' });
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    rating?: number;
    tags?: string[];
    comment?: string;
  }>(request);

  if (parseError) return parseError;

  if (!body) {
    return apiError('请求体无效', { status: HttpStatus.BAD_REQUEST });
  }

  if (body.rating !== undefined && (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) {
    return apiError('评分必须是 1-5 的整数', { status: HttpStatus.BAD_REQUEST, code: 'INVALID_RATING' });
  }

  const client = getSupabaseClient();

  if (isDemoMode()) {
    const idx = demoEvaluations.findIndex(e => e.id === evalId);
    if (idx === -1) {
      return apiError('评价不存在', { status: HttpStatus.NOT_FOUND });
    }
    if (demoEvaluations[idx].user_id !== userId && role !== 'admin') {
      return apiError('无权限修改此评价', { status: HttpStatus.FORBIDDEN });
    }
    if (body.rating !== undefined) demoEvaluations[idx].rating = body.rating;
    if (body.tags !== undefined) demoEvaluations[idx].tags = body.tags;
    if (body.comment !== undefined) demoEvaluations[idx].comment = body.comment;
    return apiSuccess({ evaluation: demoEvaluations[idx] });
  }

  // Verify ownership
  const { data: existing } = await client
    .from('simulation_evaluations')
    .select('user_id')
    .eq('id', evalId)
    .single();

  if (!existing) {
    return apiError('评价不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (existing.user_id !== userId && role !== 'admin') {
    return apiError('无权限修改此评价', { status: HttpStatus.FORBIDDEN });
  }

  const updates: Record<string, unknown> = {};
  if (body.rating !== undefined) updates.rating = body.rating;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.comment !== undefined) updates.comment = body.comment;

  const { data: updated, error } = await client
    .from('simulation_evaluations')
    .update(updates)
    .eq('id', evalId)
    .select(EVAL_SELECT)
    .single();

  if (error) {
    evalLogger.error('[SimulationEvaluation] Failed to update evaluation', { error });
    return apiError('更新评价失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  return apiSuccess({ evaluation: updated as SimulationEvaluation });
});

// DELETE /api/simulations/[id]/evaluation - Delete evaluation
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: simulationId } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { searchParams } = new URL(request.url);
  const evalId = searchParams.get('evaluation_id');
  if (!evalId) {
    return apiError('缺少评价ID', { status: HttpStatus.BAD_REQUEST, code: 'MISSING_EVAL_ID' });
  }

  const client = getSupabaseClient();

  if (isDemoMode()) {
    const idx = demoEvaluations.findIndex(e => e.id === evalId);
    if (idx === -1) {
      return apiError('评价不存在', { status: HttpStatus.NOT_FOUND });
    }
    if (demoEvaluations[idx].user_id !== userId && role !== 'admin') {
      return apiError('无权限删除此评价', { status: HttpStatus.FORBIDDEN });
    }
    demoEvaluations.splice(idx, 1);
    return apiSuccess({ success: true });
  }

  // Verify ownership
  const { data: existing } = await client
    .from('simulation_evaluations')
    .select('user_id')
    .eq('id', evalId)
    .single();

  if (!existing) {
    return apiError('评价不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (existing.user_id !== userId && role !== 'admin') {
    return apiError('无权限删除此评价', { status: HttpStatus.FORBIDDEN });
  }

  const { error } = await client
    .from('simulation_evaluations')
    .delete()
    .eq('id', evalId);

  if (error) {
    evalLogger.error('[SimulationEvaluation] Failed to delete evaluation', { error });
    return apiError('删除评价失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  // Recompute aggregated rating
  const evals = (await client
    .from('simulation_evaluations')
    .select('rating')
    .eq('simulation_id', simulationId)) as { data: { rating: number }[] | null; error: unknown };

  if (!evals.error && evals.data && evals.data.length > 0) {
    const avg = evals.data.reduce((s, e) => s + e.rating, 0) / evals.data.length;
    const { error: updateError } = await client
      .from('simulation_conversations')
      .update({
        evaluation_rating: Math.round(avg),
        evaluation_count: evals.data.length,
      })
      .eq('id', simulationId);

    if (updateError) {
      evalLogger.error('[SimulationEvaluation] Failed to update aggregated rating after delete', { error: updateError, simulationId });
    }
  } else if (!evals.error) {
    const { error: clearError } = await client
      .from('simulation_conversations')
      .update({ evaluation_rating: null, evaluation_count: 0 })
      .eq('id', simulationId);

    if (clearError) {
      evalLogger.error('[SimulationEvaluation] Failed to clear aggregated rating after delete', { error: clearError, simulationId });
    }
  }

  return apiSuccess({ success: true });
});
