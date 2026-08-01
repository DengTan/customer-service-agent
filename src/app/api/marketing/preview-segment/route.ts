import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requirePermission } from '@/lib/api-utils';
import { z } from 'zod';

const service = new MarketingService();

// Zod schema for segment preview validation
const SegmentPreviewSchema = z.object({
  target_segment: z.record(z.string(), z.unknown()).optional(),
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'marketing', 'write');
  if (denied) return denied;
  
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const validation = SegmentPreviewSchema.safeParse(body);
  if (!validation.success) {
    return apiError(validation.error.issues[0]?.message || '输入格式不正确', { status: HttpStatus.BAD_REQUEST });
  }

  const targetSegment = validation.data?.target_segment ?? {};
  const result = await service.previewSegment(targetSegment);
  return apiSuccess(result);
});
