import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple, getAuthenticatedUserId, apiError, extractUserRole } from '@/lib/api-utils';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import { logger } from '@/lib/logger';

// UUID format validation regex - accept any valid UUID format (8-4-4-4-12 hex)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// GET /api/simulations - List simulation conversations for current user
// Admin can see all, others see only their own
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const offset = (page - 1) * limit;

  // Admin sees all conversations, others see only their own
  // Unauthenticated users see nothing
  const filterUserId = role === 'admin' ? undefined : (userId ?? undefined);

  const [conversations, total] = await Promise.all([
    simulationRepository.list(filterUserId, limit, offset),
    simulationRepository.count(filterUserId),
  ]);
  return apiSuccess({ conversations, total, page, limit });
});

// POST /api/simulations - Create a new simulation conversation
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    scenario_id?: string;
    scenario_name?: string;
    bot_id?: string;
    bot_name?: string;
    title?: string;
  }>(request);
  if (parseError) return parseError;

  const scenarioId = body?.scenario_id || 'order_inquiry';
  const scenarioName = body?.scenario_name || '订单查询';

  // P3: Validate bot_id format if provided
  let botId = body?.bot_id || null;
  let botName = body?.bot_name || null;
  if (botId && !isValidUUID(botId)) {
    logger.warn('[Simulation] Invalid bot_id format, ignoring', { botId });
    botId = null;
    botName = null;
  }

  const title = body?.title || `${botName || scenarioName} - ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

  const simulation = await simulationRepository.create({
    id: `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    title,
    scenario_id: scenarioId,
    scenario_name: scenarioName,
    bot_id: botId,
    bot_name: botName,
    created_by: userId,
  });

  return apiSuccess({ conversation: simulation }, HttpStatus.CREATED);
});
