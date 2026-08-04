/**
 * Gorgias Settings API Routes
 * GET /api/gorgias/settings - 获取Gorgias配置
 * PUT /api/gorgias/settings - 更新Gorgias配置
 */

import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { withApi } from '@/lib/api/with-api';
import { getLogger } from '@/lib/logger';
import { gorgiasService } from '@/server/services/gorgias-service';
import { gorgiasRepository } from '@/server/repositories/gorgias-repository';

const logger = getLogger('GorgiasSettingsAPI');

interface GorgiasSettings {
  enabled: boolean;
  domain: string;
  email: string;
  apiKey: string;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

interface GorgiasSettingsInput {
  enabled?: boolean;
  domain?: string;
  email?: string;
  apiKey?: string;
  webhookEnabled?: boolean;
  publicUrl?: string;
  webhookSecret?: string;
}

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async () => {
    try {
      if (isDemoMode()) {
        return new Response(JSON.stringify({
          enabled: false,
          domain: '',
          email: '',
          apiKey: '',
          webhookEnabled: false,
          webhookUrl: null,
          webhookSecret: null,
          message: 'Demo mode - no real configuration',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const supabase = getSupabaseClient();
      const { data: settings, error } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['gorgias_enabled', 'gorgias_domain', 'gorgias_email', 'gorgias_api_key', 'gorgias_webhook_enabled', 'gorgias_public_url']);

      if (error) {
        logger.error('Failed to fetch Gorgias settings', { error: error.message });
        return new Response(JSON.stringify({ error: 'Failed to fetch settings' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      const settingsMap = new Map(settings?.map(s => [s.key, s.value]) || []);

      const webhookStatus = await gorgiasService.getWebhookStatus();
      const webhookSecret = await gorgiasService.getWebhookSecret();

      let webhookUrl: string | null = null;
      const publicUrl = settingsMap.get('gorgias_public_url');
      if (publicUrl && settingsMap.get('gorgias_enabled') === 'true') {
        webhookUrl = `${publicUrl}/api/gorgias/webhook?secret=${webhookSecret}&ticket_id={{ticket.id}}`;
      }

      const result: GorgiasSettings = {
        enabled: settingsMap.get('gorgias_enabled') === 'true',
        domain: settingsMap.get('gorgias_domain') || '',
        email: settingsMap.get('gorgias_email') || '',
        apiKey: settingsMap.get('gorgias_api_key') ? '********' : '',
        webhookEnabled: settingsMap.get('gorgias_webhook_enabled') === 'true',
        webhookUrl,
        webhookSecret: webhookSecret ? '********' : null,
      };

      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      logger.error('Gorgias settings GET error', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
);

export const PUT = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json() as GorgiasSettingsInput;

      if (isDemoMode()) {
        logger.info('Demo mode - Gorgias settings update skipped', { body });
        return new Response(JSON.stringify({ success: true, message: 'Demo mode - settings not persisted' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const supabase = getSupabaseClient();
      const now = new Date().toISOString();

      const settingsToUpsert: Array<{ key: string; value: string }> = [];

      if (body.enabled !== undefined) {
        settingsToUpsert.push({ key: 'gorgias_enabled', value: body.enabled ? 'true' : 'false' });
      }
      if (body.domain !== undefined) {
        settingsToUpsert.push({ key: 'gorgias_domain', value: body.domain.trim() });
      }
      if (body.email !== undefined) {
        settingsToUpsert.push({ key: 'gorgias_email', value: body.email.trim() });
      }
      if (body.apiKey !== undefined && body.apiKey !== '********' && body.apiKey !== '') {
        settingsToUpsert.push({ key: 'gorgias_api_key', value: body.apiKey });
      }
      if (body.webhookEnabled !== undefined) {
        settingsToUpsert.push({ key: 'gorgias_webhook_enabled', value: body.webhookEnabled ? 'true' : 'false' });
      }
      if (body.publicUrl !== undefined) {
        settingsToUpsert.push({ key: 'gorgias_public_url', value: body.publicUrl.trim() });
      }
      if (body.webhookSecret !== undefined && body.webhookSecret !== '') {
        settingsToUpsert.push({ key: 'gorgias_webhook_secret', value: body.webhookSecret });
      }

      if (settingsToUpsert.length === 0) {
        return new Response(JSON.stringify({ error: 'No settings to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const results = await Promise.all(
        settingsToUpsert.map(s =>
          supabase
            .from('settings')
            .upsert(
              { key: s.key, value: s.value, updated_at: now },
              { onConflict: 'key' }
            )
        )
      );

      const failedResult = results.find(r => r.error);
      if (failedResult?.error) {
        logger.error('Failed to update Gorgias settings', { error: failedResult.error.message });
        return new Response(JSON.stringify({ error: 'Failed to update settings' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      logger.info('Gorgias settings updated', { keys: settingsToUpsert.map(s => s.key) });

      gorgiasRepository.resetClient();

      let webhookResult: { success?: boolean; error?: string; integrationId?: number } | null = null;
      if (body.webhookEnabled !== undefined || body.publicUrl !== undefined) {
        webhookResult = await handleWebhookRegistration(body);
      }

      const response: {
        success: boolean;
        message: string;
        webhook?: { success?: boolean; error?: string; integrationId?: number };
      } = {
        success: true,
        message: 'Settings updated successfully',
      };

      if (webhookResult) {
        response.webhook = webhookResult;
      }

      return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      logger.error('Gorgias settings PUT error', { error: err instanceof Error ? err.message : 'Unknown' });
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
);

async function handleWebhookRegistration(body: GorgiasSettingsInput): Promise<{ success: boolean; error?: string; integrationId?: number }> {
  try {
    if (body.webhookEnabled === false) {
      const result = await gorgiasService.deleteWebhook();
      if (!result.success) {
        logger.error('Failed to disable Gorgias webhook', { error: result.error });
        return { success: false, error: result.error || 'Failed to disable webhook' };
      }
      logger.info('Gorgias webhook disabled');
      return { success: true };
    }

    const publicUrl = body.publicUrl || process.env.SMARTASSIST_PUBLIC_URL;

    if (!publicUrl) {
      logger.warn('Cannot register webhook: no public URL configured');
      return { success: false, error: 'No public URL configured' };
    }

    const secret = await gorgiasService.getWebhookSecret();

    const webhookUrl = `${publicUrl}/api/gorgias/webhook?secret=${secret}&ticket_id={{ticket.id}}`;
    const result = await gorgiasService.registerWebhook(webhookUrl);

    if (result.success) {
      logger.info('Gorgias webhook registered', { integrationId: result.integrationId });
      return { success: true, integrationId: result.integrationId };
    } else {
      logger.error('Failed to register webhook', { error: result.error });
      return { success: false, error: result.error || 'Unknown registration error' };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Webhook registration error', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}
