import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, withErrorHandlerSimple, requirePermission, HttpStatus } from '@/lib/api-utils';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import type { CreateAutoReplyRuleInput } from '@/server/repositories/auto-reply-repository';

const autoReplyService = new AutoReplyService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'auto_reply', 'read');
  if (denied) return denied;

  const rules = await autoReplyService.listRules();
  return apiSuccess({ rules });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'auto_reply', 'write');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  await autoReplyService.deleteRule(searchParams.get('id'));
  return apiSuccess({});
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'auto_reply', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const rule = await autoReplyService.createRule((body ?? {}) as unknown as CreateAutoReplyRuleInput);
  return apiSuccess({ rule });
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'auto_reply', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody<{
    id?: string;
    keyword?: string;
    match_mode?: 'exact' | 'fuzzy';
    reply_content?: string;
    is_enabled?: boolean;
    priority?: number;
  }>(request);
  if (parseError) return parseError;

  if (!body?.id) {
    return apiError('Rule id is required', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const rule = await autoReplyService.updateRule(body.id, {
    keyword: body.keyword,
    match_mode: body.match_mode,
    reply_content: body.reply_content,
    is_enabled: body.is_enabled,
    priority: body.priority,
  });
  return apiSuccess({ rule });
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'auto_reply', 'write');
  if (denied) return denied;

  const { data: body, error: parseError } = await parseJsonBody<{
    id?: string;
    is_enabled?: boolean;
    priority?: number;
    keyword?: string;
    match_mode?: 'exact' | 'fuzzy';
    reply_content?: string;
  }>(request);
  if (parseError) return parseError;

  if (!body?.id) {
    return apiError('Rule id is required', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const rule = await autoReplyService.updateRulePartial(body.id, {
    is_enabled: body.is_enabled,
    priority: body.priority,
    keyword: body.keyword,
    match_mode: body.match_mode,
    reply_content: body.reply_content,
  });
  return apiSuccess({ rule });
});
