import { NextRequest } from 'next/server';
import { ShopService } from '@/server/services/shop-service';
import { parseJsonBody, apiSuccess } from '@/lib/api-utils';
import { GET, PATCH, DELETE } from '@/lib/api/with-api';

const shopService = new ShopService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'read' },
  },
  async ({ params }) => {
  const { id } = params as { id: string };
  const result = await shopService.getById(id);
  return apiSuccess({ shop: result.shop });
}, );

export { GETHandler as GET };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'write' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };
  const { data: body, error: parseError } = await parseJsonBody<{
    name?: string;
    platform?: string;
    platform_connection_id?: string;
    shop_url?: string;
    logo_url?: string;
    total_accounts?: number;
    used_accounts?: number;
    status?: string;
    contact_name?: string;
    contact_phone?: string;
    remark?: string;
    knowledge_ids?: string[];
    config?: Record<string, unknown>;
    agent_quota?: number;
  }>(request);
  if (parseError) return parseError;

  const result = await shopService.update(id, body!);
  return apiSuccess({ shop: result.shop });
}, );

export { PATCHHandler as PATCH };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'settings', action: 'delete' },
  },
  async ({ params }) => {
  const { id } = params as { id: string };
  await shopService.delete(id);
  return apiSuccess({ success: true });
}, );

export { DELETEHandler as DELETE };
