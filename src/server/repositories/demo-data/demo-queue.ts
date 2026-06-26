import type { AgentQueueItem } from '../agent-repository';

// Demo 坐席排队数据
export const DEMO_QUEUE: AgentQueueItem[] = [
  {
    id: 'demo-q-1',
    conversation_id: 'demo-conv-1',
    customer_name: '刘思思',
    customer_avatar: null,
    priority: 'high',
    skill_group_id: 'demo-sg-1',
    status: 'waiting',
    reason: 'AI置信度低',
    summary: '退货问题咨询',
    source_platform: 'taobao',
    assigned_agent_id: null,
    assigned_at: null,
    resolved_at: null,
    created_at: '2026-06-10T08:30:00Z',
    agent_name: null,
  },
  {
    id: 'demo-q-2',
    conversation_id: 'demo-conv-2',
    customer_name: '陈大伟',
    customer_avatar: null,
    priority: 'normal',
    skill_group_id: 'demo-sg-1',
    status: 'assigned',
    reason: '客户要求转人工',
    summary: '物流查询',
    source_platform: 'jd',
    assigned_agent_id: 'demo-user-2',
    assigned_at: '2026-06-10T09:00:00Z',
    resolved_at: null,
    created_at: '2026-06-10T09:00:00Z',
    agent_name: '李小红',
  },
];
