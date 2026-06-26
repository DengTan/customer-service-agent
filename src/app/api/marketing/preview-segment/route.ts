import { NextRequest } from 'next/server';
import { MarketingService } from '@/server/services/marketing-service';
import { parseJsonBody, HttpStatus, withErrorHandlerSimple, apiError, apiSuccess } from '@/lib/api-utils';

const service = new MarketingService();

// POST /api/marketing/preview-segment - Preview customer segment matching
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const targetSegment = (body?.target_segment as Record<string, unknown>) ?? {};

  const result = await service.previewSegment(targetSegment);
  return apiSuccess(result);
});
