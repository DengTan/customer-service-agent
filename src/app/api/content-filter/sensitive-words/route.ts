/**
 * Content filter sensitive words API
 */
import { withApi } from '@/lib/api/with-api';
import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';

const repository = new ContentFilterRepository();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const isEnabledParam = searchParams.get('is_enabled');
    const is_enabled = isEnabledParam !== null ? isEnabledParam === 'true' : undefined;

    const words = await repository.listSensitiveWords({ category, is_enabled });
    return new Response(JSON.stringify({ ok: true, words }), {
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
    if (!input?.word || typeof input.word !== 'string' || !input.word.trim()) {
      return new Response(JSON.stringify({ error: '敏感词不能为空', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const word = await repository.createSensitiveWord({
      word: (input.word as string).trim(),
      match_mode: (input.match_mode as 'exact' | 'fuzzy') ?? 'exact',
      action: (input.action as 'block' | 'replace' | 'warn') ?? 'block',
      replacement: input.replacement as string | undefined,
      category: (input.category as string) ?? '脏话',
      is_enabled: (input.is_enabled as boolean | undefined) ?? true,
      created_by: input.created_by as string | undefined,
    });

    return new Response(JSON.stringify({ ok: true, word }), {
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
      return new Response(JSON.stringify({ error: '缺少敏感词 ID', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const word = await repository.updateSensitiveWord(input.id as string, {
      word: typeof input.word === 'string' ? input.word.trim() : undefined,
      match_mode: input.match_mode as 'exact' | 'fuzzy' | undefined,
      action: input.action as 'block' | 'replace' | 'warn' | undefined,
      replacement: input.replacement as string | undefined,
      category: input.category as string | undefined,
      is_enabled: input.is_enabled as boolean | undefined,
    });

    return new Response(JSON.stringify({ ok: true, word }), {
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
      return new Response(JSON.stringify({ error: '缺少敏感词 ID', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await repository.deleteSensitiveWord(id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
