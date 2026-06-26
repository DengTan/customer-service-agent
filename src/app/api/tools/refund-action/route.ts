import { NextRequest } from 'next/server';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { getRefundProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/refund-action
 * Apply for refund with provider-based mock/real API switching
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const order_id = (body?.order_id as string) || '';
  const reason = (body?.reason as string) || '';
  const amount = (body?.amount as number) || 0;

  if (!order_id) {
    return apiError('请提供订单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const provider = getRefundProvider();
  const result = await provider.execute({ order_id, reason, amount });

  if (result.errorCode) {
    return apiError(result.message, { status: HttpStatus.BAD_REQUEST, code: result.errorCode });
  }

  return apiSuccess({
    ...result.data,
    confidence: result.confidence,
    is_mock_data: result.isMockData,
  });
});
