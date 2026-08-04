/**
 * Gorgias Customers API
 * 获取客户列表
 */

import { NextRequest } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasCustomersAPI');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request }) => {
    try {
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

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      logger.error('Failed to get customers', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Failed to get customers' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
