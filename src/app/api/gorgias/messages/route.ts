/**
 * Gorgias Messages API
 * 获取消息列表
 */

import { NextRequest } from 'next/server';
import { gorgiasService } from '@/server/services/gorgias-service';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';

const logger = getLogger('GorgiasMessagesAPI');

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'read' } },
  async ({ request }) => {
    try {
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

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      logger.error('Failed to get messages', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Failed to get messages' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
