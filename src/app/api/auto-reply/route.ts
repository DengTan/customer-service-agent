import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple } from '@/lib/api-utils';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import type { CreateAutoReplyRuleInput } from '@/server/repositories/auto-reply-repository';

const autoReplyService = new AutoReplyService();

export const GET = withErrorHandlerSimple(async () => {
  const rules = await autoReplyService.listRules();
  return apiSuccess({ rules });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  await autoReplyService.deleteRule(searchParams.get('id'));
  return apiSuccess({});
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const rule = await autoReplyService.createRule((body ?? {}) as unknown as CreateAutoReplyRuleInput);
  return apiSuccess({ rule });
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<{ id?: string; is_enabled?: boolean }>(request);
  if (parseError) return parseError;

  const rule = await autoReplyService.updateRuleEnabled(body?.id ?? '', body?.is_enabled as boolean);
  return apiSuccess({ rule });
});
