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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string }).code;
    logger.agent.error('GET agents failed', { error: errorMessage, code: errorCode });

    return NextResponse.json(
      { error: 'Failed to get agents status', details: errorMessage },
      { status: 500 }
    );
  }
}
