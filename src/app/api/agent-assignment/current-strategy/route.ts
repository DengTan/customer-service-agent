/**
 * Agent Assignment Current Strategy API
 */
import { AgentAssignmentRepository } from '@/server/repositories/agent-assignment-repository';
import { withApi } from '@/lib/api/with-api';
import { logger } from '@/lib/logger';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    try {
      const repo = new AgentAssignmentRepository();
      const config = await repo.getActiveConfig();

      if (!config) {
        return new Response(JSON.stringify({ strategy: 'round_robin' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ strategy: config.strategy }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('[GET /current-strategy] Error', { error });
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    logger.api.debug('[PUT /current-strategy] Called');
    try {
      const body = await request.json();
      const { strategy } = body;

      logger.api.debug('[PUT /current-strategy] Strategy', { strategy });

      if (!strategy) {
        return new Response(JSON.stringify({ error: 'Missing strategy' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const repo = new AgentAssignmentRepository();
      const config = await repo.getActiveConfig();
      logger.api.debug('[PUT /current-strategy] Current config', { config });

      if (config) {
        logger.api.debug('[PUT /current-strategy] Updating config', { configId: config.id });
        await repo.updateConfig({ id: config.id, strategy });
      } else {
        logger.api.debug('[PUT /current-strategy] Creating new config');
        await repo.createConfig({ strategy, name: '默认分配策略', is_enabled: true });
      }

      return new Response(JSON.stringify({ success: true, strategy }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('[PUT /current-strategy] Error', { error });
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
