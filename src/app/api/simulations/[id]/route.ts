import { NextRequest } from 'next/server';
import { apiSuccess, apiError, HttpStatus, withErrorHandler, getAuthenticatedUserId, extractUserRole } from '@/lib/api-utils';
import { simulationRepository } from '@/server/repositories/simulation-repository';

/**
 * Check if user has permission to access a simulation conversation
 * - Admin can access all
 * - Creator (created_by) can access their own
 * - null created_by (legacy) only accessible by admin
 */
function canAccessConversation(
  simulation: { created_by?: string | null },
  userId: string | null,
  role: string | null
): boolean {
  // Admin can access all
  if (role === 'admin') return true;

  // Must be logged in to access
  if (!userId) return false;

  // If created_by is null (legacy data), only admin can access
  if (simulation.created_by === null || simulation.created_by === undefined) {
    return false;
  }

  // Creator can access their own
  return simulation.created_by === userId;
}

// GET /api/simulations/[id] - Get simulation details and messages
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  const simulation = await simulationRepository.getById(id);

  if (!simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (!canAccessConversation(simulation, userId, role)) {
    return apiError('无权限查看此会话', { status: HttpStatus.FORBIDDEN });
  }

  const messages = await simulationRepository.listMessages(id);

  return apiSuccess({
    conversation: simulation,
    messages,
  });
});

// DELETE /api/simulations/[id] - Delete a simulation (only creator or admin can delete)
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const simulation = await simulationRepository.getById(id);
  if (!simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  // Check permission: only creator or admin can delete
  const isCreator = simulation.created_by !== null &&
                    simulation.created_by !== undefined &&
                    simulation.created_by === userId;
  const isAdmin = role === 'admin';

  if (!isCreator && !isAdmin) {
    return apiError('无权限删除此会话', { status: HttpStatus.FORBIDDEN });
  }

  const deleted = await simulationRepository.delete(id);

  if (!deleted) {
    return apiError('删除失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  return apiSuccess({ success: true });
});
