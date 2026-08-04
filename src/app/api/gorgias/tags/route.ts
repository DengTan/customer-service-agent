/**
 * Gorgias Tags API
 * 获取标签列表
 */

import { NextRequest } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasTagsAPI');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request }) => {
    try {
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

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      logger.error('Failed to get tags', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Failed to get tags' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
