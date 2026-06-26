import { NextRequest } from 'next/server';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { getOrderProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/order-query
 * Query order status with provider-based mock/real API switching
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const order_id = (body?.order_id as string) || '';

  if (!order_id) {
    return apiError('请提供订单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const provider = getOrderProvider();
  const result = await provider.execute({ order_id });

  if (result.errorCode) {
    return apiError(result.message, { status: HttpStatus.BAD_REQUEST, code: result.errorCode });
  }

  return apiSuccess({
    message_type: 'order',
    rich_content: result.data?.order,
    confidence: result.confidence,
    is_mock_data: result.isMockData,
  });
});
