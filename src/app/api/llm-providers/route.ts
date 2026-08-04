import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { getLogger } from '@/lib/logger';
import { GET, POST } from '@/lib/api/with-api';
import { HttpStatus } from '@/lib/api-utils';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'read' },
  },
  async ({ request }) => {
  try {
    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get('enabled') === 'true';
    const providerId = searchParams.get('provider_id');

    if (providerId) {
      const models = await service.listProviderModels(providerId);
      return NextResponse.json({ models });
    }

    const providers = enabledOnly
      ? await service.listEnabledProviders()
      : await service.listProviders();

    return NextResponse.json({
      providers,
    });
  } catch (error) {
    logger.error('Failed to list LLM providers', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list providers' },
      { status: 500 }
    );
  }
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'write' },
  },
  async ({ request }) => {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '请求体格式无效' },
        { status: 400 }
      );
    }

    const provider = await service.createProvider({
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

    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    logger.error('Failed to create LLM provider', { error });
    const status = error instanceof Error && error.message.includes('already exists') ? 409 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create provider' },
      { status }
    );
  }
}, );

export { POSTHandler as POST };
