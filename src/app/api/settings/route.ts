import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple, requireRole, requirePermission } from '@/lib/api-utils';
import { SettingsService } from '@/server/services/settings-service';

const settingsService = new SettingsService();
const ADMIN_ONLY = ['admin'];

// Whitelist of valid resource and action values (defense-in-depth for PUT)
const VALID_RESOURCES = ['conversations', 'knowledge', 'settings', 'team', 'customers', 'analytics', 'tickets', 'marketing'] as const;
const VALID_ACTIONS = ['read', 'write', 'delete'] as const;

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  // All roles (admin/agent/observer) can read settings
  const denied = await requirePermission(request, 'settings', 'read');
  if (denied) return denied;

  const settings = await settingsService.getSettingsMap();
  return apiSuccess({ settings });
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  // Only admin can write settings
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const settings = body?.settings as Record<string, string> | undefined;
  await settingsService.updateSettings(settings);
  return apiSuccess({});
});
