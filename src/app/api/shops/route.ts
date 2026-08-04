import { ShopService } from '@/server/services/shop-service';
import { parseJsonBody, apiSuccess } from '@/lib/api-utils';
import { GET, POST } from '@/lib/api/with-api';

const shopService = new ShopService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'read' },
  },
  async ({ request }) => {
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
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'write' },
  },
  async ({ request }) => {
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
}, );

export { POSTHandler as POST };
