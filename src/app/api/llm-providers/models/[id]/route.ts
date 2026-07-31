import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * PUT /api/llm-providers/models/[id]
 * Update a model
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

    return NextResponse.json({ model });
  } catch (error) {
    logger.error('Failed to update LLM model', { error });
    const status = 
      error instanceof Error && error.message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update model' },
      { status }
    );
  }
}

/**
 * DELETE /api/llm-providers/models/[id]
 * Delete a model
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
    await service.deleteModel(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete LLM model', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete model' },
      { status: 500 }
    );
  }
}
