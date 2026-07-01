import { NextRequest, NextResponse } from 'next/server';
import { AgentAssignmentRepository } from '@/server/repositories/agent-assignment-repository';
import { logger } from '@/lib/logger';

// GET /api/agent-assignment/current-strategy
export async function GET() {
  try {
    const repo = new AgentAssignmentRepository();
    const config = await repo.getActiveConfig();

    if (!config) {
      return NextResponse.json({ strategy: 'round_robin' });
    }

    return NextResponse.json({ strategy: config.strategy });
  } catch (error) {
    logger.api.error('[GET /current-strategy] Error', { error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/agent-assignment/current-strategy
export async function PUT(request: NextRequest) {
  logger.api.debug('[PUT /current-strategy] Called');
  try {
    const body = await request.json();
    const { strategy } = body;

    logger.api.debug('[PUT /current-strategy] Strategy', { strategy });

    if (!strategy) {
      return NextResponse.json({ error: 'Missing strategy' }, { status: 400 });
    }

    const repo = new AgentAssignmentRepository();
    const config = await repo.getActiveConfig();
    logger.api.debug('[PUT /current-strategy] Current config', { config });

    if (config) {
      logger.api.debug('[PUT /current-strategy] Updating config', { configId: config.id });
      await repo.updateConfig({ id: config.id, strategy });
    } else {
      logger.api.debug('[PUT /current-strategy] Creating new config');
      await repo.createConfig({ strategy, name: '默认分配策略', is_enabled: true });
    }

    return NextResponse.json({ success: true, strategy });
  } catch (error) {
    logger.api.error('[PUT /current-strategy] Error', { error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
