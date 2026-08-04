/**
 * GET /api/eval/calibration — list calibration rows for a slice
 *   botId   <uuid>    required
 *   shopId  <uuid>   optional — pass "null" for all-shops slice
 *
 * POST /api/eval/calibration — lifecycle action on a calibration row
 *   Body: { action: 'promote' | 'pause' | 'rollback'; id: string }
 */

import { withApi } from '@/lib/api/with-api';
import { EvalCalibrationRepository } from '@/server/repositories/eval-calibration-repository';
import { getAuthenticatedUserId } from '@/lib/api-utils';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);

    const botIdRaw = searchParams.get('botId');
    if (!botIdRaw || typeof botIdRaw !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 botId 参数', code: 'MISSING_BOT_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shopIdParam = searchParams.get('shopId');
    const shopId: string | null =
      shopIdParam === null || shopIdParam === 'null'
        ? null
        : shopIdParam ?? null;

    const repo = new EvalCalibrationRepository();
    const rows = await repo.listBySlice(botIdRaw, shopId);

    return new Response(JSON.stringify({ ok: true, rows }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const userId = getAuthenticatedUserId(request) ?? 'unknown';

    const body = await request.json().catch(() => ({}));
    const { action, id } = body as { action?: string; id?: string };

    if (!id || typeof id !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 id', code: 'MISSING_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!action || typeof action !== 'string') {
      return new Response(JSON.stringify({ error: '缺少或无效的 action', code: 'MISSING_ACTION' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const repo = new EvalCalibrationRepository();

    if (action === 'promote') {
      const updated = await repo.promote(id, userId);
      return new Response(JSON.stringify({ ok: true, row: updated, action }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'rollback') {
      const updated = await repo.archive(id);
      return new Response(JSON.stringify({ ok: true, row: updated, action }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'pause') {
      const updated = await repo.archive(id);
      return new Response(JSON.stringify({ ok: true, row: updated, action }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: '不支持的 action 类型', code: 'INVALID_ACTION' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
