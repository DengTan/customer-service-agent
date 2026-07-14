import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess, requirePermission } from '@/lib/api-utils';
import { ConversationTagService } from '@/server/services/conversation-tag-service';

const service = new ConversationTagService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'quality', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const conversation_id = searchParams.get('conversation_id');

  if (conversation_id) {
    const tags = await service.listForConversation(conversation_id);
    return apiSuccess({ tags });
  }

  const tags = await service.listDefinitions({ category });
  return apiSuccess({ tags });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'quality', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  // 创建标签（无 id 时为创建）
  if (body?.name && !body?.id) {
    const tag = await service.createDefinition({
      name: body.name as string,
      color: body.color as string,
      category: body.category as string,
    });
    return apiSuccess({ tag });
  }

  // 为对话打标签
  if (body?.conversation_id && body?.tag_id) {
    const record = await service.tagConversation({
      conversation_id: body.conversation_id as string,
      tag_id: body.tag_id as string,
      tagged_by: body.tagged_by as string,
    });
    return apiSuccess({ record });
  }

  throw new Error('无效的请求参数');
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'quality', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  if (!body?.id) {
    throw new Error('缺少标签ID');
  }

  const tag = await service.updateDefinition(body.id as string, {
    name: body.name as string,
    color: body.color as string,
    category: body.category as string,
  });
  return apiSuccess({ tag });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'quality', 'delete');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const record_id = searchParams.get('record_id');

  if (record_id) {
    await service.deleteRecord(record_id);
    return apiSuccess({ success: true });
  }

  if (id) {
    await service.deleteDefinition(id);
    return apiSuccess({ success: true });
  }

  throw new Error('缺少ID参数');
});
