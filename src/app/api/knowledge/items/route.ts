import { getEmbeddingService } from '@/server/services/embedding-service';
import { apiSuccess, apiError, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { GET, PUT, DELETE } from '@/lib/api/with-api';
import { KnowledgeService } from '@/server/services/knowledge-service';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { PAGINATION } from '@/lib/constants';

const knowledgeService = new KnowledgeService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('include_archived') === 'true';
    const onlyArchived = searchParams.get('only_archived') === 'true';
    const includeExpired = searchParams.get('include_expired') === 'true';
    const search = searchParams.get('search')?.trim() || undefined;
    const status = searchParams.get('status')?.trim() || undefined;
    const category = searchParams.get('category')?.trim() || undefined;

    const pageRaw = parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = parseInt(searchParams.get('limit') || String(PAGINATION.DEFAULT_PAGE_SIZE), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(PAGINATION.MAX_PAGE_SIZE, Math.max(1, limitRaw))
      : PAGINATION.DEFAULT_PAGE_SIZE;

    const result = await knowledgeService.listItems({
      includeArchived,
      onlyArchived,
      includeExpired,
      search,
      status,
      category,
      page,
      limit,
    });
    return apiSuccess(result);
  },
);

export { GETHandler as GET };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      id?: string;
      name?: string;
      content?: string;
      category?: string;
      parent_category?: string | null;
      image_url?: string | null;
      expires_at?: string | null;
    }>(request);
    if (parseError) return parseError;
    const urlId = request.nextUrl.searchParams.get('id');
    const { id = urlId, name, content, category, parent_category, image_url, expires_at } = body ?? {};

    if (!id) {
      return apiError('请提供条目ID', { status: HttpStatus.BAD_REQUEST, code: 'MISSING_ID' });
    }

    if (content !== undefined) {
      try {
        const embeddingService = getEmbeddingService();
        const embedding = await embeddingService.embed(content as string);
        if (!embedding.length) {
          return apiError('向量生成失败，请检查 Ollama 服务是否正常运行', {
            status: HttpStatus.SERVICE_UNAVAILABLE,
            code: 'EMBEDDING_FAILED',
          });
        }
        const supabase = getSupabaseClient();
        const { error: updateError } = await supabase
          .from('knowledge_items')
          .update({ embedding: JSON.stringify(embedding) })
          .eq('id', id);
        if (updateError) {
          logger.api.error('knowledge-item-embedding-update-failed', { id, error: updateError });
          return apiError('向量更新失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'DB_ERROR' });
        }
      } catch (error) {
        logger.api.error('knowledge-item-embed-failed', { id, error: (error as Error).message });
        return apiError('向量生成失败，请检查 Ollama 服务是否正常运行', {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'EMBEDDING_FAILED',
        });
      }

      await knowledgeService.updateItemWithVector({
        id: id as string,
        name,
        content: content as string,
        category,
      });

      return apiSuccess({
        message: '内容已更新，向量索引已更新',
      });
    }

    await knowledgeService.updateItem({
      id: id as string,
      name,
      category,
      parent_category,
      image_url,
      expires_at: expires_at === undefined ? undefined : expires_at,
    });
    return apiSuccess({});
  },
);

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'delete' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('请提供条目ID', { status: HttpStatus.BAD_REQUEST, code: 'MISSING_ID' });
    }

    await knowledgeService.deleteItem(id);
    return apiSuccess({});
  },
);

export { DELETEHandler as DELETE };