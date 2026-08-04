/**
 * Ticket categories API
 */
import { withApi } from '@/lib/api/with-api';
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/server/repositories/ticket-custom-field-repository';
import { getLogger } from '@/lib/logger';

const logger = getLogger('TicketsCategories');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'tickets', action: 'write' } },
  async ({ request }) => {
    try {
      const categories = await getCategories();
      return new Response(JSON.stringify({ categories }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Categories] GET error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '获取分类列表失败' }), {
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
      const { name, color, description, sort_order } = body;
      if (!name) {
        return new Response(JSON.stringify({ error: '分类名称必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const category = await createCategory({
        name,
        color: color || '#6b7280',
        description: description || null,
        sort_order: sort_order || 0,
        is_active: true,
      });
      return new Response(JSON.stringify({ category }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Categories] POST error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '创建分类失败' }), {
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
        return new Response(JSON.stringify({ error: '分类ID必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const category = await updateCategory(id, updates);
      return new Response(JSON.stringify({ category }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Categories] PUT error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '更新分类失败' }), {
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
        return new Response(JSON.stringify({ error: '分类ID必填' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      await deleteCategory(id);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.error('[Ticket Categories] DELETE error', { error: error instanceof Error ? error.message : String(error) });
      return new Response(JSON.stringify({ error: '删除分类失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
