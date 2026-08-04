import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { apiSuccess } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';

const service = new MarketingService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'marketing', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id') ?? undefined;
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);

  const result = await service.getAnalytics(campaignId, days);
  return apiSuccess({ data: result });
}, );

export { GETHandler as GET };
