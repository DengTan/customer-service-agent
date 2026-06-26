/**
 * Gorgias Settings API Routes
 * GET /api/gorgias/settings - 获取Gorgias配置
 * PUT /api/gorgias/settings - 更新Gorgias配置
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { requireRole } from '@/lib/api-utils';
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

/**
 * GET /api/gorgias/settings
 * 获取 Gorgias 配置（不返回 API Key 明文）
 */
export async function GET(request: NextRequest) {
  try {
    // Only admin can view settings
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    if (isDemoMode()) {
      return NextResponse.json({
        enabled: false,
        domain: '',
        email: '',
        apiKey: '',
        webhookEnabled: false,
        webhookUrl: null,
        webhookSecret: null,
        message: 'Demo mode - no real configuration',
      });
    }

    const supabase = getSupabaseClient();
    const { data: settings, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['gorgias_enabled', 'gorgias_domain', 'gorgias_email', 'gorgias_api_key', 'gorgias_webhook_enabled', 'gorgias_public_url']);

    if (error) {
      logger.error('Failed to fetch Gorgias settings', { error: error.message });
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    const settingsMap = new Map(settings?.map(s => [s.key, s.value]) || []);

    // 获取 Webhook 相关状态
    const webhookStatus = await gorgiasService.getWebhookStatus();
    const webhookSecret = await gorgiasService.getWebhookSecret();
    
    // 生成 Webhook URL（如果有配置）- 必须包含 ticket_id 模板变量让 Gorgias 替换
    let webhookUrl: string | null = null;
    const publicUrl = settingsMap.get('gorgias_public_url');
    if (publicUrl && settingsMap.get('gorgias_enabled') === 'true') {
      // Gorgias 会在发送时将 {{ticket.id}} 替换为实际工单 ID
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

    return NextResponse.json(result);
  } catch (err) {
    logger.error('Gorgias settings GET error', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/gorgias/settings
 * 更新 Gorgias 配置
 * Body: { enabled?, domain?, email?, apiKey?, webhookEnabled?, publicUrl? }
 */
export async function PUT(request: NextRequest) {
  try {
    // Only admin can update settings
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json() as GorgiasSettingsInput;

    if (isDemoMode()) {
      logger.info('Demo mode - Gorgias settings update skipped', { body });
      return NextResponse.json({ success: true, message: 'Demo mode - settings not persisted' });
    }

    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    // Build settings map
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
    // Only update API key if provided and not masked
    if (body.apiKey !== undefined && body.apiKey !== '********' && body.apiKey !== '') {
      settingsToUpsert.push({ key: 'gorgias_api_key', value: body.apiKey });
    }
    if (body.webhookEnabled !== undefined) {
      settingsToUpsert.push({ key: 'gorgias_webhook_enabled', value: body.webhookEnabled ? 'true' : 'false' });
    }
    if (body.publicUrl !== undefined) {
      settingsToUpsert.push({ key: 'gorgias_public_url', value: body.publicUrl.trim() });
    }
    // Allow setting custom webhook secret
    if (body.webhookSecret !== undefined && body.webhookSecret !== '') {
      settingsToUpsert.push({ key: 'gorgias_webhook_secret', value: body.webhookSecret });
    }

    if (settingsToUpsert.length === 0) {
      return NextResponse.json({ error: 'No settings to update' }, { status: 400 });
    }

    // Upsert each setting
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
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 }
      );
    }

    logger.info('Gorgias settings updated', { keys: settingsToUpsert.map(s => s.key) });

    // 重置 Gorgias 客户端（设置变更后旧客户端可能失效）
    gorgiasRepository.resetClient();

    // 处理 Webhook 注册/注销
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

    return NextResponse.json(response);
  } catch (err) {
    logger.error('Gorgias settings PUT error', { error: err instanceof Error ? err.message : 'Unknown' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * 处理 Webhook 注册/注销
 * 返回操作结果，不再静默吞掉错误
 */
async function handleWebhookRegistration(body: GorgiasSettingsInput): Promise<{ success: boolean; error?: string; integrationId?: number }> {
  try {
    if (body.webhookEnabled === false) {
      // 禁用 Webhook
      const result = await gorgiasService.deleteWebhook();
      if (!result.success) {
        logger.error('Failed to disable Gorgias webhook', { error: result.error });
        return { success: false, error: result.error || 'Failed to disable webhook' };
      }
      logger.info('Gorgias webhook disabled');
      return { success: true };
    }

    // 获取 publicUrl
    const publicUrl = body.publicUrl || process.env.SMARTASSIST_PUBLIC_URL;
    
    if (!publicUrl) {
      logger.warn('Cannot register webhook: no public URL configured');
      return { success: false, error: 'No public URL configured' };
    }

    // 获取 webhook secret
    const secret = await gorgiasService.getWebhookSecret();
    
    // 注册 Webhook - 必须包含 ticket_id 模板变量让 Gorgias 替换为实际工单 ID
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
