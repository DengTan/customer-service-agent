import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';

const service = new MarketingService();

// GET /api/marketing/analytics - Get marketing analytics data
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id') ?? undefined;
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);

  const result = await service.getAnalytics(campaignId, days);
  return apiSuccess({ data: result });
});
