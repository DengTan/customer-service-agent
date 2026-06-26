import { NextRequest } from 'next/server';
import { RoutingService } from '@/server/services/routing-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess } from '@/lib/api-utils';

const service = new RoutingService();

// GET /api/routing-rules - List all routing rules
export const GET = withErrorHandlerSimple(async () => {
  const result = await service.listRules();
  return apiSuccess(result);
});

// POST /api/routing-rules - Create a new routing rule
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await service.createRule({
    name: body?.name as string,
    condition_type: body?.condition_type as string | undefined,
    condition_config: body?.condition_config as unknown | undefined,
    target_bot_id: body?.target_bot_id as string,
    priority: body?.priority as number | undefined,
    is_enabled: body?.is_enabled as boolean | undefined,
  });

  return apiSuccess(result);
});

// PUT /api/routing-rules - Update a routing rule
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await service.updateRule({
    id: body?.id as string,
    name: body?.name as string | undefined,
    condition_type: body?.condition_type as string | undefined,
    condition_config: body?.condition_config as unknown | undefined,
    target_bot_id: body?.target_bot_id as string | undefined,
    priority: body?.priority as number | undefined,
    is_enabled: body?.is_enabled as boolean | undefined,
  });

  return apiSuccess(result);
});

// DELETE /api/routing-rules?id=xxx - Delete a routing rule
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少规则ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  await service.deleteRule(id);
  return apiSuccess({ success: true });
});
