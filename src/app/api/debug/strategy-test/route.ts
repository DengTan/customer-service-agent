// Debug endpoint to test current-strategy PUT
import { NextRequest, NextResponse } from 'next/server';
import { AgentAssignmentService } from '@/server/services/agent-assignment-service';
import type { AssignmentStrategy } from '@/server/repositories/agent-assignment-repository';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const strategy = body.strategy as AssignmentStrategy;

    logger.api.debug('[DEBUG PUT] Request body', { strategy });
    
    const service = new AgentAssignmentService();
    const config = await service.getActiveConfig();
    
    logger.api.debug('[DEBUG PUT] Current config', { config });

    if (config) {
      logger.api.debug('[DEBUG PUT] Updating existing config', { configId: config.id });
      const result = await service.updateConfig({
        id: config.id,
        strategy,
      });
      logger.api.debug('[DEBUG PUT] Update result', { result });
      return NextResponse.json({ success: true, strategy, action: 'updated', result });
    } else {
      logger.api.debug('[DEBUG PUT] Creating new config');
      const result = await service.createConfig({
        strategy,
        name: '默认分配策略',
        is_enabled: true,
      });
      logger.api.debug('[DEBUG PUT] Create result', { result });
      return NextResponse.json({ success: true, strategy, action: 'created', result });
    }
  } catch (error) {
    logger.api.error('[DEBUG PUT] Error', { error });
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string }).code;
    return NextResponse.json({ 
      error: errorMessage, 
      code: errorCode,
      details: error 
    }, { status: 500 });
  }
}
