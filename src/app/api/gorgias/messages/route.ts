/**
 * Gorgias Messages API
 * 获取消息列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasMessagesAPI');

/**
 * GET /api/gorgias/messages
 * 获取消息列表
 */
export async function GET(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['observer', 'agent', 'admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    
    const params: {
      limit?: number;
      cursor?: string;
      sender_id?: number;
      channel?: string;
    } = {};

    const limit = searchParams.get('limit');
    if (limit) params.limit = parseInt(limit, 10);
    
    const cursor = searchParams.get('cursor');
    if (cursor) params.cursor = cursor;
    
    const sender_id = searchParams.get('sender_id');
    if (sender_id) params.sender_id = parseInt(sender_id, 10);
    
    const channel = searchParams.get('channel');
    if (channel) params.channel = channel;

    const result = await gorgiasService.getMessages(params);

    return NextResponse.json(result);
  } catch (err) {
    logger.error('Failed to get messages', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json(
      { error: 'Failed to get messages' },
      { status: 500 }
    );
  }
}
