import { NextRequest } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * POST /api/llm-providers/[id]/test
 * Test provider connection
 */
export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request, params }) => {
    try {
      const { id } = params as { id: string };
      const result = await service.testConnection(id);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to test LLM provider connection', { error });
      return new Response(JSON.stringify({ success: false, message: error instanceof Error ? error.message : 'Connection test failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
