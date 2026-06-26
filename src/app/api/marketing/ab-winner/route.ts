import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { withErrorHandler } from '@/lib/api-utils';
import { apiSuccess, apiError, HttpStatus, parseJsonBody } from '@/lib/api-utils';

const service = new MarketingService();

/**
 * POST /api/marketing/ab-winner
 * Determine A/B test winner for a campaign
 * POST /api/marketing/ab-winner/promote
 * Promote winner variant to all future sends
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const { data, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const body = data as { action?: string; campaign_id?: string; winner?: string } | undefined;
  const action = body?.action;
  const campaign_id = body?.campaign_id;

  if (!campaign_id) {
    return apiError('缺少活动ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  if (action === 'promote') {
    const winner = body?.winner;
    if (!winner || !['A', 'B'].includes(winner)) {
      return apiError('缺少有效的获胜变体（A 或 B）', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }
    const result = await service.promoteVariant(campaign_id, winner as 'A' | 'B');
    return apiSuccess(result);
  }

  // Default: determine winner
  const result = await service.determineABWinner(campaign_id);
  return apiSuccess(result);
});
