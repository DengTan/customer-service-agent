/**
 * Ticket custom fields API
 */
import { withApi } from '@/lib/api/with-api';
import { getCustomFields, createCustomField, updateCustomField, deleteCustomField } from '@/server/repositories/ticket-custom-field-repository';
import { getLogger } from '@/lib/logger';

const logger = getLogger('TicketsCustomFields');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async () => {
    try {
      const fields = await getCustomFields();
      return new Response(JSON.stringify({ fields }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Custom Fields] GET error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '获取自定义字段失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const { name, field_key, field_type, options, is_required, sort_order } = body;
      if (!name || !field_key) {
        return new Response(JSON.stringify({ error: '字段名称和字段标识必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const field = await createCustomField({
        name,
        field_key,
        field_type: field_type || 'text',
        options: options || null,
        is_required: is_required || false,
        sort_order: sort_order || 0,
        is_active: true,
      });
      return new Response(JSON.stringify({ field }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: unknown) {
      logger.error('[Ticket Custom Fields] POST error', { error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.message?.includes('duplicate')) {
        return new Response(JSON.stringify({ error: '字段标识已存在' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: '创建自定义字段失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const { id, ...updates } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: '字段ID必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const field = await updateCustomField(id, updates);
      return new Response(JSON.stringify({ field }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Custom Fields] PUT error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '更新自定义字段失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: '字段ID必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await deleteCustomField(id);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Custom Fields] DELETE error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '删除自定义字段失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
