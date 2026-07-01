import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { apiError, apiSuccess, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { validateSignature } from '@/lib/crypto';
import { logger } from '@/lib/logger';

/**
 * Escape special regex characters to prevent regex injection.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POST - Receive webhook events from external platforms
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const client = getSupabaseClient();

  const body = await request.text();
  const signature = request.headers.get('x-webhook-signature') || '';

  // Get webhook secret from settings
  const { data: secretSetting } = await client
    .from('settings')
    .select('value')
    .eq('key', 'push_webhook_secret')
    .maybeSingle();

  const webhookSecret = (secretSetting as { value: string } | null)?.value;

  // 如果未配置 secret，以失败安全方式拒绝请求，不允许跳过签名验证
  if (!webhookSecret || webhookSecret === 'default-secret') {
    return apiError("Webhook secret 未配置，无法处理请求", { status: 500, code: "SECRET_NOT_CONFIGURED" });
  }

  // Validate signature
  if (!signature) {
    return apiError("Missing signature", { status: 401, code: "MISSING_SIGNATURE" });
  }
  if (!validateSignature(body, signature, webhookSecret)) {
    return apiError("Invalid signature", { status: 401, code: "INVALID_SIGNATURE" });
  }

  const event = JSON.parse(body);
  const eventType = event.event_type || event.type;
  const eventData = event.data || event;

  if (!eventType) {
    return apiError('缺少事件类型', {
      status: HttpStatus.BAD_REQUEST,
    });
  }

  // Log the event
  const { data: logEntry, error: logError } = await client
    .from('push_event_log')
    .insert({
      event_type: eventType,
      event_data: eventData,
      status: 'received',
    })
    .select()
    .single();

  if (logError) {
    logger.api.error('Failed to log webhook event', { error: logError, eventType });
  }

  // Find matching enabled templates
  const { data: templates } = await client
    .from('push_templates')
    .select('*')
    .eq('trigger_event', eventType)
    .eq('is_enabled', true);

  if (!templates || templates.length === 0) {
    // Update event log as processed (no matching templates)
    if (logEntry) {
      await client
        .from('push_event_log')
        .update({ status: 'processed', error_message: '无匹配的推送模板' })
        .eq('id', (logEntry as { id: string }).id);
    }
    return apiSuccess({ message: '事件已接收，无匹配模板' });
  }

  // Process each matching template
  const recipient = eventData.user_id || eventData.customer_id || eventData.buyer_id || 'unknown';
  const orderId = eventData.order_id || eventData.refund_id || '';

  for (const template of templates) {
    // Replace template variables with event data
    let content = (template as { content_template: string }).content_template;
    for (const [key, value] of Object.entries(eventData)) {
      // Escape regex special characters to prevent regex injection
      const escapedKey = escapeRegExp(key);
      content = content.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), String(value));
    }
    // Also replace common variables
    content = content.replace(/\{order_id\}/g, orderId);

    // Create push records for each channel
    const channels = (template as { channels: string[] }).channels || ['web'];
    for (const channel of channels) {
      const { error: insertError } = await client
        .from('push_records')
        .insert({
          template_id: (template as { id: string }).id,
          recipient,
          content,
          trigger_event: eventType,
          channel,
          status: 'sent', // In production, this would be 'pending' and updated after actual delivery
        });

      if (insertError) {
        logger.api.error('Failed to create push record', { error: insertError, eventType, templateId: (template as { id: string }).id });
      }
    }
  }

  // Update event log as processed
  if (logEntry) {
    await client
      .from('push_event_log')
      .update({ status: 'processed' })
      .eq('id', (logEntry as { id: string }).id);
  }

  return apiSuccess({ message: '事件处理完成', templates_matched: templates.length });
});
