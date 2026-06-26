import { NextRequest } from 'next/server';
import { PushService } from '@/server/services/push-service';
import { parseJsonBody, apiSuccess, withErrorHandlerSimple } from '@/lib/api-utils';

const pushService = new PushService();

export const GET = withErrorHandlerSimple(async () => {
  const result = await pushService.getEventLog();
  return apiSuccess({
    events: result.events,
    webhook_secret: result.webhook_secret,
  });
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<{ id: string; status: string }>(request);
  if (parseError) return parseError;

  const result = await pushService.updateEventStatus(body!);
  return apiSuccess({ event: result.event });
});
