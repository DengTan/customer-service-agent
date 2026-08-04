import { NextResponse } from 'next/server';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { withApi } from '@/lib/api/with-api';
import { logger } from '@/lib/logger';

// GET /api/agent-assignment/agents - Get all agents status (for monitoring)
export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async () => {
    try {
      const service = new AgentAssignmentService();
      const result = await service.getAllAgentsStatus();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = (error as { code?: string }).code;
      logger.agent.error('GET agents failed', { error: errorMessage, code: errorCode });

      return new Response(JSON.stringify({ error: 'Failed to get agents status', details: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
