import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import { SettingsService } from '@/server/services/settings-service';
import { logger } from '@/lib/logger';
import { GET, POST } from '@/lib/api/with-api';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const offset = (page - 1) * limit;

  const [conversations, total] = await Promise.all([
    simulationRepository.list(undefined, limit, offset),
    simulationRepository.count(undefined),
  ]);
  return apiSuccess({ conversations, total, page, limit });
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async ({ request, user }) => {
  const { data: body, error: parseError } = await parseJsonBody<{
    scenario_id?: string;
    scenario_name?: string;
    bot_id?: string;
    bot_name?: string;
    title?: string;
  }>(request);
  if (parseError) return parseError;

  // user.sub is the JWT 'sub' claim (user ID)
  const userId = user?.sub;
  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const scenarioId = body?.scenario_id || 'order_inquiry';
  const scenarioName = body?.scenario_name || '订单查询';

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

  const settingsService = new SettingsService();
  const settings = await settingsService.getSettingsMap();
  const welcomeMessage = settings.welcome_message;
  if (welcomeMessage && welcomeMessage.trim()) {
    await simulationRepository.createMessage({
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      conversation_id: simulation.id,
      role: 'assistant',
      content: welcomeMessage.trim(),
      confidence: 1.0,
    });
  }

  return apiSuccess({ conversation: simulation }, HttpStatus.CREATED);
}, );

export { POSTHandler as POST };
