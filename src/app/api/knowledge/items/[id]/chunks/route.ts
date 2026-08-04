import { NextRequest } from 'next/server';
import { GET as defineGet } from '@/lib/api/with-api';
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
export const GET = defineGet(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ request, params }) => {
    const { id } = params as { id: string };
    try {
      const url = new URL(request.url);
      const searchParams = url.searchParams;
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
          return new Response(JSON.stringify({ success: false, error: '无效的版本号' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const r = await knowledgeChunkRepository.getChunksAtVersionPaged(id, version, { offset, limit });
        chunks = r.chunks; total = r.total;
      } else {
        const r = await knowledgeChunkRepository.getActiveChunksPaged(id, { offset, limit });
        chunks = r.chunks; total = r.total;
      }

      return new Response(JSON.stringify({ chunks, total, page, limit }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.api.error('[GET /api/knowledge/items/[id]/chunks] Failed to get chunks', { error: message, itemId: id });
      return new Response(JSON.stringify({ success: false, error: '服务器内部错误，请稍后重试' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
