import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

const service = new AgentAssignmentService();

// GET /api/agent-assignment/config - List all configs
export const GET = withApi(
  { auth: 'required', perm: { resource: 'team', action: 'read' } },
  async () => {
    try {
      const configs = await service.listConfigs();
      return new Response(JSON.stringify({ configs }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('GET configs failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to get configs' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

// POST /api/agent-assignment/config - Create config
export const POST = withApi(
  { auth: 'required', perm: { resource: 'team', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const config = await service.createConfig({
        strategy: body.strategy,
        name: body.name,
        is_enabled: body.is_enabled,
        condition_config: body.condition_config,
      });

      return new Response(JSON.stringify({ config }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('POST config failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to create config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
