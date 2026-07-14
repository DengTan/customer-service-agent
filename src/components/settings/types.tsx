'use client';

import { Truck, Package, CreditCard, XCircle, Clock } from 'lucide-react';

// Re-export factory defaults from the shared module so both server and client
// code can import them without dragging in this 'use client' file.
//
// IMPORTANT: only re-export the client-safe subset (`FACTORY_DEFAULTS` does
// NOT include `system_prompt`). Server code that needs the full defaults
// (including the LLM system prompt) must import from
// `@/lib/server-only-settings-defaults` directly. This keeps the full
// system prompt out of the browser bundle.
// See `src/lib/settings-defaults.ts` and `src/lib/server-only-settings-defaults.ts`.
export { FACTORY_DEFAULTS, DEFAULT_SYSTEM_PROMPT } from '@/lib/settings-defaults';

// Shared interfaces and constants for Settings components

export interface AutoReplyRule {
  id: string;
  keyword: string;
  match_mode: 'exact' | 'fuzzy';
  reply_content: string;
  is_enabled: boolean;
  priority: number;
}

export interface Shop {
  id: string;
  name: string;
  platform: string;
  shop_url: string | null;
  logo_url: string | null;
  total_accounts: number;
  used_accounts: number;
  status: string;
  contact_name: string | null;
  contact_phone: string | null;
  remark: string | null;
  created_at: string;
  config: Record<string, unknown> | null;
  knowledge_ids: string[] | null;
}

export interface ShopStats {
  total: number;
  totalAccounts: number;
  usedAccounts: number;
  availableAccounts: number;
}

export interface SkillGroup {
  id: string;
  name: string;
  description: string | null;
  member_ids: string[];
  is_default: boolean;
  created_at: string;
}

export interface MainBot {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  knowledge_ids: string[];
  is_default: boolean;
  parent_bot_id: string | null;
  is_sub_agent: boolean;
  status: string;
  sub_agent_count?: number;
  created_at: string;
  platform_connection_id?: string;
  skill_group_id?: string | null;
}

/** Subset of system settings used by BotSettings; keys are optional so partial loads don't crash. */
export interface BotSettingsPreference {
  max_main_bots?: string | number;
}

export interface SubAgent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  knowledge_ids: string[];
  parent_bot_id: string;
  delegation_prompt: string | null;
  collaboration_config: Record<string, unknown> | null;
  is_sub_agent: boolean;
  status: string;
  created_at: string;
}

// Push event types
export const PUSH_EVENT_TYPES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  order_shipped: { label: '订单已发货', color: 'bg-primary/10 text-primary', icon: <Truck className="w-3 h-3" /> },
  order_delivered: { label: '订单已签收', color: 'bg-success/10 text-success', icon: <Package className="w-3 h-3" /> },
  refund_completed: { label: '退款已到账', color: 'bg-emerald-200 text-emerald-700', icon: <CreditCard className="w-3 h-3" /> },
  refund_rejected: { label: '退款已拒绝', color: 'bg-destructive/10 text-destructive', icon: <XCircle className="w-3 h-3" /> },
  logistics_delayed: { label: '物流延迟', color: 'bg-amber-500/10 text-amber-600', icon: <Clock className="w-3 h-3" /> },
};

export const CHANNEL_MAP: Record<string, { label: string; icon: string }> = {
  web: { label: 'Web', icon: '🌐' },
  doudian: { label: '抖店', icon: '🛒' },
  sms: { label: '短信', icon: '📱' },
};

export const AI_MODELS = [
  { value: 'doubao-seed-2-0-lite-260215', label: 'Doubao Seed 2.0 Lite', desc: '轻量快速，适合日常对话' },
  { value: 'doubao-seed-1-6-250615', label: 'Doubao Seed 1.6', desc: '均衡性能，适合复杂问答' },
  { value: 'deepseek-v3-250324', label: 'DeepSeek V3', desc: '深度推理，适合专业场景' },
];

export const MULTIMODAL_MODELS = [
  { value: 'doubao-seed-2-0-pro-260215', label: 'Doubao Seed 2.0 Pro', desc: '多模态旗舰，支持图片理解' },
];

export const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: '💻' },
  { value: 'light', label: '浅色模式', icon: '☀️' },
  { value: 'dark', label: '深色模式', icon: '🌙' },
];

export interface Tool {
  value: string;
  label: string;
  description: string;
  builtin?: boolean;
}

export const AVAILABLE_TOOLS: Tool[] = [
  { value: 'order_query', label: '查询订单', description: '根据订单号或客户信息查询订单状态、金额、物流等详细信息', builtin: true },
  { value: 'logistics_query', label: '查询物流', description: '追踪快递物流进度，展示包裹运输轨迹和时间节点', builtin: true },
  { value: 'refund_action', label: '退款操作', description: '处理退款申请，确认退款金额和退款方式', builtin: true },
  { value: 'product_query', label: '商品查询', description: '查询商品详情、价格、规格参数、库存状态等', builtin: true },
  { value: 'size_recommend', label: '尺码推荐', description: '根据用户身高体重推荐合适的尺码', builtin: true },
];

export function getToolDescription(toolValue: string): string {
  const tool = AVAILABLE_TOOLS.find((t) => t.value === toolValue);
  return tool?.description || '暂无描述';
}
