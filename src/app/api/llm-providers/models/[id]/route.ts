import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

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
