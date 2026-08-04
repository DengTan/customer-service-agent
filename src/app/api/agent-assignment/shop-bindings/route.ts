import { NextRequest } from 'next/server';
import { withApi } from '@/lib/api/with-api';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

const service = new AgentAssignmentService();

// GET /api/agent-assignment/shop-bindings - List shop bindings
export const GET = withApi(
  { auth: 'required', perm: { resource: 'team', action: 'read' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const shop_id = searchParams.get('shop_id') ?? undefined;
      const user_id = searchParams.get('user_id') ?? undefined;

      const bindings = await service.listShopBindings(
        shop_id ? { shop_id } : user_id ? { user_id } : undefined
      );

      return new Response(JSON.stringify({ bindings }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('GET shop-bindings failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to get shop bindings' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

// POST /api/agent-assignment/shop-bindings - Create shop binding
export const POST = withApi(
  { auth: 'required', perm: { resource: 'team', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const result = await service.createShopBinding({
        shop_id: body.shop_id,
        user_id: body.user_id,
        priority: body.priority,
        is_enabled: body.is_enabled,
      });

      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const errorRecord = error as Record<string, unknown>;
      if (errorRecord.code === 'DUPLICATE_BINDING') {
        return new Response(JSON.stringify({ error: '该店铺和坐席的绑定已存在' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      logger.agent.error('POST shop-bindings failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to create shop binding' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

// DELETE /api/agent-assignment/shop-bindings?id=xxx - Delete shop binding
export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'team', action: 'write' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: 'Missing binding id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await service.deleteShopBinding(id);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.agent.error('DELETE shop-bindings failed', { error });
      return new Response(JSON.stringify({ error: 'Failed to delete shop binding' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
