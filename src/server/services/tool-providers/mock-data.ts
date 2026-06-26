/**
 * Mock Data Generator
 * Generates realistic mock data for tool providers in non-production environments
 */

import { OrderInfo, LogisticsInfo } from './types';

// ─── Mock Order Data ────────────────────────────────────────

const MOCK_PRODUCTS = [
  { name: '智能手表 Pro', price: 1299 },
  { name: '无线蓝牙耳机', price: 399 },
  { name: '便携充电宝 20000mAh', price: 159 },
  { name: '机械键盘 RGB背光', price: 599 },
  { name: '无线鼠标 静音款', price: 129 },
  { name: 'Type-C 数据线 3米', price: 49 },
  { name: '笔记本电脑支架', price: 199 },
  { name: '显示器挂灯', price: 299 },
  { name: 'USB-C 扩展坞', price: 459 },
  { name: '移动固态硬盘 1TB', price: 899 },
];

const MOCK_STATUSES: OrderInfo['status'][] = [
  'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'
];

const ORDER_STATUS_MAP: Record<OrderInfo['status'], string> = {
  pending: '待付款',
  paid: '已付款，等待发货',
  shipped: '已发货，运输中',
  delivered: '已签收',
  cancelled: '已取消',
  refunded: '已退款',
};

const PAYMENT_METHODS = ['在线支付-微信', '在线支付-支付宝', '在线支付-银行卡', '货到付款'];

/**
 * Generate a deterministic mock order based on order ID hash
 */
export function generateMockOrder(orderId: string): OrderInfo {
  const hash = hashCode(orderId);
  const product = MOCK_PRODUCTS[Math.abs(hash) % MOCK_PRODUCTS.length];
  const status = MOCK_STATUSES[Math.abs(hash) % MOCK_STATUSES.length];
  const paymentMethod = PAYMENT_METHODS[Math.abs(hash) % PAYMENT_METHODS.length];
  
  // Generate consistent date based on hash
  const baseDate = new Date('2024-12-01');
  const daysOffset = Math.abs(hash) % 30;
  const orderDate = new Date(baseDate.getTime() + daysOffset * 24 * 60 * 60 * 1000);
  
  const quantity = (Math.abs(hash) % 3) + 1;
  const amount = product.price * quantity;

  return {
    order_id: orderId,
    product_name: product.name,
    amount,
    status,
    created_at: orderDate.toISOString(),
    payment_method: paymentMethod,
    items: [{
      name: product.name,
      quantity,
      price: product.price,
    }],
  };
}

/**
 * Get human-readable status text
 */
export function getMockOrderStatusText(status: OrderInfo['status']): string {
  return ORDER_STATUS_MAP[status] || '未知状态';
}

// ─── Mock Logistics Data ────────────────────────────────────

const CARRIERS = [
  { name: '顺丰速运', prefix: 'SF' },
  { name: '中通快递', prefix: 'ZT' },
  { name: '圆通速递', prefix: 'YT' },
  { name: '韵达快递', prefix: 'YD' },
  { name: '京东物流', prefix: 'JD' },
];

const LOGISTICS_STATUS_MAP: Record<LogisticsInfo['status'], string> = {
  pending: '待揽收',
  picked_up: '已揽收',
  in_transit: '运输中',
  out_for_delivery: '派送中',
  delivered: '已签收',
  returned: '已退回',
};

const LOGISTICS_STEPS_PRODUCER: Record<LogisticsInfo['status'], () => LogisticsInfo['steps']> = {
  pending: () => [
    { time: new Date().toISOString(), desc: '等待商家发货', active: true },
  ],
  picked_up: () => [
    { time: new Date().toISOString(), desc: '快件已被顺丰小哥揽收', active: true },
  ],
  in_transit: () => [
    { time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已从【深圳集散中心】发出', active: false },
    { time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已到达【广州转运中心】', active: false },
    { time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已从【广州转运中心】发出', active: true },
    { time: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), desc: '快件已到达【北京朝阳区网点】', location: '北京', active: false },
  ],
  out_for_delivery: () => [
    { time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已从【深圳】发出', active: false },
    { time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已到达【北京】', active: false },
    { time: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), desc: '快件已到达【北京朝阳区网点】，正在安排派送', location: '北京', active: true },
    { time: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), desc: '预计今日送达', active: false },
  ],
  delivered: () => [
    { time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已发出', active: false },
    { time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已到达目的地', active: false },
    { time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件正在派送中', active: false },
    { time: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), desc: '已签收，签收人：本人', active: true },
  ],
  returned: () => [
    { time: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已发出', active: false },
    { time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件派送不成功，收件人要求退回', active: false },
    { time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), desc: '快件已返回【深圳集散中心】', active: true },
  ],
};

/**
 * Generate a deterministic mock logistics based on order ID
 */
export function generateMockLogistics(orderId: string): LogisticsInfo {
  const hash = hashCode(orderId);
  const carrier = CARRIERS[Math.abs(hash) % CARRIERS.length];
  const trackingNo = `${carrier.prefix}${Math.abs(hash * 123456789).toString().slice(0, 10)}`;
  
  // Derive logistics status from order status pattern
  const statusOptions: LogisticsInfo['status'][] = ['in_transit', 'out_for_delivery', 'delivered'];
  const status = statusOptions[Math.abs(hash) % statusOptions.length];
  
  // Generate delivery estimate
  const estimatedDelivery = new Date(Date.now() + (Math.abs(hash) % 3 + 1) * 24 * 60 * 60 * 1000);
  
  return {
    order_id: orderId,
    carrier: carrier.name,
    tracking_no: trackingNo,
    status,
    estimated_delivery: estimatedDelivery.toISOString().split('T')[0],
    steps: LOGISTICS_STEPS_PRODUCER[status](),
  };
}

/**
 * Get human-readable logistics status text
 */
export function getMockLogisticsStatusText(status: LogisticsInfo['status']): string {
  return LOGISTICS_STATUS_MAP[status] || '未知状态';
}

// ─── Hash Function ──────────────────────────────────────────

/**
 * Simple string hash for deterministic mock data generation
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}
