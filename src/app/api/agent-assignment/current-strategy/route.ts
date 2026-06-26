import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import type { AssignmentStrategy } from '@/server/repositories/agent-assignment-repository';
import { logger } from '@/lib/logger';

// GET /api/agent-assignment/current-strategy - Get current strategy
export async function GET() {
  try {
    const service = new AgentAssignmentService();
    const config = await service.getActiveConfig();

    if (!config) {
      // Return default strategy if no config exists
      return NextResponse.json({ strategy: 'round_robin' });
    }

    return NextResponse.json({ strategy: config.strategy });
  } catch (error) {
    logger.agent.error('GET current strategy failed', { error });
    return NextResponse.json(
      { error: 'Failed to get current strategy' },
      { status: 500 }
    );
  }
}

// PUT /api/agent-assignment/current-strategy - Update current strategy
export async function PUT(request: NextRequest) {
  try {
    // Only admin can change strategy
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const strategy = body.strategy as AssignmentStrategy;

    if (!strategy || !['round_robin', 'load_balance', 'designated_shop'].includes(strategy)) {
      return NextResponse.json(
        { error: 'Invalid strategy' },
        { status: 400 }
      );
    }

    const service = new AgentAssignmentService();
    const config = await service.getActiveConfig();

    if (config) {
      // Update existing config
      await service.updateConfig({
        id: config.id,
        strategy,
      });
    } else {
      // Create new config with default name
      await service.createConfig({
        strategy,
        name: '默认分配策略',
        is_enabled: true,
      });
    }

    return NextResponse.json({ success: true, strategy });
  } catch (error) {
    logger.agent.error('PUT current strategy failed', { error });
    return NextResponse.json(
      { error: 'Failed to update strategy' },
      { status: 500 }
    );
  }
}
