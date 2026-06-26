// 统一导出所有 Demo 数据
// 各 Repository 按需导入对应模块，避免在一个文件中加载全部假数据

export { DEMO_ALERTS } from './demo-alerts';
export { DEMO_METRICS, DEMO_SOURCE_DISTRIBUTION, DEMO_HANDOVER_COUNT } from './demo-analytics';
export { DEMO_AUTO_REPLY_RULES } from './demo-auto-reply';
export { DEMO_MAIN_BOTS, DEMO_SUB_AGENTS } from './demo-bots';
export { DEMO_CAMPAIGNS } from './demo-marketing';
export { DEMO_CONVERSATIONS, DEMO_MESSAGES } from './demo-conversations';
export { DEMO_CUSTOMERS } from './demo-customers';
export { DEMO_DELEGATIONS, DEMO_COLLABORATIONS } from './demo-sub-agents';
export { DEMO_PUSH_TEMPLATES, DEMO_EVENT_LOGS, DEMO_WEBHOOK_SECRET } from './demo-push';
export { DEMO_QUALITY_RULES } from './demo-quality';
export { DEMO_SETTINGS } from './demo-settings';
export { DEMO_ITEMS } from './demo-knowledge';
export { DEMO_QUEUE } from './demo-queue';
