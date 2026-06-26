import type { AutoReplyRule } from '@/lib/types';

// Demo 自动回复规则
export const DEMO_AUTO_REPLY_RULES: AutoReplyRule[] = [
  {
    id: 'demo-1',
    keyword: '退货',
    match_mode: 'fuzzy',
    reply_content: '您好，关于退货问题，请联系客服提供订单号，我们会尽快为您处理。',
    is_enabled: true,
    priority: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'demo-2',
    keyword: '物流',
    match_mode: 'fuzzy',
    reply_content: '您的订单正在配送中，预计2-3天送达。请保持手机畅通以便接收快递通知。',
    is_enabled: true,
    priority: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'demo-3',
    keyword: '优惠',
    match_mode: 'fuzzy',
    reply_content: '当前有新人专享优惠，关注店铺可领取专属优惠券！',
    is_enabled: true,
    priority: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
