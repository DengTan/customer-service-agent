import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * POST /api/llm-providers/[id]/set-default
 * Set provider as default
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

    const { id } = await params;
    const provider = await service.setDefaultProvider(id);

    return NextResponse.json({ provider });
  } catch (error) {
    logger.error('Failed to set default LLM provider', { error });
    const status = 
      error instanceof Error && error.message.includes('not found') ? 404 :
      error instanceof Error && error.message.includes('Cannot set') ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set default provider' },
      { status }
    );
  }
}
