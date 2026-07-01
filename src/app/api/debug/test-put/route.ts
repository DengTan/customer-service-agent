// Simple test endpoint
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function PUT(request: NextRequest) {
  logger.api.debug('[TEST PUT] Endpoint called');
  try {
    const body = await request.json();
    logger.api.debug('[TEST PUT] Body', { body });
    return NextResponse.json({ success: true, received: body });
  } catch (error) {
    logger.api.error('[TEST PUT] Error', { error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
