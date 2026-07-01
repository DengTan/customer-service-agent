import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * POST /api/llm-providers/[id]/models
 * Create a new model for a provider
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireRole(request, ['admin']);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id: providerId } = await params;
    const body = await request.json();

    const model = await service.createModel(providerId, {
      model_id: body.model_id,
      display_name: body.display_name,
      description: body.description,
      type: body.type,
      max_tokens: body.max_tokens,
      supports_vision: body.supports_vision,
      supports_streaming: body.supports_streaming,
      supports_function_calling: body.supports_function_calling,
      default_temperature: body.default_temperature,
      default_max_tokens: body.default_max_tokens,
      use_case: body.use_case,
      cost_per_1k_input: body.cost_per_1k_input,
      cost_per_1k_output: body.cost_per_1k_output,
      is_enabled: body.is_enabled,
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    logger.error('Failed to create LLM model', { error });
    const status = 
      error instanceof Error && error.message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create model' },
      { status }
    );
  }
}
