import { NextRequest } from 'next/server';
import { PushService } from '@/server/services/push-service';
import { parseJsonBody, apiSuccess, withErrorHandlerSimple, requireRole } from '@/lib/api-utils';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

const pushService = new PushService();

const ADMIN_ONLY = ['admin'];

/**
 * Returns whether a webhook-secret preview can be shown to a caller.
 * The secret is NEVER returned in plaintext via this endpoint. To support
 * admins who legitimately need to copy/paste the secret into an external
 * system, we return only metadata:
 *   - configured:    whether a secret is stored
 *   - last4:         last 4 characters of the secret (safe to display)
 *   - updated_at:    timestamp of the last rotation
 */
async function getWebhookSecretPreview(): Promise<{
  configured: boolean;
  last4: string | null;
  updated_at: string | null;
}> {
  if (isDemoMode()) {
    return { configured: false, last4: null, updated_at: null };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('settings')
      .select('value, updated_at')
      .eq('key', 'push_webhook_secret')
      .maybeSingle();

    if (error || !data) {
      return { configured: false, last4: null, updated_at: null };
    }

    const value = (data as { value: string }).value ?? '';
    return {
      configured: value.length > 0,
      last4: value.length >= 4 ? value.slice(-4) : null,
      updated_at: (data as { updated_at: string | null }).updated_at ?? null,
    };
  } catch (err) {
    logger.warn('[push/events] Failed to load webhook secret preview', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { configured: false, last4: null, updated_at: null };
  }
}

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const [result, webhookSecretPreview] = await Promise.all([
    pushService.getEventLog(),
    getWebhookSecretPreview(),
  ]);

  return apiSuccess({
    events: result.events,
    webhook_secret_preview: webhookSecretPreview,
  });
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody<{ id: string; status: string }>(request);
  if (parseError) return parseError;

  const result = await pushService.updateEventStatus(body!);
  return apiSuccess({ event: result.event });
});
