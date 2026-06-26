import { NextRequest } from 'next/server';
import { AgentService } from '@/server/services/agent-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess } from '@/lib/api-utils';

const service = new AgentService();

// PATCH /api/agent/status - 更新坐席状态
export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const user_id = (body?.user_id as string) || '';
  const status = (body?.status as string) || '';

  if (!user_id || !status) {
    return apiError('缺少必要参数', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await service.updateStatus(user_id, status);
  return apiSuccess(result);
});
