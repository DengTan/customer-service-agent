/**
 * Agent Assignment Config API
 */
import { withApi } from '@/lib/api/with-api';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: 'Missing config id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = await request.json();
      const service = new AgentAssignmentService();
      const config = await service.updateConfig({
        id,
        strategy: body.strategy,
        name: body.name,
        is_enabled: body.is_enabled,
        condition_config: body.condition_config,
      });

      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('PUT config failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to update config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: 'Missing config id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const service = new AgentAssignmentService();
      await service.deleteConfig(id);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('DELETE config failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to delete config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
