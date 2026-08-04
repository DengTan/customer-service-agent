/**
 * Gorgias Users API
 * 获取坐席用户列表
 */

import { NextRequest } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasUsersAPI');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request }) => {
    try {
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

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      logger.error('Failed to get users', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Failed to get users' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
