import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple } from '@/lib/api-utils';
import { AlertService } from '@/server/services/alert-service';
import type { CreateAlertInput } from '@/server/repositories/alert-repository';

const alertService = new AlertService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const resolved = searchParams.get('resolved');
  const severity = searchParams.get('severity');
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const result = await alertService.listAlerts({
    resolved: resolved === null ? null : resolved === 'true',
    severity,
    limit,
  });

  return apiSuccess(result);
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await alertService.createAlert((body ?? {}) as unknown as CreateAlertInput);
  return apiSuccess(result);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  let id: string | null = null;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const { data: body, error: parseError } = await parseJsonBody<{ id?: string }>(request);
    if (parseError) return parseError;
    id = body?.id ?? null;
  }

  if (!id) {
    const { searchParams } = new URL(request.url);
    id = searchParams.get('id');
  }

  await alertService.resolveAlert(id);
  return apiSuccess({});
});
