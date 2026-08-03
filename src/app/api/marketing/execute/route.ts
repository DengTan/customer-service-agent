import { MarketingService } from '@/server/services/marketing-service';
import { parseJsonBody, HttpStatus, apiError, apiSuccess } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';

const service = new MarketingService();

// POST /api/marketing/execute - Execute a marketing campaign (find matching customers and send messages)
export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'marketing', action: 'write' },
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody(request);
    if (parseError) return parseError;

    const campaignId = body?.campaign_id as string;
    if (!campaignId) {
      return apiError('缺少活动ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    const result = await service.executeCampaign(campaignId);
    return apiSuccess(result);
  },
);

export { POSTHandler as POST };
