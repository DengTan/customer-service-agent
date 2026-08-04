/**
 * 告警管理 API
 */
import { withApi } from '@/lib/api/with-api';
import { AlertService } from '@/server/services/alert-service';
import type { CreateAlertInput } from '@/server/repositories/alert-repository';
import { extractUserRole, getAuthenticatedUserId } from '@/lib/api-utils';

type AlertAction = 'resolve' | 'dismiss' | 'reopen';
const ALERT_ACTION_BODY: AlertAction[] = ['resolve', 'dismiss', 'reopen'];

const alertService = new AlertService();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const resolved = searchParams.get('resolved');
    const severity = searchParams.get('severity');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const result = await alertService.listAlerts({
      resolved: resolved === null ? null : resolved === 'true',
      severity,
      limit,
    });

    return new Response(JSON.stringify({
      ok: true,
      alerts: result.alerts,
      total: result.stats.unresolved,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: '请求体无效' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await alertService.createAlert(body as unknown as CreateAlertInput);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const PATCH = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    let id: string | null = null;
    let action: AlertAction = 'resolve';
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      try {
        const body = await request.json() as { id?: string | null; action?: AlertAction | null };
        id = body?.id ?? null;
        const requestedAction = body?.action ?? null;
        if (requestedAction && ALERT_ACTION_BODY.includes(requestedAction)) {
          action = requestedAction;
        } else if (requestedAction) {
          return new Response(JSON.stringify({ ok: false, error: '未知 action', code: 'VALIDATION_ERROR' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch {
        // Fall through to query params
      }
    }

    if (!id) {
      const { searchParams } = new URL(request.url);
      id = searchParams.get('id');
    }

    if (!id) {
      return new Response(JSON.stringify({ ok: false, error: '缺少告警 ID', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
