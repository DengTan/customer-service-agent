import { NextRequest } from 'next/server';
import { ShopService } from '@/server/services/shop-service';
import { parseJsonBody, apiSuccess, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';

const shopService = new ShopService();

export const GET = withErrorHandlerSimple(async (request) => {
  const authError = requireRole(request, ['admin']);
  if (authError) return authError;

  const url = new URL(request.url);
  const withStats = url.searchParams.get('stats') === 'true';

  if (withStats) {
    const [shopsResult, statsResult] = await Promise.all([
      shopService.list(),
      shopService.getStats(),
    ]);
    return apiSuccess({
      shops: shopsResult.shops,
      stats: statsResult,
    });
  }

  const result = await shopService.list();
  return apiSuccess({ shops: result.shops });
});

export const POST = withErrorHandlerSimple(async (request) => {
  const authError = requireRole(request, ['admin']);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    name: string;
    platform: string;
    platform_connection_id?: string;
    shop_url?: string;
    logo_url?: string;
    total_accounts?: number;
    contact_name?: string;
    contact_phone?: string;
    remark?: string;
    knowledge_ids?: string[];
    config?: Record<string, unknown>;
    agent_quota?: number;
  }>(request);
  if (parseError) return parseError;

  const result = await shopService.create(body!);
  return apiSuccess({ shop: result.shop });
});
