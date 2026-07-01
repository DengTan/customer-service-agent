import { NextRequest } from 'next/server';
import { BotConfigService } from '@/server/services/bot-config-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess, requirePermission } from '@/lib/api-utils';

const service = new BotConfigService();

// GET /api/bot-configs - List all bot configs
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'bots', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const includeSubAgents = searchParams.get('include_sub_agents') !== 'false';
  const result = await service.listBots(includeSubAgents);
  return apiSuccess(result);
});

// POST /api/bot-configs - Create a new bot config (or sub-agent)
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'bots', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await service.createBot({
    name: body?.name as string,
    description: body?.description as string | undefined,
    system_prompt: body?.system_prompt as string,
    tools: body?.tools as unknown[] | undefined,
    knowledge_ids: body?.knowledge_ids as string[] | undefined,
    skill_group_id: body?.skill_group_id as string | null | undefined,
    is_default: body?.is_default as boolean | undefined,
    parent_bot_id: body?.parent_bot_id as string | null | undefined,
    delegation_prompt: body?.delegation_prompt as string | null | undefined,
    collaboration_config: body?.collaboration_config as Record<string, unknown> | null | undefined,
    is_sub_agent: body?.is_sub_agent as boolean | undefined,
    platform_connection_id: body?.platform_connection_id as string | null | undefined,
  });

  return apiSuccess(result);
});

// PUT /api/bot-configs - Update a bot config (or sub-agent)
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'bots', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await service.updateBot({
    id: body?.id as string,
    name: body?.name as string | undefined,
    description: body?.description as string | undefined,
    system_prompt: body?.system_prompt as string | undefined,
    tools: body?.tools as unknown[] | undefined,
    knowledge_ids: body?.knowledge_ids as string[] | undefined,
    skill_group_id: body?.skill_group_id as string | null | undefined,
    is_default: body?.is_default as boolean | undefined,
    parent_bot_id: body?.parent_bot_id as string | null | undefined,
    delegation_prompt: body?.delegation_prompt as string | null | undefined,
    collaboration_config: body?.collaboration_config as Record<string, unknown> | null | undefined,
    is_sub_agent: body?.is_sub_agent as boolean | undefined,
    status: body?.status as string | undefined,
    platform_connection_id: body?.platform_connection_id as string | null | undefined,
  });

  return apiSuccess(result);
});

// DELETE /api/bot-configs?id=xxx - Delete a bot config
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'bots', 'delete');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少Bot ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  await service.deleteBot(id);
  return apiSuccess({ success: true });
});
