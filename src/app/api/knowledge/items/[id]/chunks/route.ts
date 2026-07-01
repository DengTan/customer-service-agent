import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, requirePermission } from '@/lib/api-utils';
import { knowledgeChunkRepository } from '@/server/repositories/knowledge-chunk-repository';
import { logger } from '@/lib/logger';

/**
 * GET /api/knowledge/items/[id]/chunks
 * 获取指定知识条目的分块内容
 *
 * Query params:
 * - version?: number - 可选，查看历史版本的分块
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const denied = await requirePermission(request, 'knowledge', 'read');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const versionParam = searchParams.get('version');

    let chunks;
    if (versionParam) {
      const version = parseInt(versionParam, 10);
      if (isNaN(version) || version < 1) {
        return apiSuccess({ error: '无效的版本号' }, 400);
      }
      chunks = await knowledgeChunkRepository.getChunksAtVersion(id, version);
    } else {
      chunks = await knowledgeChunkRepository.getActiveChunks(id);
    }

    return apiSuccess({ chunks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.api.error('[GET /api/knowledge/items/[id]/chunks] Failed to get chunks', { error: message, itemId: id });
    return NextResponse.json(
      { success: false, error: '服务器内部错误，请稍后重试' },
      { status: 500 }
    );
  }
}
