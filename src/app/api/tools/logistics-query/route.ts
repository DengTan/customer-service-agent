import { NextRequest } from 'next/server';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { getLogisticsProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/logistics-query
 * Query logistics information with provider-based mock/real API switching
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const order_id = (body?.order_id as string) || '';
  const tracking_number = (body?.tracking_number as string) || '';

  if (!order_id && !tracking_number) {
    return apiError('请提供订单号或物流单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const provider = getLogisticsProvider();
  const identifier = order_id || tracking_number;
  const result = await provider.execute({ order_id, tracking_number });

  if (result.errorCode) {
    return apiError(result.message, { status: HttpStatus.BAD_REQUEST, code: result.errorCode });
  }

  return apiSuccess({
    message_type: 'logistics',
    rich_content: result.data?.logistics,
    confidence: result.confidence,
    is_mock_data: result.isMockData,
  });
});
