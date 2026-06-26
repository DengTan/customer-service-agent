import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess, requireRole } from '@/lib/api-utils';
import { PermissionService } from '@/server/services/permission-service';

const service = new PermissionService();
const ADMIN_ONLY = ['admin'];

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const permissions = await service.listPermissions();
  return apiSuccess({ permissions });
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const permissions = body?.permissions as Array<{
    role: string;
    resource: string;
    action: string;
    allowed: boolean;
  }>;

  const results = await service.updatePermissions(permissions);
  return apiSuccess({ permissions: results });
});
