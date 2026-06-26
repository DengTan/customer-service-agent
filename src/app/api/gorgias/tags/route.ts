/**
 * Gorgias Tags API
 * 获取标签列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasTagsAPI');

/**
 * GET /api/gorgias/tags
 * 获取标签列表
 */
export async function GET(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['observer', 'agent', 'admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    
    const params: {
      limit?: number;
      cursor?: string;
    } = {};

    const limit = searchParams.get('limit');
    if (limit) params.limit = parseInt(limit, 10);
    
    const cursor = searchParams.get('cursor');
    if (cursor) params.cursor = cursor;

    const result = await gorgiasService.getTags(params);

    return NextResponse.json(result);
  } catch (err) {
    logger.error('Failed to get tags', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json(
      { error: 'Failed to get tags' },
      { status: 500 }
    );
  }
}
