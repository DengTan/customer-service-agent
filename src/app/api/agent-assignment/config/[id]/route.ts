import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

// PUT /api/agent-assignment/config?id=xxx - Update config
export async function PUT(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing config id' }, { status: 400 });
    }

    const body = await request.json();
    const service = new AgentAssignmentService();
    const config = await service.updateConfig({
      id,
      strategy: body.strategy,
      name: body.name,
      is_enabled: body.is_enabled,
      condition_config: body.condition_config,
    });

    return NextResponse.json({ config });
  } catch (error) {
    logger.agent.error('PUT config failed', { error });
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}

// DELETE /api/agent-assignment/config?id=xxx - Delete config
export async function DELETE(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing config id' }, { status: 400 });
    }

    const service = new AgentAssignmentService();
    await service.deleteConfig(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.agent.error('DELETE config failed', { error });
    return NextResponse.json(
      { error: 'Failed to delete config' },
      { status: 500 }
    );
  }
}
