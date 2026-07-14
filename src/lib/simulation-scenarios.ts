/**
 * Shared simulation scenario definitions for SmartAssist.
 * This module centralizes scenario configurations used across
 * frontend (simulation-page.tsx) and backend (messages/route.ts)
 */

// Test scenario metadata
export interface TestScenario {
  id: string;
  name: string;
  description: string;
  icon: string;
  preloaded: boolean;
}

export const TEST_SCENARIOS: TestScenario[] = [
  { id: 'order_inquiry', name: '订单查询', description: '测试用户咨询订单状态、发货时间、物流进度等', icon: '📦', preloaded: false },
  { id: 'refund_request', name: '退款申请', description: '测试用户申请退款、退货的流程', icon: '💰', preloaded: false },
  { id: 'product_question', name: '产品咨询', description: '测试用户咨询产品规格、使用方法、注意事项', icon: '❓', preloaded: false },
  { id: 'complaint', name: '投诉处理', description: '测试用户投诉场景，包括情绪安抚和解决', icon: '😤', preloaded: false },
  { id: 'multi_turn', name: '多轮对话', description: '测试复杂多轮对话场景，包括上下文理解', icon: '🔄', preloaded: false },
  { id: 'logistics_query', name: '物流查询', description: '测试物流轨迹、快递公司、签收状态等查询', icon: '🚚', preloaded: false },
  { id: 'address_modify', name: '修改地址', description: '测试修改收货地址、联系人信息等', icon: '📍', preloaded: false },
  { id: 'invoice_request', name: '发票申请', description: '测试电子发票、纸质发票申请流程', icon: '🧾', preloaded: false },
  { id: 'partial_refund', name: '部分退款', description: '测试部分退款金额计算和申请', icon: '💵', preloaded: false },
  { id: 'exchange_goods', name: '换货处理', description: '测试换货申请与处理流程', icon: '🔄', preloaded: false },
  { id: 'size_recommend', name: '尺码推荐', description: '根据身高体重推荐尺码', icon: '📏', preloaded: false },
  { id: 'product_compare', name: '商品对比', description: '多个商品规格对比分析', icon: '⚖️', preloaded: false },
  { id: 'escalation', name: '投诉升级', description: '投诉升级与处理进度查询', icon: '📢', preloaded: false },
  { id: 'combined', name: '综合场景', description: '先咨询后下单的多步骤复杂场景', icon: '🎯', preloaded: false },
  { id: 'custom', name: '自定义', description: '创建自定义测试脚本', icon: '✏️', preloaded: false },
];

// Preloaded test scripts indexed by scenario ID
export const PRELOADED_SCRIPTS: Record<string, string[]> = {
  order_inquiry: [
    '你好，我想查一下我的订单',
    '订单号是 ORD-2024001',
    '什么时候能发货？',
    '谢谢',
  ],
  refund_request: [
    '我申请了退款，请问什么时候能到账？',
    '已经3天了还没收到',
    '我的银行卡账号是...',
  ],
  product_question: [
    '这个产品怎么使用？',
    '有使用说明书吗？',
    '保修期是多久？',
  ],
  complaint: [
    '我要投诉！上次买的产品有问题',
    '等了5天了还没发货',
    '你们的服务太差了',
  ],
  multi_turn: [
    '你好，我想买一件衣服',
    '有没有黑色的XL码？',
    '有现货吗？',
    '好的，帮我下单',
  ],
  logistics_query: [
    '你好，帮我查一下快递',
    '快递单号是 SF1234567890',
    '现在到哪了？预计什么时候能到？',
  ],
  address_modify: [
    '我想修改一下收货地址',
    '新地址是上海市浦东新区XX路XX号，收件人张三，电话13800138000',
    '好的，谢谢',
  ],
  invoice_request: [
    '请问可以开发票吗？',
    '要电子发票，发票抬头是XX公司',
    '税号是91110000XXXXXXXX',
  ],
  partial_refund: [
    '我收到的东西少了，只收到2件，应该有3件',
    '请问我能退多少钱？',
    '什么时候能收到退款？',
  ],
  exchange_goods: [
    '我买的衣服尺码大了，想换小一号',
    '是蓝色的XL码，想换成L码',
    '换货需要多久？运费谁承担？',
  ],
  size_recommend: [
    '我想买一条裤子',
    '我身高175cm，体重70kg',
    '请问应该选什么尺码？',
  ],
  product_compare: [
    '帮我对比一下A款和B款有什么区别？',
    'A款和B款哪个质量更好？',
    '综合来看，哪个性价比更高？',
  ],
  escalation: [
    '我要投诉，已经反馈好几次了都没解决',
    '工号是多少？我要投诉工号001的客服',
    '你们经理电话是多少？',
  ],
  combined: [
    '你好，我想买一双运动鞋',
    '有没有适合跑步的款式推荐？',
    '这款有黑色42码吗？',
    '有现货，下单后多久能发货？',
    '好的，帮我下单',
  ],
};

// Helper to get scenario by ID
export function getScenarioById(id: string): TestScenario | undefined {
  return TEST_SCENARIOS.find(s => s.id === id);
}

// Helper to get scripts for a scenario
export function getScriptsForScenario(id: string): string[] {
  return PRELOADED_SCRIPTS[id] || [];
}

// Helper to check if a scenario has preloaded scripts
export function hasPreloadedScripts(id: string): boolean {
  return id in PRELOADED_SCRIPTS && PRELOADED_SCRIPTS[id].length > 0;
}
