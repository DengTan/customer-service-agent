/**
 * Gorgias Tickets API
 * 获取工单列表
 */

import { NextRequest } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasTicketsAPI');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request }) => {
    try {
      const { searchParams } = new URL(request.url);

      const params: {
        limit?: number;
        cursor?: string;
        status?: string;
        assignee_user?: number;
        tag_id?: number;
        created_after?: string;
        created_before?: string;
      } = {};

      const limit = searchParams.get('limit');
      if (limit) params.limit = parseInt(limit, 10);

      const cursor = searchParams.get('cursor');
      if (cursor) params.cursor = cursor;

      const status = searchParams.get('status');
      if (status) params.status = status;

      const assignee_user = searchParams.get('assignee_user');
      if (assignee_user) params.assignee_user = parseInt(assignee_user, 10);

      const tag_id = searchParams.get('tag_id');
      if (tag_id) params.tag_id = parseInt(tag_id, 10);

      const created_after = searchParams.get('created_after');
      if (created_after) params.created_after = created_after;

      const created_before = searchParams.get('created_before');
      if (created_before) params.created_before = created_before;

      const result = await gorgiasService.getTickets(params);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      logger.error('Failed to get tickets', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Failed to get tickets' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
