// Demo 质检规则（类型由 TypeScript 从对象字面量自动推导）
import type { QualityRule } from '@/lib/types';

export const DEMO_QUALITY_RULES: QualityRule[] = [
  {
    id: 'demo-rule-1',
    name: '首次响应超时',
    type: 'first_response_timeout',
    config: { threshold_seconds: 60 },
    is_enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'demo-rule-2',
    name: '负面情绪检测',
    type: 'negative_sentiment',
    config: { negative_keywords: ['差', '烂', '投诉', '退货'] },
    is_enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'demo-rule-3',
    name: '满意度偏低',
    type: 'satisfaction_below',
    config: { threshold: 3 },
    is_enabled: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
