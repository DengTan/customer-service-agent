import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandler, apiSuccess } from '@/lib/api-utils';
import { requireRole } from '@/lib/api-utils';
import { ShopAgentAccountsService } from '@/server/services/shop-agent-accounts-service';

const service = new ShopAgentAccountsService();

export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  requireRole(request, ['admin']);
  const { id: shopId } = await params;
  if (!shopId) return apiSuccess({ accounts: [], total: 0, active: 0 });

  const [accountsResult, countResult] = await Promise.all([
    service.listByShopId(shopId),
    service.countByShopId(shopId),
  ]);

  return apiSuccess({
    ...accountsResult,
    ...countResult,
  });
});

export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  requireRole(request, ['admin']);
  const { id: shopId } = await params;
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
});

export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  requireRole(request, ['admin']);
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account_id');
  if (!accountId) throw new Error('Missing account_id');

  const result = await service.delete(accountId);
  return apiSuccess(result);
});
