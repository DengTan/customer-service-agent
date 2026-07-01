import { NextRequest } from 'next/server';
import { apiSuccess, apiError, HttpStatus, withErrorHandler, getAuthenticatedUserId, extractUserRole } from '@/lib/api-utils';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import { logger } from '@/lib/logger';

const simLogger = logger.api;

/**
 * Check if user has permission to access a simulation conversation
 */
function canAccessConversation(
  simulation: { created_by?: string | null },
  userId: string | null,
  role: string | null
): boolean {
  if (role === 'admin') return true;
  if (!userId) return false;
  if (simulation.created_by === null || simulation.created_by === undefined) {
    return false;
  }
  return simulation.created_by === userId;
}

// POST /api/simulations/[id]/duplicate - Duplicate a simulation conversation
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  // Get original conversation
  const original = await simulationRepository.getById(id);
  if (!original) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (!canAccessConversation(original, userId, role)) {
    return apiError('无权限复制此会话', { status: HttpStatus.FORBIDDEN });
  }

  // Get original messages
  const originalMessages = await simulationRepository.listMessages(id);

  // Create new conversation with "(副本)" suffix
  const newId = `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const newConversation = await simulationRepository.create({
    id: newId,
    title: `${original.title}（副本）`,
    scenario_id: original.scenario_id,
    scenario_name: original.scenario_name || '自定义',
    created_by: userId,
  });

  // Copy all messages to new conversation
  for (const msg of originalMessages) {
    await simulationRepository.createMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      conversation_id: newId,
      role: msg.role,
      content: msg.content,
      sources: msg.sources ?? undefined,
      confidence: msg.confidence ?? undefined,
      confidence_breakdown: msg.confidence_breakdown ?? undefined,
      tool_calls: msg.tool_calls ?? undefined,
      tool_results: msg.tool_results ?? undefined,
      image_url: msg.image_url ?? undefined,
      message_type: msg.message_type ?? undefined,
      rich_content: msg.rich_content ?? undefined,
    });
  }

  simLogger.info('[Simulation Duplicate] Conversation duplicated', {
    originalId: id,
    newId,
    userId,
    messageCount: originalMessages.length,
  });

  return apiSuccess({
    conversation: newConversation,
    messageCount: originalMessages.length,
  }, HttpStatus.CREATED);
});
