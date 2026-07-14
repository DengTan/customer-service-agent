import { NextRequest } from 'next/server';
import { z } from 'zod';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess, requirePermission } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('SubAgents');

const service = new SubAgentService();

// Matches any 8-4-4-4-12 hex format (including all-zero UUIDs)
const UuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { message: '必须是合法 UUID' });

const CollaborationConfigSchema = z
  .object({
    auto_delegate_intents: z.array(z.string().max(100)).max(20).optional(),
    allow_collaborate_with: z.array(z.string().max(100)).max(10).optional(),
  })
  .strict();

const CreateSubAgentSchema = z.object({
  parent_bot_id: UuidSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  system_prompt: z.string().min(1).max(16000),
  tools: z.array(z.string().max(50)).max(20).optional(),
  knowledge_ids: z.array(UuidSchema).max(20).optional(),
  delegation_prompt: z.string().max(2000).optional(),
  collaboration_config: CollaborationConfigSchema.optional(),
});

const UpdateSubAgentSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  system_prompt: z.string().min(1).max(16000).optional(),
  tools: z.array(z.string().max(50)).max(20).optional(),
  knowledge_ids: z.array(UuidSchema).max(20).optional(),
  delegation_prompt: z.string().max(2000).optional(),
  collaboration_config: CollaborationConfigSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

// GET /api/sub-agents?parent_bot_id=xxx - List sub-agents under a parent bot
// GET /api/sub-agents?bot_tree=xxx - Get bot tree (parent + sub-agents)
// GET /api/sub-agents?main_bots=true - List all main bots with sub-agent counts
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'sub_agents', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parentBotId = searchParams.get('parent_bot_id');
  const botTree = searchParams.get('bot_tree');
  const mainBots = searchParams.get('main_bots');

  if (mainBots === 'true') {
    try {
      const result = await service.listMainBotsWithSubAgents();
      return apiSuccess({ bots: result });
    } catch (err) {
      const detail = (err as Error)?.message ?? String(err);
      logger.error('[sub-agents] listMainBotsWithSubAgents failed', { detail });
      return apiError(`加载Bot列表失败: ${detail}`, {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'BOT_LIST_ERROR',
      });
    }
  }

  if (botTree) {
    const parsed = UuidSchema.safeParse(botTree);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'bot_tree 必须是合法 UUID', {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }
    const result = await service.getBotTree(parsed.data);
    return apiSuccess(result);
  }

  if (parentBotId) {
    const parsed = UuidSchema.safeParse(parentBotId);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? 'parent_bot_id 必须是合法 UUID', {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }
    try {
      const result = await service.listSubAgents(parsed.data);
      return apiSuccess(result);
    } catch (err) {
      const detail = (err as Error)?.message ?? String(err);
      logger.error('[sub-agents] listSubAgents failed', { detail, parentBotId });
      return apiError(`加载子Agent失败: ${detail}`, {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'SUB_AGENT_LIST_ERROR',
      });
    }
  }

  return apiError('请提供 parent_bot_id、bot_tree 或 main_bots 参数', {
    status: HttpStatus.BAD_REQUEST,
    code: 'VALIDATION_ERROR',
  });
});

// POST /api/sub-agents - Create a new sub-agent
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'sub_agents', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = CreateSubAgentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.createSubAgent(parsed.data);

  return apiSuccess(result, HttpStatus.CREATED);
});

// PUT /api/sub-agents - Update a sub-agent
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'sub_agents', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = UpdateSubAgentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const { id, ...rest } = parsed.data;
  const result = await service.updateSubAgent({ id, ...rest });
  return apiSuccess(result);
});

// DELETE /api/sub-agents?id=xxx - Delete a sub-agent
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'sub_agents', 'delete');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '缺少子Agent ID 或格式不合法', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.deleteSubAgent(parsed.data);
  return apiSuccess(result);
});
