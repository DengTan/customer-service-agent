/**
 * Gorgias Customers API
 * 获取客户列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { requireRole } from '@/lib/api-utils';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasCustomersAPI');

/**
 * GET /api/gorgias/customers
 * 获取客户列表
 */
export async function GET(request: NextRequest) {
  try {
    const authError = await requireRole(request, ['observer', 'agent', 'admin']);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    
    const params: {
      limit?: number;
      cursor?: string;
      name?: string;
      email?: string;
    } = {};

    const limit = searchParams.get('limit');
    if (limit) params.limit = parseInt(limit, 10);
    
    const cursor = searchParams.get('cursor');
    if (cursor) params.cursor = cursor;
    
    const name = searchParams.get('name');
    if (name) params.name = name;
    
    const email = searchParams.get('email');
    if (email) params.email = email;

    const result = await gorgiasService.getCustomers(params);

    return NextResponse.json(result);
  } catch (err) {
    logger.error('Failed to get customers', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json(
      { error: 'Failed to get customers' },
      { status: 500 }
    );
  }
}
