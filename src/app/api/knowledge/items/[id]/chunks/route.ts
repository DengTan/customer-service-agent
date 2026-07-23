import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, requirePermission } from '@/lib/api-utils';
import { knowledgeChunkRepository } from '@/server/repositories/knowledge-chunk-repository';
import type { KnowledgeChunk } from '@/server/repositories/knowledge-chunk-repository';
import { logger } from '@/lib/logger';

/**
 * GET /api/knowledge/items/[id]/chunks
 * 获取指定知识条目的分块内容
 *
 * Query params:
 * - version?: number - 可选，查看历史版本的分块
 * - page?: number   - 可选，分页页码（从 1 开始，默认 1）
 * - limit?: number  - 可选，每页条数（默认 50，上限 200）
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
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');

    const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
    const limit = Math.max(1, Math.min(200, parseInt(limitParam ?? '50', 10) || 50));
    const offset = (page - 1) * limit;

    let chunks: KnowledgeChunk[];
    let total: number;
    if (versionParam) {
      const version = parseInt(versionParam, 10);
      if (isNaN(version) || version < 1) {
        return apiSuccess({ error: '无效的版本号' }, 400);
      }
      const r = await knowledgeChunkRepository.getChunksAtVersionPaged(id, version, { offset, limit });
      chunks = r.chunks; total = r.total;
    } else {
      const r = await knowledgeChunkRepository.getActiveChunksPaged(id, { offset, limit });
      chunks = r.chunks; total = r.total;
    }

    return apiSuccess({ chunks, total, page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.api.error('[GET /api/knowledge/items/[id]/chunks] Failed to get chunks', { error: message, itemId: id });
    return NextResponse.json(
      { success: false, error: '服务器内部错误，请稍后重试' },
      { status: 500 }
    );
  }
}
