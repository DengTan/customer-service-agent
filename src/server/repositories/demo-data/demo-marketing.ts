// Demo 营销活动数据（类型由 TypeScript 从对象字面量自动推导）
export const DEMO_CAMPAIGNS = [
  {
    id: 'demo-campaign-1',
    name: '618 大促预热',
    type: 'promotion',
    target_segment: { age: '25-40', interest: 'shopping' },
    bot_id: 'demo-bot-1',
    status: 'active',
    ab_variants: { control: '原价优惠', variant_a: '满减活动' },
    created_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 'demo-campaign-2',
    name: '新品上市通知',
    type: 'announcement',
    target_segment: { interest: 'new_products' },
    bot_id: 'demo-bot-1',
    status: 'draft',
    ab_variants: null,
    created_at: '2026-06-05T00:00:00Z',
  },
  {
    id: 'demo-campaign-3',
    name: '会员积分兑换',
    type: 'loyalty',
    target_segment: { member_level: 'gold' },
    bot_id: 'demo-bot-2',
    status: 'completed',
    ab_variants: null,
    created_at: '2026-05-20T00:00:00Z',
  },
];
