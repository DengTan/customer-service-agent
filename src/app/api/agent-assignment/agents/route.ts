import { NextResponse } from 'next/server';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import { logger } from '@/lib/logger';

// GET /api/agent-assignment/agents - Get all agents status (for monitoring)
export async function GET() {
  try {
    const service = new AgentAssignmentService();
    const result = await service.getAllAgentsStatus();

    return NextResponse.json(result);
  } catch (error) {
    logger.agent.error('GET agents failed', { error });
    return NextResponse.json(
      { error: 'Failed to get agents status' },
      { status: 500 }
    );
  }
}
