import { NextRequest, NextResponse } from 'next/server';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const service = new LlmProviderService();
const logger = getLogger('LLMProviders');

/**
 * POST /api/llm-providers/[id]/test
 * Test provider connection
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
    const result = await service.testConnection(id);

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Failed to test LLM provider connection', { error });
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Connection test failed' },
      { status: 500 }
    );
  }
}
