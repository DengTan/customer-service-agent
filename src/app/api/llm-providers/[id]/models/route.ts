import { NextRequest } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * POST /api/llm-providers/[id]/models
 * Create a new model for a provider
 */
export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request, params }) => {
    try {
      const { id: providerId } = params as { id: string };
      const body = await request.json();

      const model = await service.createModel(providerId, {
        model_id: body.model_id,
        display_name: body.display_name,
        description: body.description,
        max_tokens: body.max_tokens,
        supports_vision: body.supports_vision,
        supports_streaming: body.supports_streaming,
        supports_function_calling: body.supports_function_calling,
        default_max_tokens: body.default_max_tokens,
        cost_per_1k_input: body.cost_per_1k_input,
        cost_per_1k_output: body.cost_per_1k_output,
        is_enabled: body.is_enabled,
      });

      return new Response(JSON.stringify({ model }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to create LLM model', { error });
      const status =
        error instanceof Error && error.message.includes('not found') ? 404 : 500;
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to create model' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
