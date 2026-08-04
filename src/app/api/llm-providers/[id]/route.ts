import { GET as defineGet, PUT as definePut, DELETE as defineDelete } from '@/lib/api/with-api';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { logger } from '@/lib/logger';

const service = new LlmProviderService();

/**
 * GET /api/llm-providers/[id]
 * Get a single LLM provider
 */
export const GET = defineGet(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ params }) => {
    try {
      const { id } = params as { id: string };
      const provider = await service.getProvider(id);

      if (!provider) {
        return new Response(JSON.stringify({ error: 'Provider not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ provider }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to get LLM provider', { error });
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to get provider' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

/**
 * PUT /api/llm-providers/[id]
 * Update an LLM provider
 */
export const PUT = definePut(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request, params }) => {
    try {
      const { id } = params as { id: string };
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: '请求体格式无效' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const provider = await service.updateProvider(id, {
        name: body.name,
        display_name: body.display_name,
        description: body.description,
        base_url: body.base_url,
        api_key: body.api_key,
        models: body.models,
        supports_vision: body.supports_vision,
        supports_streaming: body.supports_streaming,
        max_context_tokens: body.max_context_tokens,
        auth_config: body.auth_config,
        request_config: body.request_config,
        is_enabled: body.is_enabled,
      });

      return new Response(JSON.stringify({ provider }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to update LLM provider', { error });
      const status =
        error instanceof Error && error.message.includes('not found') ? 404 :
        error instanceof Error && error.message.includes('already exists') ? 409 :
        error instanceof Error && error.message.includes('Cannot') ? 400 : 500;
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to update provider' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

/**
 * DELETE /api/llm-providers/[id]
 * Delete an LLM provider
 */
export const DELETE = defineDelete(
  { auth: 'required', perm: { resource: 'settings', action: 'delete' } },
  async ({ params }) => {
    try {
      const { id } = params as { id: string };
      await service.deleteProvider(id);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('Failed to delete LLM provider', { error });
      const status =
        error instanceof Error && error.message.includes('not found') ? 404 :
        error instanceof Error && error.message.includes('Cannot delete') ? 400 : 500;
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to delete provider' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
