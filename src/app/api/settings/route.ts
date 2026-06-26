import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { SettingsService } from '@/server/services/settings-service';

const settingsService = new SettingsService();
const ADMIN_ONLY = ['admin'];

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const settings = await settingsService.getSettingsMap();
  return apiSuccess({ settings });
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody<{ settings?: Record<string, string> }>(request);
  if (parseError) return parseError;

  await settingsService.updateSettings(body?.settings);
  return apiSuccess({});
});
