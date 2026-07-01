import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * GET /api/llm-providers/[id]
 * Get a single LLM provider
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireRole(request, ['admin', 'agent', 'observer']);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id } = await params;
    const provider = await service.getProvider(id);
    
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ provider });
  } catch (error) {
    logger.error('Failed to get LLM provider', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get provider' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/llm-providers/[id]
 * Update an LLM provider
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireRole(request, ['admin']);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id } = await params;
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '请求体格式无效' },
        { status: 400 }
      );
    }

    const provider = await service.updateProvider(id, {
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

    return NextResponse.json({ provider });
  } catch (error) {
    logger.error('Failed to update LLM provider', { error });
    const status = 
      error instanceof Error && error.message.includes('not found') ? 404 :
      error instanceof Error && error.message.includes('already exists') ? 409 :
      error instanceof Error && error.message.includes('Cannot') ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update provider' },
      { status }
    );
  }
}

/**
 * DELETE /api/llm-providers/[id]
 * Delete an LLM provider
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireRole(request, ['admin']);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id } = await params;
    await service.deleteProvider(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete LLM provider', { error });
    const status = 
      error instanceof Error && error.message.includes('not found') ? 404 :
      error instanceof Error && error.message.includes('Cannot delete') ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete provider' },
      { status }
    );
  }
}
