/**
 * 自动回复规则 API
 */
import { withApi } from '@/lib/api/with-api';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import type { CreateAutoReplyRuleInput } from '@/server/repositories/auto-reply-repository';

const autoReplyService = new AutoReplyService();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'auto_reply', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    const rawSearch = searchParams.get('search') || '';
    const search = rawSearch.length > 200 ? rawSearch.slice(0, 200) : rawSearch || undefined;
    const filterMode = (searchParams.get('filter') || 'all') as 'all' | 'enabled' | 'disabled';

    const { rules, total } = await autoReplyService.listRulesPaginated({ page, limit, offset, search, filterMode });
    return new Response(JSON.stringify({ ok: true, data: { rules, total, page, limit } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'auto_reply', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    await autoReplyService.deleteRule(searchParams.get('id'));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'auto_reply', action: 'write' } },
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

    const rule = await autoReplyService.createRule(body as unknown as CreateAutoReplyRuleInput);
    return new Response(JSON.stringify({ ok: true, rule }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'auto_reply', action: 'write' } },
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

    if (!body?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'Rule id is required', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rule = await autoReplyService.updateRule(body.id as string, {
      keyword: body.keyword as string | undefined,
      match_mode: body.match_mode as 'exact' | 'fuzzy' | undefined,
      reply_content: body.reply_content as string | undefined,
      is_enabled: body.is_enabled as boolean | undefined,
      priority: body.priority as number | undefined,
    });
    return new Response(JSON.stringify({ ok: true, rule }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const PATCH = withApi(
  { auth: 'required', perm: { resource: 'auto_reply', action: 'write' } },
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

    if (!body?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'Rule id is required', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rule = await autoReplyService.updateRulePartial(body.id as string, {
      is_enabled: body.is_enabled as boolean | undefined,
      priority: body.priority as number | undefined,
      keyword: body.keyword as string | undefined,
      match_mode: body.match_mode as 'exact' | 'fuzzy' | undefined,
      reply_content: body.reply_content as string | undefined,
    });
    return new Response(JSON.stringify({ ok: true, rule }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
