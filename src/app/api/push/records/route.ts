import { NextRequest } from 'next/server';
import { PushService } from '@/server/services/push-service';
import { apiSuccess } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';

const pushService = new PushService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);

  const result = await pushService.listRecords({
    trigger_event: searchParams.get('trigger_event'),
    status: searchParams.get('status'),
    channel: searchParams.get('channel'),
    start_date: searchParams.get('start_date'),
    end_date: searchParams.get('end_date'),
    limit: parseInt(searchParams.get('limit') || '50'),
    offset: parseInt(searchParams.get('offset') || '0'),
  });

  return apiSuccess({ records: result.records, total: result.total });
}, );

export { GETHandler as GET };
