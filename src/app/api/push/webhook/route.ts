import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { apiError, apiSuccess, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { validateSignature } from '@/lib/crypto';

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

  const webhookSecret = (secretSetting as { value: string } | null)?.value || 'default-secret';

  // Validate signature — always validate if webhookSecret is configured
  if (webhookSecret && webhookSecret !== 'default-secret') {
    if (!signature) {
      return apiError("Missing signature", { status: 401, code: "MISSING_SIGNATURE" });
    }
    if (!validateSignature(body, signature, webhookSecret)) {
      return apiError("Invalid signature", { status: 401, code: "INVALID_SIGNATURE" });
    }
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
    console.error('记录事件日志失败:', logError);
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
      content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
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
        console.error('创建推送记录失败:', insertError);
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
