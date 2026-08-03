import { apiError, apiSuccess, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { getLogisticsProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/logistics-query
 * Query logistics information with provider-based mock/real API switching
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
    const tracking_number = (body?.tracking_number as string) || '';

    if (!order_id && !tracking_number) {
      return apiError('请提供订单号或物流单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    const provider = getLogisticsProvider();
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
  },
);

export { POSTHandler as POST };