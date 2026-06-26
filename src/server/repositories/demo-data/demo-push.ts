// Demo 推送模板（类型由 TypeScript 从对象字面量自动推导）
import type { PushEventLog } from '@/lib/types';

export const DEMO_PUSH_TEMPLATES = [
  {
    id: 'demo-template-1',
    name: '订单发货通知',
    trigger_event: 'order_shipped',
    content_template: '亲爱的用户，您的订单 {{order_id}} 已发货，快递单号：{{tracking_number}}，预计 {{delivery_days}} 天送达。',
    channels: ['web', 'qianniu'],
    is_enabled: true,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-template-2',
    name: '退款到账通知',
    trigger_event: 'refund_completed',
    content_template: '您的退款申请已处理完成，金额 ¥{{amount}} 已退回至原支付账户，预计 1-3 个工作日到账。',
    channels: ['web', 'qianniu'],
    is_enabled: true,
    created_at: new Date().toISOString(),
  },
];

// Demo 推送事件日志
export const DEMO_EVENT_LOGS: PushEventLog[] = [];

// Demo Webhook 密钥
export const DEMO_WEBHOOK_SECRET = 'demo-webhook-secret-' + Math.random().toString(36).substring(7);
