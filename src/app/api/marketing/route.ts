import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess } from '@/lib/api-utils';

const service = new MarketingService();

// GET /api/marketing - List marketing campaigns with stats
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const type = searchParams.get('type') ?? undefined;

  const result = await service.listCampaigns({
    status: status ?? null,
    type: type ?? null,
  });
  return apiSuccess(result);
});

// POST /api/marketing - Create a new marketing campaign
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await service.createCampaign({
    name: body?.name as string,
    type: body?.type as string,
    target_segment: body?.target_segment as unknown,
    bot_id: body?.bot_id as string | null | undefined,
    ab_variants: body?.ab_variants as unknown | null | undefined,
    message_template: body?.message_template as string | null | undefined,
    trigger_type: body?.trigger_type as 'manual' | 'scheduled' | 'event' | undefined,
    scheduled_at: body?.scheduled_at as string | null | undefined,
    trigger_config: body?.trigger_config as unknown | undefined,
  });

  return apiSuccess(result, HttpStatus.CREATED);
});

// PATCH /api/marketing - Update campaign (all fields)
export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const { id, status, name, type, target_segment, bot_id, ab_variants, message_template, trigger_type, scheduled_at, trigger_config } = body ?? {};

  if (!id) {
    return apiError('缺少活动ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await service.updateCampaign({
    id: id as string,
    ...(status !== undefined && { status: status as string }),
    ...(name !== undefined && { name: name as string }),
    ...(type !== undefined && { type: type as string }),
    ...(target_segment !== undefined && { target_segment }),
    ...(bot_id !== undefined && { bot_id: bot_id as string | null }),
    ...(ab_variants !== undefined && { ab_variants }),
    ...(message_template !== undefined && { message_template: message_template as string | null }),
    ...(trigger_type !== undefined && { trigger_type: trigger_type as 'manual' | 'scheduled' | 'event' }),
    ...(scheduled_at !== undefined && { scheduled_at: scheduled_at as string | null }),
    ...(trigger_config !== undefined && { trigger_config }),
  });

  return apiSuccess(result);
});

// DELETE /api/marketing?id=xxx - Delete a marketing campaign
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少活动ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  await service.deleteCampaign(id);
  return apiSuccess({ success: true });
});
