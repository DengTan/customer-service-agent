import { NextRequest } from 'next/server';
import { KnowledgeClient, Config, KnowledgeDocument, DataSourceType } from 'coze-coding-dev-sdk';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requirePermission } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get('include_archived') === 'true';
  const includeExpired = searchParams.get('include_expired') === 'true';
  const result = await knowledgeService.listItems({ includeArchived, includeExpired });
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
    const knowledgeConfig = new Config();
    const knowledgeClient = new KnowledgeClient(knowledgeConfig);

    const documents: KnowledgeDocument[] = [
      { source: DataSourceType.TEXT, raw_data: content as string },
    ];

    const addResult = await knowledgeClient.addDocuments(documents, 'coze_doc_knowledge', {
      separator: '\n\n',
      max_tokens: 2000,
    });

    if (addResult.code !== 0) {
      return apiError(addResult.msg, { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'COZE_API_ERROR' });
    }

    const newDocIds = addResult.doc_ids || [];

    await knowledgeService.updateItemWithVector({
      id: id as string,
      name,
      content: content as string,
      category,
      new_doc_ids: newDocIds,
    });

    return apiSuccess({
      message: '内容已更新，向量索引已增量更新',
      new_doc_ids: newDocIds,
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
    return apiSuccess({ error: '请提供条目ID' }, 400);
  }

  await knowledgeService.deleteItem(id);
  return apiSuccess({});
});
