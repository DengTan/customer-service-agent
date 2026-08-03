import { apiError, apiSuccess, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { getOrderProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/order-query
 * Query order status with provider-based mock/real API switching
 */
export const POSTHandler = POST(
  {
    auth: 'required',
    rateLimit: { maxRequests: 60, windowMs: 60_000 },
  },
  async ({ request }) => {
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
  },
);

export { POSTHandler as POST };