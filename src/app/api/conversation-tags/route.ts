/**
 * 对话标签管理 API
 */
import { withApi } from '@/lib/api/with-api';
import { ConversationTagService } from '@/server/services/conversation-tag-service';

const service = new ConversationTagService();

export const GET = withApi(
  { auth: 'required', perm: { resource: 'quality', action: 'write' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const conversation_id = searchParams.get('conversation_id');

    if (conversation_id) {
      const tags = await service.listForConversation(conversation_id);
      return new Response(JSON.stringify({ ok: true, tags }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tags = await service.listDefinitions({ category: category ?? undefined });
    return new Response(JSON.stringify({ ok: true, tags }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'quality', action: 'write' } },
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

    if (body.name && !body.id) {
      const tag = await service.createDefinition({
        name: body.name as string,
        color: body.color as string,
        category: body.category as string,
      });
      return new Response(JSON.stringify({ ok: true, tag }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.conversation_id && body.tag_id) {
      const record = await service.tagConversation({
        conversation_id: body.conversation_id as string,
        tag_id: body.tag_id as string,
        tagged_by: body.tagged_by as string,
      });
      return new Response(JSON.stringify({ ok: true, record }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: '无效的请求参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'quality', action: 'write' } },
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
      return new Response(JSON.stringify({ ok: false, error: '缺少标签ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const tag = await service.updateDefinition(body.id as string, {
      name: body.name as string,
      color: body.color as string,
      category: body.category as string,
    });
    return new Response(JSON.stringify({ ok: true, tag }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'quality', action: 'delete' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const record_id = searchParams.get('record_id');

    if (record_id) {
      await service.deleteRecord(record_id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (id) {
      await service.deleteDefinition(id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: '缺少ID参数' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
