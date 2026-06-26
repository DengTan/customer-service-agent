import type { Alert } from '@/lib/types';

// Demo 告警数据
export const DEMO_ALERTS: Alert[] = [
  {
    id: 'demo-alert-1',
    conversation_id: 'demo-conv-1',
    type: 'low_confidence',
    severity: 'warning',
    message: 'AI 置信度低于阈值 (0.35 < 0.4)',
    is_resolved: false,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-alert-2',
    conversation_id: 'demo-conv-2',
    type: 'negative_sentiment',
    severity: 'critical',
    message: '检测到客户负面情绪',
    is_resolved: false,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
];
