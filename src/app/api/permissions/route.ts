import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess, apiError, requireRole, HttpStatus } from '@/lib/api-utils';
import { PermissionService } from '@/server/services/permission-service';

const service = new PermissionService();
const ADMIN_ONLY = ['admin'];

// Valid values — defense-in-depth against invalid data being persisted
const VALID_ROLES = ['admin', 'agent', 'observer'] as const;
const VALID_RESOURCES = ['conversations', 'knowledge', 'settings', 'team', 'customers', 'analytics', 'tickets', 'marketing', 'bots', 'sub_agents', 'routing', 'quality', 'push'] as const;
const VALID_ACTIONS = ['read', 'write', 'delete'] as const;

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

  const rawPermissions = body?.permissions as Array<{
    role?: string;
    resource?: string;
    action?: string;
    allowed?: boolean;
  }> | undefined;

  if (!rawPermissions || !Array.isArray(rawPermissions)) {
    return apiError('缺少 permissions 字段', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  // Validate each entry
  const permissions = rawPermissions.map((p) => {
    if (!p.role || !VALID_ROLES.includes(p.role as typeof VALID_ROLES[number])) {
      throw new Error(`无效的 role: ${p.role}`);
    }
    if (!p.resource || !VALID_RESOURCES.includes(p.resource as typeof VALID_RESOURCES[number])) {
      throw new Error(`无效的 resource: ${p.resource}`);
    }
    if (!p.action || !VALID_ACTIONS.includes(p.action as typeof VALID_ACTIONS[number])) {
      throw new Error(`无效的 action: ${p.action}`);
    }
    if (typeof p.allowed !== 'boolean') {
      throw new Error('allowed 必须是 boolean 类型');
    }
    return {
      role: p.role,
      resource: p.resource,
      action: p.action,
      allowed: p.allowed,
    };
  });

  const results = await service.updatePermissions(permissions);
  return apiSuccess({ permissions: results });
});
