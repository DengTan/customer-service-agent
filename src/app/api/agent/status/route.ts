import { NextRequest } from 'next/server';
import { AgentService } from '@/server/services/agent-service';
import { parseJsonBody, HttpStatus, apiError, apiSuccess } from '@/lib/api-utils';
import { GET, PATCH } from '@/lib/api/with-api';

const service = new AgentService();

// GET /api/agent/status - 获取当前坐席状态
export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async ({ user }) => {
  const currentUserId = user?.sub;
  if (!currentUserId) {
    return apiError('未登录或登录已过期', { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED' });
  }

  const result = await service.getStatus(currentUserId);
  return apiSuccess(result);
},
);

export { GETHandler as GET };

// PATCH /api/agent/status - 更新坐席状态
export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async ({ request, user }) => {
  const currentUserId = user?.sub;
  if (!currentUserId) {
    return apiError('未登录或登录已过期', { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED' });
  }

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const user_id = (body?.user_id as string) || '';
  const status = (body?.status as string) || '';

  if (!user_id || !status) {
    return apiError('缺少必要参数', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  // Only allow agents to modify their own status
  if (user_id !== currentUserId) {
    return apiError('无权修改其他坐席的状态', { status: HttpStatus.FORBIDDEN, code: 'FORBIDDEN' });
  }

  const result = await service.updateStatus(user_id, status);
  return apiSuccess(result);
},
);

export { PATCHHandler as PATCH };
