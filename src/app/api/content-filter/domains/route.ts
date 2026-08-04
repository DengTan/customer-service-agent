/**
 * Content filter domains API
 */
import { withApi } from '@/lib/api/with-api';
import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';

const repository = new ContentFilterRepository();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const isEnabledParam = searchParams.get('is_enabled');
    const is_enabled = isEnabledParam !== null ? isEnabledParam === 'true' : undefined;

    const domains = await repository.listAllowedDomains({ is_enabled });
    return new Response(JSON.stringify({ ok: true, domains }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const input = body as Record<string, unknown> | undefined;
    if (!input?.domain || typeof input.domain !== 'string' || !input.domain.trim()) {
      return new Response(JSON.stringify({ error: '域名不能为空', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const domain = await repository.createAllowedDomain({
      domain: (input.domain as string).trim(),
      pattern_type: (input.pattern_type as 'exact' | 'wildcard' | 'suffix') ?? 'exact',
      description: input.description as string | undefined,
      is_enabled: (input.is_enabled as boolean | undefined) ?? true,
      created_by: input.created_by as string | undefined,
    });

    return new Response(JSON.stringify({ ok: true, domain }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    const input = body as Record<string, unknown> | undefined;
    if (!input?.id) {
      return new Response(JSON.stringify({ error: '缺少域名 ID', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const domain = await repository.updateAllowedDomain(input.id as string, {
      domain: typeof input.domain === 'string' ? input.domain.trim() : undefined,
      pattern_type: input.pattern_type as 'exact' | 'wildcard' | 'suffix' | undefined,
      description: input.description as string | undefined,
      is_enabled: input.is_enabled as boolean | undefined,
    });

    return new Response(JSON.stringify({ ok: true, domain }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: '缺少域名 ID', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await repository.deleteAllowedDomain(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
