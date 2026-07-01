import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requirePermission } from '@/lib/api-utils';
import { KnowledgeService } from '@/server/services/knowledge-service';

const knowledgeService = new KnowledgeService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('item_id');

  if (!itemId) {
    return apiSuccess({ error: '知识条目ID不能为空' }, 400);
  }

  const result = await knowledgeService.listVersions(itemId);
  return apiSuccess({ versions: result.versions });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'write');
  if (denied) return denied;

  const body = await request.json();
  const { item_id, title, content, category, change_summary, created_by } = body ?? {};

  const version = await knowledgeService.createVersion({
    item_id,
    title,
    content,
    change_summary: change_summary || null,
    created_by: created_by || null,
  });
  return apiSuccess({ version }, 201);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'knowledge', 'write');
  if (denied) return denied;

  const body = await request.json();
  const { version_id, created_by } = body ?? {};

  const result = await knowledgeService.rollbackToVersion({
    version_id,
    created_by: created_by || null,
  });
  return apiSuccess({ version: result.version });
});
