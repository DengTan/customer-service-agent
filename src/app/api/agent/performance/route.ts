import { NextRequest } from 'next/server';
import { AgentService } from '@/server/services/agent-service';
import { withErrorHandlerSimple, apiSuccess, getAuthenticatedUserId, HttpStatus, apiError } from '@/lib/api-utils';

const service = new AgentService();

// GET /api/agent/performance - 获取坐席绩效统计
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // Verify authentication
  const currentUserId = getAuthenticatedUserId(request);
  if (!currentUserId) {
    return apiError('未登录或登录已过期', { status: HttpStatus.UNAUTHORIZED, code: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(request.url);
  const agent_id = searchParams.get('agent_id') ?? undefined;

  const result = await service.getPerformance(agent_id);
  return apiSuccess(result);
});
