import { NextRequest } from 'next/server';
import { z } from 'zod';
import { RoutingService } from '@/server/services/routing-service';
import { parseJsonBody, HttpStatus, apiError, apiSuccess } from '@/lib/api-utils';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';

const service = new RoutingService();

const UuidSchema = z.string().uuid({ message: '必须是合法 UUID' });

const ConditionConfigSchema = z.union([
  z.object({
    keywords: z.array(z.string().min(1).max(100)).min(1).max(20),
    match_mode: z.enum(['exact', 'fuzzy']).optional(),
  }),
  z.object({}).strict(),
  z.null(),
  z.undefined(),
]);

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(100),
  condition_type: z.enum(['keyword', 'default']).optional(),
  condition_config: ConditionConfigSchema.optional(),
  target_bot_id: UuidSchema,
  priority: z.number().int().min(0).max(100).optional(),
  is_enabled: z.boolean().optional(),
});

const UpdateRuleSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(100).optional(),
  condition_type: z.enum(['keyword', 'default']).optional(),
  condition_config: ConditionConfigSchema.optional(),
  target_bot_id: UuidSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  is_enabled: z.boolean().optional(),
});

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'routing', action: 'read' },
  },
  async () => {
  const result = await service.listRules();
  return apiSuccess(result);
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'routing', action: 'write' },
  },
  async ({ request }) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const result = await service.createRule(parsed.data);
  return apiSuccess(result, HttpStatus.CREATED);
}, );

export { POSTHandler as POST };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'routing', action: 'write' },
  },
  async ({ request }) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = UpdateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '参数校验失败', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const { id, ...rest } = parsed.data;
  const result = await service.updateRule({ id, ...rest });
  return apiSuccess(result);
}, );

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'routing', action: 'delete' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? '缺少规则ID 或格式不合法', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  await service.deleteRule(parsed.data);
  return apiSuccess({ success: true });
}, );

export { DELETEHandler as DELETE };
