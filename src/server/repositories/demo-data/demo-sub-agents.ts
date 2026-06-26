import type { AgentDelegationRow, AgentCollaborationRow } from '../sub-agent-repository';

// Demo 子Agent委派记录
export const DEMO_DELEGATIONS: AgentDelegationRow[] = [
  {
    id: 'demo-del-1',
    conversation_id: 'demo-conv-1',
    parent_bot_id: 'demo-bot-1',
    child_bot_id: 'demo-sub-1',
    trigger_intent: 'order_query',
    input_message: '我的订单到哪了？',
    result_content: '您的订单 ORD-20260610 已发货，预计6月12日送达。当前物流：北京分拣中心 → 上海转运中。',
    confidence: 0.92,
    status: 'completed',
    error_message: null,
    metadata: { tool_used: 'order_query' },
    created_at: '2026-06-10T10:00:00Z',
    completed_at: '2026-06-10T10:00:05Z',
  },
  {
    id: 'demo-del-2',
    conversation_id: 'demo-conv-2',
    parent_bot_id: 'demo-bot-1',
    child_bot_id: 'demo-sub-2',
    trigger_intent: 'refund_request',
    input_message: '我要退款，商品和描述不符',
    result_content: '已为您提交退款申请，退款金额 ¥299.00 将在3-5个工作日内原路返回。退款单号：RF-20260610-001。',
    confidence: 0.88,
    status: 'completed',
    error_message: null,
    metadata: { tool_used: 'refund_action', refund_amount: 299 },
    created_at: '2026-06-10T11:00:00Z',
    completed_at: '2026-06-10T11:00:08Z',
  },
];

// Demo 子Agent协作记录
export const DEMO_COLLABORATIONS: AgentCollaborationRow[] = [
  {
    id: 'demo-collab-1',
    conversation_id: 'demo-conv-2',
    delegation_id: 'demo-del-2',
    sender_bot_id: 'demo-sub-2',
    receiver_bot_id: 'demo-sub-1',
    message_type: 'request',
    content: '客户申请退款，请确认订单 ORD-20260610 的当前状态是否支持退款操作',
    context: { order_id: 'ORD-20260610', refund_amount: 299 },
    status: 'processed',
    created_at: '2026-06-10T11:00:02Z',
  },
  {
    id: 'demo-collab-2',
    conversation_id: 'demo-conv-2',
    delegation_id: 'demo-del-2',
    sender_bot_id: 'demo-sub-1',
    receiver_bot_id: 'demo-sub-2',
    message_type: 'response',
    content: '订单 ORD-20260610 状态为"已签收"，支持退款操作，退款金额上限 ¥299.00',
    context: { order_id: 'ORD-20260610', order_status: 'delivered', max_refund: 299 },
    status: 'processed',
    created_at: '2026-06-10T11:00:04Z',
  },
];
