import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

// GET /api/agent-assignment/shop-bindings - List shop bindings
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shop_id = searchParams.get('shop_id') ?? undefined;
    const user_id = searchParams.get('user_id') ?? undefined;

    const service = new AgentAssignmentService();
    const bindings = await service.listShopBindings(
      shop_id ? { shop_id } : user_id ? { user_id } : undefined
    );

    return NextResponse.json({ bindings });
  } catch (error) {
    logger.agent.error('GET shop-bindings failed', { error });
    return NextResponse.json(
      { error: 'Failed to get shop bindings' },
      { status: 500 }
    );
  }
}

// POST /api/agent-assignment/shop-bindings - Create shop binding
export async function POST(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const service = new AgentAssignmentService();
    const result = await service.createShopBinding({
      shop_id: body.shop_id,
      user_id: body.user_id,
      priority: body.priority,
      is_enabled: body.is_enabled,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const errorRecord = error as Record<string, unknown>;
    if (errorRecord.code === 'DUPLICATE_BINDING') {
      return NextResponse.json(
        { error: '该店铺和坐席的绑定已存在' },
        { status: 409 }
      );
    }
    logger.agent.error('POST shop-bindings failed', { error });
    return NextResponse.json(
      { error: 'Failed to create shop binding' },
      { status: 500 }
    );
  }
}

// DELETE /api/agent-assignment/shop-bindings?id=xxx - Delete shop binding
export async function DELETE(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing binding id' }, { status: 400 });
    }

    const service = new AgentAssignmentService();
    await service.deleteShopBinding(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.agent.error('DELETE shop-bindings failed', { error });
    return NextResponse.json(
      { error: 'Failed to delete shop binding' },
      { status: 500 }
    );
  }
}
