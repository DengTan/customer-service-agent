import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess } from '@/lib/api-utils';

const service = new MarketingService();

// POST /api/marketing/execute - Execute a marketing campaign (find matching customers and send messages)
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const campaignId = body?.campaign_id as string;
  if (!campaignId) {
    return apiError('缺少活动ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await service.executeCampaign(campaignId);
  return apiSuccess(result);
});
