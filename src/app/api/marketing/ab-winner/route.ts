import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { apiSuccess, apiError, HttpStatus, parseJsonBody } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';

const service = new MarketingService();

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'marketing', action: 'write' },
  },
  async ({ request }) => {
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

  const result = await service.determineABWinner(campaign_id);
  return apiSuccess(result);
}, );

export { POSTHandler as POST };
