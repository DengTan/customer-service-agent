/**
 * LLM Provider Models API
 */
import { withApi } from '@/lib/api/with-api';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request, params }) => {
    const { id } = params as { id: string };
    try {
      const body = await request.json();

      const model = await service.updateModel(id, {
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
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to update LLM model', { error });
      const status =
        error instanceof Error && error.message.includes('not found') ? 404 : 500;
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to update model' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ params }) => {
    const { id } = params as { id: string };
    try {
      await service.deleteModel(id);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to delete LLM model', { error });
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to delete model' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
