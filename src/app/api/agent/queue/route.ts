import { NextRequest } from 'next/server';
import { AgentService } from '@/server/services/agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess, getAuthenticatedUserId } from '@/lib/api-utils';

const service = new AgentService();

// GET /api/agent/queue - 获取排队与服务中列表
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // Verify authentication
  const currentUserId = getAuthenticatedUserId(request);
  if (!currentUserId) {
    return apiError('未登录或登录已过期', { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const agent_id = searchParams.get('agent_id') ?? undefined;
  const limit = parseInt(searchParams.get('limit') || '0', 10) || undefined;
  const offset = parseInt(searchParams.get('offset') || '0', 10) || undefined;

  const result = await service.listQueue({
    status: status ?? null,
    agent_id: agent_id ?? null,
    limit: limit ?? undefined,
    offset: offset ?? undefined,
  });
  return apiSuccess({ items: result.items, total: result.total });
});

// POST /api/agent/queue - 坐席接单
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // Verify authentication
  const currentUserId = getAuthenticatedUserId(request);
  if (!currentUserId) {
    return apiError('未登录或登录已过期', { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED' });
  }

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const queue_id = (body?.queue_id as string) || '';
  const agent_id = (body?.agent_id as string) || '';

  if (!queue_id || !agent_id) {
    return apiError('缺少必要参数', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  // Only allow agents to accept orders for themselves
  if (agent_id !== currentUserId) {
    return apiError('无权代其他坐席接单', { status: HttpStatus.FORBIDDEN, code: 'FORBIDDEN' });
  }

  const result = await service.acceptQueueItem(queue_id, agent_id);
  return apiSuccess(result);
});

// PATCH /api/agent/queue - 更新排队项状态 (resolve/transfer)
export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  // Verify authentication
  const currentUserId = getAuthenticatedUserId(request);
  if (!currentUserId) {
    return apiError('未登录或登录已过期', { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED' });
  }

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const queue_id = (body?.queue_id as string) || '';
  const action = (body?.action as string) || '';
  const target_agent_id = body?.target_agent_id as string | undefined;

  if (!queue_id || !action) {
    return apiError('缺少必要参数', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  let result;
  if (action === 'resolve') {
    result = await service.resolveQueueItem(queue_id);
  } else if (action === 'transfer') {
    if (!target_agent_id) {
      return apiError('转接需要指定目标坐席', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }
    result = await service.transferQueueItem(queue_id, target_agent_id);
  } else {
    return apiError('无效的操作', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  return apiSuccess(result);
});
