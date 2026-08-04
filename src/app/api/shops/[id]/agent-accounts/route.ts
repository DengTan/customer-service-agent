import { NextRequest } from 'next/server';
import { parseJsonBody, apiSuccess } from '@/lib/api-utils';
import { requireRole } from '@/lib/api-utils';
import { ShopAgentAccountsService } from '@/server/services/shop-agent-accounts-service';
import { GET, POST, DELETE } from '@/lib/api/with-api';

const service = new ShopAgentAccountsService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'read' },
  },
  async ({ params }) => {
  const { id: shopId } = params as { id: string };
  if (!shopId) return apiSuccess({ accounts: [], total: 0, active: 0 });

  const [accountsResult, countResult] = await Promise.all([
    service.listByShopId(shopId),
    service.countByShopId(shopId),
  ]);

  return apiSuccess({
    ...accountsResult,
    ...countResult,
  });
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'write' },
  },
  async ({ request, params }) => {
  const { id: shopId } = params as { id: string };
  if (!shopId) throw new Error('Missing shop ID');

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const account = await service.create(
    shopId,
    body?.account_name as string,
    body?.password as string,
    body?.platform as string | undefined,
  );

  return apiSuccess({ account });
}, );

export { POSTHandler as POST };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'write' },
  },
  async ({ request }) => {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account_id');
  if (!accountId) throw new Error('Missing account_id');

  const result = await service.delete(accountId);
  return apiSuccess(result);
}, );

export { DELETEHandler as DELETE };
