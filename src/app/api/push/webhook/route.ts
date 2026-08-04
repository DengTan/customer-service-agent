import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { apiError, apiSuccess } from '@/lib/api-utils';
import { POST } from '@/lib/api/with-api';
import { validateSignature } from '@/lib/crypto';
import { logger } from '@/lib/logger';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const POSTHandler = POST(
  {
    auth: 'webhook-secret',
  },
  async ({ request }) => {
  const client = getSupabaseClient();

  const body = await request.text();
  const signature = request.headers.get('x-webhook-signature') || '';

  const { data: secretSetting } = await client
    .from('settings')
    .select('value')
    .eq('key', 'push_webhook_secret')
    .maybeSingle();

  const webhookSecret = (secretSetting as { value: string } | null)?.value;

  if (!webhookSecret || webhookSecret === 'default-secret') {
    return apiError("Webhook secret 未配置，无法处理请求", { status: 500, code: "SECRET_NOT_CONFIGURED" });
  }

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
    return apiError('缺少事件类型', { status: 400 });
  }

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

  const { data: templates } = await client
    .from('push_templates')
    .select('*')
    .eq('trigger_event', eventType)
    .eq('is_enabled', true);

  if (!templates || templates.length === 0) {
    if (logEntry) {
      await client
        .from('push_event_log')
        .update({ status: 'processed', error_message: '无匹配的推送模板' })
        .eq('id', (logEntry as { id: string }).id);
    }
    return apiSuccess({ message: '事件已接收，无匹配模板' });
  }

  const recipient = eventData.user_id || eventData.customer_id || eventData.buyer_id || 'unknown';
  const orderId = eventData.order_id || eventData.refund_id || '';

  for (const template of templates) {
    let content = (template as { content_template: string }).content_template;
    for (const [key, value] of Object.entries(eventData)) {
      const escapedKey = escapeRegExp(key);
      content = content.replace(new RegExp(`\\{${escapedKey}\\}`, 'g'), String(value));
    }
    content = content.replace(/\{order_id\}/g, orderId);

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
          status: 'sent',
        });

      if (insertError) {
        logger.api.error('Failed to create push record', { error: insertError, eventType, templateId: (template as { id: string }).id });
      }
    }
  }

  if (logEntry) {
    await client
      .from('push_event_log')
      .update({ status: 'processed' })
      .eq('id', (logEntry as { id: string }).id);
  }

  return apiSuccess({ message: '事件处理完成', templates_matched: templates.length });
}, );

export { POSTHandler as POST };
