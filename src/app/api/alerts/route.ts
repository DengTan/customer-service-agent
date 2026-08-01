import { NextRequest } from 'next/server';
import {
  apiError,
  apiSuccess,
  extractUserRole,
  getAuthenticatedUserId,
  HttpStatus,
  parseJsonBody,
  requireRole,
  withErrorHandlerSimple,
} from '@/lib/api-utils';
import { AlertService } from '@/server/services/alert-service';
import type { CreateAlertInput } from '@/server/repositories/alert-repository';

type AlertAction = 'resolve' | 'dismiss' | 'reopen';

const ALERT_ACTION_BODY: AlertAction[] = ['resolve', 'dismiss', 'reopen'];
const WRITE_ROLES = ['admin', 'agent'];
const ADMIN_ROLES = ['admin'];

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

  return apiSuccess({
    alerts: result.alerts,
    total: result.stats.unresolved,
  });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const result = await alertService.createAlert((body ?? {}) as unknown as CreateAlertInput);
  return apiSuccess(result);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  let id: string | null = null;
  let action: AlertAction = 'resolve';
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const { data: body, error: parseError } = await parseJsonBody<{
      id?: string | null;
      action?: AlertAction | null;
    }>(request);
    if (parseError) return parseError;
    id = body?.id ?? null;
    const requestedAction = body?.action ?? null;
    if (requestedAction && ALERT_ACTION_BODY.includes(requestedAction)) {
      action = requestedAction;
    } else if (requestedAction) {
      return apiError('未知 action', {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }
  }

  if (!id) {
    const { searchParams } = new URL(request.url);
    id = searchParams.get('id');
  }

  if (!id) {
    return apiError('缺少告警 ID', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  // Reopen is privileged: only admins may un-resolve an alert. Other actions
  // remain open to both admins and agents so the operational state machine
  // stays reversible inside the on-call rotation.
  const allowedRoles = action === 'reopen' ? ADMIN_ROLES : WRITE_ROLES;
  const denial = requireRole(request, allowedRoles);
  if (denial) return denial;

  const operator = {
    operatorId: getAuthenticatedUserId(request),
    operatorRole: extractUserRole(request),
  };

  switch (action) {
    case 'resolve':
      await alertService.resolveAlert(id, operator);
      break;
    case 'dismiss':
      await alertService.dismissAlert(id, operator);
      break;
    case 'reopen':
      await alertService.reopenAlert(id, operator);
      break;
  }
  return apiSuccess({});
});
