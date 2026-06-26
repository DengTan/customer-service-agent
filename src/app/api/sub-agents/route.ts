import { NextRequest } from 'next/server';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess } from '@/lib/api-utils';

const service = new SubAgentService();

interface CreateSubAgentBody {
  parent_bot_id: string;
  name: string;
  description?: string;
  system_prompt: string;
  tools?: string[];
  knowledge_ids?: string[];
  delegation_prompt?: string;
  collaboration_config?: Record<string, unknown>;
}

interface UpdateSubAgentBody {
  id: string;
  name?: string;
  description?: string;
  system_prompt?: string;
  tools?: string[];
  knowledge_ids?: string[];
  delegation_prompt?: string;
  collaboration_config?: Record<string, unknown>;
  status?: string;
}

// GET /api/sub-agents?parent_bot_id=xxx - List sub-agents under a parent bot
// GET /api/sub-agents?bot_tree=xxx - Get bot tree (parent + sub-agents)
// GET /api/sub-agents?main_bots=true - List all main bots with sub-agent counts
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const parentBotId = searchParams.get('parent_bot_id');
  const botTree = searchParams.get('bot_tree');
  const mainBots = searchParams.get('main_bots');

  if (mainBots === 'true') {
    const result = await service.listMainBotsWithSubAgents();
    return apiSuccess({ bots: result });
  }

  if (botTree) {
    const result = await service.getBotTree(botTree);
    return apiSuccess(result);
  }

  if (parentBotId) {
    const result = await service.listSubAgents(parentBotId);
    return apiSuccess(result);
  }

  return apiError('请提供 parent_bot_id、bot_tree 或 main_bots 参数', {
    status: HttpStatus.BAD_REQUEST,
    code: 'VALIDATION_ERROR',
  });
});

// POST /api/sub-agents - Create a new sub-agent
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<CreateSubAgentBody>(request);
  if (parseError) return parseError;

  if (!body?.parent_bot_id || !body?.name || !body?.system_prompt) {
    return apiError('parent_bot_id、name 和 system_prompt 为必填项', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.createSubAgent({
    parent_bot_id: body.parent_bot_id,
    name: body.name,
    description: body.description,
    system_prompt: body.system_prompt,
    tools: body.tools,
    knowledge_ids: body.knowledge_ids,
    delegation_prompt: body.delegation_prompt,
    collaboration_config: body.collaboration_config,
  });

  return apiSuccess(result);
});

// PUT /api/sub-agents - Update a sub-agent
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<UpdateSubAgentBody>(request);
  if (parseError) return parseError;

  if (!body?.id) {
    return apiError('缺少子Agent ID', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.updateSubAgent({
    id: body.id,
    name: body.name,
    description: body.description,
    system_prompt: body.system_prompt,
    tools: body.tools,
    knowledge_ids: body.knowledge_ids,
    delegation_prompt: body.delegation_prompt,
    collaboration_config: body.collaboration_config,
    status: body.status,
  });

  return apiSuccess(result);
});

// DELETE /api/sub-agents?id=xxx - Delete a sub-agent
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少子Agent ID', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.deleteSubAgent(id);
  return apiSuccess(result);
});
