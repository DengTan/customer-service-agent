import { NextRequest } from 'next/server';
import { z } from 'zod';
import { BotConfigService } from '@/server/services/bot-config-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess, requirePermission, getAuthenticatedUserId } from '@/lib/api-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const service = new BotConfigService();
const supabase = getSupabaseClient();

async function getActorFromRequest(request: NextRequest) {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return undefined;
  // Resolve user name for denormalised display in audit log
  const { data: user } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
  return { id: userId, name: user?.name ?? null };
}

const UuidSchema = z.string().uuid({ message: '必须是合法 UUID' });

const CollaborationConfigSchema = z
  .object({
    auto_delegate_intents: z.array(z.string().max(100)).max(20).optional(),
    allow_collaborate_with: z.array(z.string().max(100)).max(10).optional(),
  })
  .strict();

const CreateBotBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  system_prompt: z.string().min(1).max(16000),
  tools: z.array(z.string().max(50)).max(20).optional(),
  knowledge_ids: z.array(UuidSchema).max(20).optional(),
  skill_group_id: UuidSchema.nullish(),
  is_default: z.boolean().optional(),
  parent_bot_id: UuidSchema.nullish(),
  delegation_prompt: z.string().max(2000).nullish(),
  collaboration_config: CollaborationConfigSchema.nullish(),
  is_sub_agent: z.boolean().optional(),
  platform_connection_id: UuidSchema.nullish(),
});

const UpdateBotBodySchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  system_prompt: z.string().min(1).max(16000).optional(),
  tools: z.array(z.string().max(50)).max(20).optional(),
  knowledge_ids: z.array(UuidSchema).max(20).optional(),
  skill_group_id: UuidSchema.nullish(),
  is_default: z.boolean().optional(),
  parent_bot_id: UuidSchema.nullish(),
  delegation_prompt: z.string().max(2000).nullish(),
  collaboration_config: CollaborationConfigSchema.nullish(),
  is_sub_agent: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  platform_connection_id: UuidSchema.nullish(),
});

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

  const parsed = CreateBotBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const actor = await getActorFromRequest(request);
  const result = await service.createBot(parsed.data, actor);
  return apiSuccess(result, HttpStatus.CREATED);
});

// PUT /api/bot-configs - Update a bot config (or sub-agent)
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'bots', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = UpdateBotBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const actor = await getActorFromRequest(request);
  const { id, ...rest } = parsed.data;
  const result = await service.updateBot({ id, ...rest }, actor);
  return apiSuccess(result);
});

// DELETE /api/bot-configs?id=xxx[&force=true] - Delete a bot config
// Optional `force=true` bypasses the reference guard.
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'bots', 'delete');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const confirm = searchParams.get('confirm') === 'true';

  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '缺少Bot ID 或格式不合法', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  // When caller has not confirmed, return reference counts so the UI can prompt
  if (!confirm) {
    const guard = await service.getDeleteGuard(parsed.data);
    if (guard.hasReferences) {
      return apiError('Bot 仍被引用，请先清理或确认强制删除', {
        status: 409,
        code: 'HAS_REFERENCES',
        meta: { guard },
      });
    }
  }

  const actor = await getActorFromRequest(request);
  await service.deleteBot(parsed.data, { force: confirm, actor });
  return apiSuccess({ success: true });
});
