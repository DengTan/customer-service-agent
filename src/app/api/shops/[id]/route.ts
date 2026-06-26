import { NextRequest } from 'next/server';
import { ShopService } from '@/server/services/shop-service';
import { parseJsonBody, apiSuccess, withErrorHandler, requireRole } from '@/lib/api-utils';

const shopService = new ShopService();

export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authError = requireRole(request, ['admin']);
  if (authError) return authError;

  const { id } = await params;
  const result = await shopService.getById(id);
  return apiSuccess({ shop: result.shop });
});

export const PATCH = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authError = requireRole(request, ['admin']);
  if (authError) return authError;

  const { id } = await params;
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
});

export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authError = requireRole(request, ['admin']);
  if (authError) return authError;

  const { id } = await params;
  await shopService.delete(id);
  return apiSuccess({ success: true });
});
