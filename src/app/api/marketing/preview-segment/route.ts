import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { parseJsonBody, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { z } from 'zod';

const service = new MarketingService();

const SegmentPreviewSchema = z.object({
  target_segment: z.record(z.string(), z.unknown()).optional(),
});

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'marketing', action: 'write' },
  },
  async ({ request }) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const validation = SegmentPreviewSchema.safeParse(body);
  if (!validation.success) {
    return apiError(validation.error.issues[0]?.message || '输入格式不正确', { status: HttpStatus.BAD_REQUEST });
  }

  const targetSegment = validation.data?.target_segment ?? {};
  const result = await service.previewSegment(targetSegment);
  return apiSuccess(result);
}, );

export { POSTHandler as POST };
