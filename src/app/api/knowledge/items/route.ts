import { NextRequest } from 'next/server';
import { getEmbeddingService } from '@/server/services/embedding-service';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requirePermission } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const knowledgeService = new KnowledgeService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get('include_archived') === 'true';
  const onlyArchived = searchParams.get('only_archived') === 'true';
  const includeExpired = searchParams.get('include_expired') === 'true';
  const search = searchParams.get('search')?.trim() || undefined;
  const status = searchParams.get('status')?.trim() || undefined;
  const category = searchParams.get('category')?.trim() || undefined;

  const pageRaw = parseInt(searchParams.get('page') || '1', 10);
  const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 20;

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
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'write');
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError('请求体格式无效', { status: HttpStatus.BAD_REQUEST, code: 'INVALID_JSON' });
  }
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
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  // Fine-grained permission check
  const denied = await requirePermission(request, 'knowledge', 'delete');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    // P0-1: DELETE handler 错误响应修正，统一使用 apiError + code
    return apiError('请提供条目ID', { status: HttpStatus.BAD_REQUEST, code: 'MISSING_ID' });
  }

  await knowledgeService.deleteItem(id);
  return apiSuccess({});
});
