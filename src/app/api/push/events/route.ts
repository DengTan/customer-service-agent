import { NextRequest } from 'next/server';
import { PushService } from '@/server/services/push-service';
import { parseJsonBody, apiSuccess } from '@/lib/api-utils';
import { GET, PATCH } from '@/lib/api/with-api';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

const pushService = new PushService();

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

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'read' },
  },
  async () => {
  const [result, webhookSecretPreview] = await Promise.all([
    pushService.getEventLog(),
    getWebhookSecretPreview(),
  ]);

  return apiSuccess({
    events: result.events,
    webhook_secret_preview: webhookSecretPreview,
  });
}, );

export { GETHandler as GET };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'write' },
  },
  async ({ request }) => {
  const { data: body, error: parseError } = await parseJsonBody<{ id: string; status: string }>(request);
  if (parseError) return parseError;

  const result = await pushService.updateEventStatus(body!);
  return apiSuccess({ event: result.event });
}, );

export { PATCHHandler as PATCH };
