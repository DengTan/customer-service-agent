import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

// GET /api/agent-assignment/config - List all configs
export async function GET() {
  try {
    const service = new AgentAssignmentService();
    const configs = await service.listConfigs();
    return NextResponse.json({ configs });
  } catch (error) {
    logger.agent.error('GET configs failed', { error });
    return NextResponse.json(
      { error: 'Failed to get configs' },
      { status: 500 }
    );
  }
}

// POST /api/agent-assignment/config - Create config
export async function POST(request: NextRequest) {
  try {
    // Only admin can manage assignment config
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const service = new AgentAssignmentService();
    const config = await service.createConfig({
      strategy: body.strategy,
      name: body.name,
      is_enabled: body.is_enabled,
      condition_config: body.condition_config,
    });

    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    logger.agent.error('POST config failed', { error });
    return NextResponse.json(
      { error: 'Failed to create config' },
      { status: 500 }
    );
  }
}
