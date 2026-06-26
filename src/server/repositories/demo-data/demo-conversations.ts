import type { Conversation, Message } from '@/lib/types';

// Demo 对话数据
export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: 'demo-conv-1',
    title: '订单退款咨询',
    status: 'active',
    message_count: 8,
    source: 'web',
    priority: 'normal',
    unread_count: 2,
    rating: null,
    summary: '客户询问订单退款进度，已告知3-5个工作日到账',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'demo-conv-2',
    title: '产品质量投诉',
    status: 'active',
    message_count: 12,
    source: 'qianniu',
    priority: 'urgent',
    unread_count: 1,
    rating: null,
    summary: '客户反映收到的商品有质量问题，要求退货退款',
    created_at: new Date(Date.now() - 7200000).toISOString(),
    updated_at: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: 'demo-conv-3',
    title: '物流配送咨询',
    status: 'ended',
    rating: 5,
    message_count: 5,
    source: 'web',
    priority: 'normal',
    unread_count: 0,
    summary: '客户询问快递配送时间，已提供运单号和预计送达时间',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 43200000).toISOString(),
  },
];

// Demo 消息数据
export const DEMO_MESSAGES: Message[] = [
  {
    id: 'demo-msg-1',
    conversation_id: 'demo-conv-1',
    role: 'user',
    content: '你好，我有一笔订单想申请退款，请问多久能到账？',
    message_type: 'text',
    sources: null,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'demo-msg-2',
    conversation_id: 'demo-conv-1',
    role: 'assistant',
    content: '您好！感谢您的咨询。退款申请审核通过后，款项会在3-5个工作日内退回到您的原支付账户。请问您的订单号是多少？我帮您查询一下具体进度。',
    message_type: 'text',
    sources: null,
    created_at: new Date(Date.now() - 3500000).toISOString(),
  },
];
