import { AgentService } from '@/server/services/agent-service';
import { apiSuccess } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';

const service = new AgentService();

// GET /api/agent/performance - 获取坐席绩效统计
export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const agent_id = searchParams.get('agent_id') ?? undefined;

    const result = await service.getPerformance(agent_id);
    return apiSuccess(result);
  },
);

export { GETHandler as GET };