/**
 * Shared type definitions for SmartAssist
 */

export interface Conversation {
  id: string;
  title: string;
  status: string;
  rating: number | null;
  rating_comment?: string | null;
  message_count: number;
  source?: string;
  priority?: 'urgent' | 'normal';
  unread_count?: number;
  last_message?: string;
  last_message_image?: string | null;
  platform_connection_id?: string | null;
  external_user_id?: string | null; // 平台用户ID或Web端visitor_id，用于识别回头客
  customer?: Customer | null; // 关联客户信息（对话详情时返回）
  summary?: string | null;
  handoff_reason?: string | null;
  is_collaborative?: boolean;
  participant_ids?: string[];
  metadata?: Record<string, unknown>; // 扩展元数据（如 gorgias_ticket_id, gorgias_tags 等）
  created_at: string;
  updated_at: string;
}

export interface RichContent {
  type: 'order' | 'logistics' | 'action_buttons' | 'knowledge_images';
  data: Record<string, unknown>;
  images?: Array<{ url: string; alt: string }>;
}

/**
 * Card action types for rich message interactions
 */
export type CardActionType =
  | 'view_order_detail'
  | 'apply_refund'
  | 'view_logistics'
  | 'confirm_refund'
  | 'cancel_refund'
  | 'contact_support';

/**
 * Card action payload structure
 */
export interface CardAction {
  type: CardActionType;
  label: string;
  data?: Record<string, unknown>;
}

/**
 * Props for rich message card with action support
 */
export interface RichMessageCardWithActionsProps {
  type: string;
  content: RichContent;
  onAction?: (action: CardAction) => void;
}

export interface ConfidenceBreakdown {
  knowledge_score: number;    // Knowledge base vector similarity contribution
  tool_score: number;         // Tool execution confidence contribution
  llm_self_score: number;     // LLM self-evaluated confidence contribution
  sub_agent_score: number;    // Sub-agent delegation confidence contribution
  handoff_intent: boolean;    // Whether handoff intent was detected
  no_support: boolean;        // Whether no grounding source exists (pure LLM)
  final: number;              // Final weighted confidence
}

export interface Message {
  id: string;
  conversation_id?: string;
  role: 'user' | 'assistant' | 'system' | 'internal_note' | 'agent';
  content: string;
  image_url?: string | null;
  sources: Array<{ type: string; content?: string; score?: number; keyword?: string; knowledge_item_id?: string; name?: string; category?: string }> | null;
  confidence?: number | null;
  confidence_breakdown?: ConfidenceBreakdown | null;
  tool_calls?: unknown[] | null;
  tool_results?: unknown[] | null;
  message_type?: 'text' | 'image' | 'card' | 'order' | 'logistics' | 'action_buttons' | 'internal_note' | 'knowledge_images';
  rich_content?: RichContent | null;
  mentions?: string[];
  metadata?: Record<string, unknown>; // 扩展元数据（如 gorgias_message_id, gorgias_author 等）
  delegations?: Array<{
    child_bot_name: string;
    child_bot_id: string;
    intent: string | null;
    confidence: number;
    collaborations: number;
  }>;
  created_at: string;
}

export interface AutoReplyRule {
  id: string;
  keyword: string;
  match_mode: 'exact' | 'fuzzy';
  reply_content: string;
  is_enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string | null;
}

export interface Alert {
  id: string;
  conversation_id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  is_resolved: boolean;
  created_at: string;
  resolved_at?: string | null;
}

export interface PushTemplate {
  id: string;
  name: string;
  trigger_event: string;
  content_template: string;
  channels: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface PushRecord {
  id: string;
  template_id?: string | null;
  recipient_id: string;
  content: string;
  trigger_event: string;
  channel: string;
  status: 'pending' | 'sent' | 'failed';
  error_message?: string | null;
  // 兼容旧字段
  created_at?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  // 兼容旧字段
  recipient?: string;
}

export interface PushEventLog {
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  status: 'received' | 'processed' | 'failed';
  error_message?: string | null;
  created_at: string;
}

export type TriggerEventType = 'order_shipped' | 'order_delivered' | 'refund_completed' | 'refund_rejected' | 'logistics_delayed';

export const TRIGGER_EVENT_LABELS: Record<TriggerEventType, string> = {
  order_shipped: '订单已发货',
  order_delivered: '订单已签收',
  refund_completed: '退款已到账',
  refund_rejected: '退款已拒绝',
  logistics_delayed: '物流延迟',
};

// ====== Phase 1: RBAC + 客户画像 ======

export type UserRole = 'admin' | 'agent' | 'observer';
export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  role: UserRole;
  status: UserStatus;
  last_active_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export type PermissionResource = 'conversations' | 'knowledge' | 'settings' | 'team' | 'customers' | 'analytics';
export type PermissionAction = 'read' | 'write' | 'delete';

export interface RolePermission {
  id: string;
  role: UserRole;
  resource: PermissionResource;
  action: PermissionAction;
  allowed: boolean;
}

export const PERMISSION_RESOURCES: Record<PermissionResource, string> = {
  conversations: '对话管理',
  knowledge: '知识库',
  settings: '设置',
  team: '团队管理',
  customers: '客户管理',
  analytics: '数据分析',
};

export const PERMISSION_ACTIONS: Record<PermissionAction, string> = {
  read: '查看',
  write: '编辑',
  delete: '删除',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理员',
  agent: '坐席',
  observer: '观察者',
};

export type CustomerSource = 'web' | 'qianniu' | 'doudian';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  source_platform: CustomerSource;
  external_id: string | null;
  platform_connection_id: string | null; // 平台客户关联的店铺/连接 ID
  is_anonymous: boolean; // Web 匿名访客自动创建的客户标记，坐席补充信息后改为 false
  tags: string[]; // tag IDs
  metadata: Record<string, unknown> | null;
  notes: string | null;
  conversation_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string | null;
}

export interface CustomerTag {
  id: string;
  name: string;
  color: string;
  category: 'auto' | 'manual';
  is_system: boolean;
  customer_count: number;
  created_at: string;
  updated_at: string | null;
}

export const SOURCE_PLATFORM_LABELS: Record<CustomerSource, string> = {
  web: 'Web',
  qianniu: '千牛',
  doudian: '抖店',
};

// ====== Phase 2: 坐席工作台 ======

export type AgentStatus = 'online' | 'away' | 'offline';
export type QueueItemStatus = 'queued' | 'assigned' | 'resolved';
export type QueuePriority = 'urgent' | 'normal';
export type ShiftType = 'morning' | 'afternoon' | 'evening';
export type ScheduleStatus = 'scheduled' | 'active' | 'completed';

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  online: '在线',
  away: '暂离',
  offline: '离线',
};

export const AGENT_STATUS_COLORS: Record<AgentStatus, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-500',
  offline: 'bg-muted-foreground/40',
};

export const PRIORITY_LABELS: Record<QueuePriority, string> = {
  urgent: '紧急',
  normal: '普通',
};

export const SHIFT_LABELS: Record<ShiftType, string> = {
  morning: '早班',
  afternoon: '午班',
  evening: '晚班',
};

export interface AgentSession {
  id: string;
  user_id: string;
  status: AgentStatus;
  current_conversation_id: string | null;
  last_active_at: string;
  created_at: string;
  updated_at: string | null;
  // joined
  user_name?: string;
  user_email?: string;
  user_avatar?: string | null;
}

export interface AgentQueueItem {
  id: string;
  conversation_id: string;
  customer_name: string | null;
  customer_avatar: string | null;
  priority: QueuePriority;
  skill_group_id: string | null;
  assigned_agent_id: string | null;
  status: QueueItemStatus;
  reason: string | null;
  summary: string | null;
  source_platform: string | null;
  created_at: string;
  assigned_at: string | null;
  resolved_at: string | null;
  // joined
  agent_name?: string | null;
}

export interface SkillGroup {
  id: string;
  name: string;
  description: string | null;
  member_ids: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string | null;
  // joined
  member_count?: number;
}

export interface Schedule {
  id: string;
  user_id: string;
  skill_group_id: string;
  date: string;
  shift: ShiftType;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string | null;
  // joined
  user_name?: string;
  group_name?: string;
}

export interface AgentPerformance {
  total_resolved: number;
  avg_response_time_seconds: number;
  avg_duration_seconds: number;
  satisfaction_avg: number;
  active_conversations: number;
  queued_count: number;
}

// ========== Phase 3: 效率工具 ==========

export type QuickReplyScope = 'personal' | 'team' | 'global';

export interface QuickReply {
  id: string;
  title: string;
  content: string;
  category: string;
  variables: string[];
  scope: QuickReplyScope;
  creator_id: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string | null;
}

export type ConversationTagCategory = 'question_type' | 'sentiment' | 'business_line';

export interface ConversationTagDef {
  id: string;
  name: string;
  color: string;
  category: ConversationTagCategory;
  conversation_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface ConversationTagRecord {
  id: string;
  conversation_id: string;
  tag_id: string;
  tagged_by: string | null;
  created_at: string;
  // joined
  tag_name?: string;
  tag_color?: string;
}

export type QualityRuleType = 'first_response_timeout' | 'keyword_violation' | 'satisfaction_below' | 'high_turn_count' | 'negative_sentiment';

export interface QualityRule {
  id: string;
  name: string;
  type: QualityRuleType;
  config: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface QualityCheck {
  id: string;
  conversation_id: string;
  rule_id: string;
  result: 'pass' | 'fail';
  detail: string | null;
  created_at: string;
  // joined
  rule_name?: string;
  rule_type?: QualityRuleType;
}

export const CONVERSATION_TAG_CATEGORY_LABELS: Record<ConversationTagCategory, string> = {
  question_type: '问题类型',
  sentiment: '情绪',
  business_line: '业务线',
};

export const CONVERSATION_TAG_CATEGORY_COLORS: Record<ConversationTagCategory, string> = {
  question_type: 'text-primary',
  sentiment: 'text-orange-500',
  business_line: 'text-violet-500',
};

export const QUALITY_RULE_TYPE_LABELS: Record<QualityRuleType, string> = {
  first_response_timeout: '首响超时',
  keyword_violation: '关键词违规',
  satisfaction_below: '满意度低于阈值',
  high_turn_count: '高轮次告警',
  negative_sentiment: '负面情绪检测',
};

// ===== Phase 4: Bot Config & Routing =====

export interface BotConfig {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  tools: string[];
  knowledge_ids: string[];
  skill_group_id: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string | null;
}

export type RoutingConditionType = 'keyword' | 'intent' | 'tag' | 'customer_type';

export interface RoutingRule {
  id: string;
  name: string;
  condition_type: RoutingConditionType;
  condition_config: Record<string, unknown>;
  target_bot_id: string;
  priority: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string | null;
  // joined
  target_bot_name?: string;
}

export const ROUTING_CONDITION_LABELS: Record<RoutingConditionType, string> = {
  keyword: '关键词匹配',
  intent: '意图识别',
  tag: '标签匹配',
  customer_type: '客户类型',
};

// ===== Phase 4: Marketing =====

export type MarketingCampaignType = 'abandoned_cart' | 'browsing_nurture' | 'win_back';
export type MarketingCampaignStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface MarketingCampaign {
  id: string;
  name: string;
  type: MarketingCampaignType;
  target_segment: Record<string, unknown>;
  bot_id: string | null;
  status: MarketingCampaignStatus;
  ab_variants: {
    enabled: boolean;
    variant_a: string;
    variant_b: string;
  } | null;
  created_at: string;
  updated_at: string | null;
  // computed
  stats?: {
    sent: number;
    replied: number;
    converted: number;
  };
}

export interface MarketingLog {
  id: string;
  campaign_id: string;
  customer_id: string | null;
  conversation_id: string | null;
  variant: string | null;
  sent_at: string;
  opened: boolean;
  replied: boolean;
  converted: boolean;
}

export const CAMPAIGN_TYPE_LABELS: Record<MarketingCampaignType, string> = {
  abandoned_cart: '购物车挽回',
  browsing_nurture: '浏览引导',
  win_back: '流失客户召回',
};

export const CAMPAIGN_STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  draft: '草稿',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
};

// ===== Phase 4: Rich Messages =====

export type MessageType = 'text' | 'image' | 'card' | 'order' | 'logistics' | 'action_buttons';

export interface OrderCardData {
  order_id: string;
  product_name: string;
  product_image?: string;
  amount: number;
  status: string;
  created_at: string;
}

export interface LogisticsCardData {
  order_id: string;
  carrier: string;
  tracking_no: string;
  status: string;
  estimated_delivery: string;
  steps: { time: string; desc: string; active: boolean }[];
}

export interface ActionButtonData {
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface ActionButtonsData {
  title: string;
  description?: string;
  buttons: ActionButtonData[];
}

// ===== Phase 5: 工单管理 =====

export type TicketCategory = 'refund' | 'logistics' | 'product' | 'account' | 'other';
export type TicketPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TicketStatus = 'open' | 'in_progress' | 'pending_customer' | 'resolved' | 'closed';

export interface Ticket {
  id: string;
  ticket_number: string;
  conversation_id: string | null;
  title: string;
  description: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  creator_id: string | null;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  // joined
  assignee_name?: string | null;
  creator_name?: string | null;
  comment_count?: number;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string | null;
  content: string;
  is_internal: boolean;
  created_at: string;
  // joined
  author_name?: string | null;
  author_avatar?: string | null;
}

export interface TicketStatusLog {
  id: string;
  ticket_id: string;
  from_status: TicketStatus | null;
  to_status: TicketStatus;
  operator_id: string | null;
  created_at: string;
  // joined
  operator_name?: string | null;
}

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  refund: '退款',
  logistics: '物流',
  product: '产品',
  account: '账户',
  other: '其他',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  pending_customer: '待客户回复',
  resolved: '已解决',
  closed: '已关闭',
};

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  open: 'bg-warning/15 text-warning',
  in_progress: 'bg-primary/15 text-primary',
  pending_customer: 'bg-purple-500/15 text-purple-600',
  resolved: 'bg-success/15 text-success',
  closed: 'bg-muted text-muted-foreground',
};

export const TICKET_PRIORITY_COLORS: Record<TicketPriority, string> = {
  urgent: 'bg-error/15 text-error',
  high: 'bg-warning/15 text-warning',
  medium: 'bg-primary/15 text-primary',
  low: 'bg-muted text-muted-foreground',
};

export const TICKET_CATEGORY_COLORS: Record<TicketCategory, string> = {
  refund: 'bg-error/15 text-error',
  logistics: 'bg-primary/15 text-primary',
  product: 'bg-success/15 text-success',
  account: 'bg-purple-500/15 text-purple-600',
  other: 'bg-muted text-muted-foreground',
};

// Knowledge Version Management
export interface KnowledgeVersion {
  id: string;
  knowledge_item_id: string;
  version_number: number;
  title: string;
  content: string;
  category?: string | null;
  change_summary?: string | null;
  created_by?: string | null;
  created_at: string;
  creator_name?: string | null;
  chunk_diff?: ChunkDiffEntry[] | null;
  chunk_count?: number | null;
}

export type ChunkDiffType = 'added' | 'removed' | 'modified';

export interface ChunkDiffEntry {
  type: ChunkDiffType;
  chunk_index: number;
  old_hash?: string;
  new_hash?: string;
  preview_old?: string;
  preview_new?: string;
}

// ===== Simulation Testing =====

export interface SimulationConversation {
  id: string;
  title: string;
  scenario_id?: string | null;
  scenario_name: string;
  message_count: number;
  status: 'active' | 'completed';
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimulationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Array<{ type: string; content?: string; score?: number; keyword?: string; knowledge_item_id?: string; name?: string; category?: string }> | null;
  confidence?: number | null;
  confidence_breakdown?: ConfidenceBreakdown | null;
  tool_calls?: unknown | null;
  tool_results?: unknown | null;
  image_url?: string | null;
  message_type?: string;
  rich_content?: unknown | null;
  created_at: string;
}
