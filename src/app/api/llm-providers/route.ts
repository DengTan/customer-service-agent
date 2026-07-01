import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * GET /api/llm-providers
 * List all LLM providers
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const userId = await requireRole(request, ['admin', 'agent', 'observer']);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get('enabled') === 'true';
    const providerId = searchParams.get('provider_id');

    // Get models for a specific provider
    if (providerId) {
      const models = await service.listProviderModels(providerId);
      return NextResponse.json({ models });
    }

    // List providers
    const providers = enabledOnly 
      ? await service.listEnabledProviders()
      : await service.listProviders();

    // Get default provider
    const defaultProvider = await service.getDefaultProvider();

    return NextResponse.json({ 
      providers,
      default_provider: defaultProvider,
    });
  } catch (error) {
    logger.error('Failed to list LLM providers', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list providers' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/llm-providers
 * Create a new LLM provider
 */
export async function POST(request: NextRequest) {
  try {
    // Only admin can create providers
    const userId = await requireRole(request, ['admin']);
    if (userId instanceof NextResponse) {
      return userId;
    }

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
      api_type: body.api_type,
      base_url: body.base_url,
      api_key: body.api_key,
      models: body.models,
      default_model: body.default_model,
      supports_vision: body.supports_vision,
      supports_streaming: body.supports_streaming,
      max_context_tokens: body.max_context_tokens,
      auth_config: body.auth_config,
      request_config: body.request_config,
      is_enabled: body.is_enabled,
      is_default: body.is_default,
      priority: body.priority,
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
}
