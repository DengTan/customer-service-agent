/**
 * Gorgias Users API
 * 获取坐席用户列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasUsersAPI');

/**
 * GET /api/gorgias/users
 * 获取坐席用户列表
 */
export async function GET(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['observer', 'agent', 'admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    
    const params: {
      limit?: number;
      cursor?: string;
      active?: boolean;
    } = {};

    const limit = searchParams.get('limit');
    if (limit) params.limit = parseInt(limit, 10);
    
    const cursor = searchParams.get('cursor');
    if (cursor) params.cursor = cursor;
    
    const active = searchParams.get('active');
    if (active !== null) params.active = active === 'true';

    const result = await gorgiasService.getUsers(params);

    return NextResponse.json(result);
  } catch (err) {
    logger.error('Failed to get users', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json(
      { error: 'Failed to get users' },
      { status: 500 }
    );
  }
}
