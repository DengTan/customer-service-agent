/**
 * Database row type definitions for repositories
 * These types represent the raw data returned from Supabase queries
 * before transformation into domain types.
 */

// ===== Message Row =====

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  sources?: unknown;
  confidence?: number | null;
  confidence_breakdown?: unknown;
  tool_calls?: unknown[] | null;
  tool_results?: unknown[] | null;
  message_type?: string;
  rich_content?: unknown;
  mentions?: string;
  image_url?: string | null;
  created_at: string;
}

// ===== Conversation Row =====

export interface ConversationRow {
  id: string;
  title: string;
  status: string;
  rating?: number | null;
  rating_comment?: string | null;
  message_count: number;
  source?: string;
  priority?: string;
  unread_count?: number;
  platform_connection_id?: string | null;
  external_user_id?: string | null;
  external_session_id?: string | null;
  handoff_reason?: string | null;
  assigned_agent?: string | null;
  summary?: string | null;
  participant_ids?: string[];
  is_collaborative?: boolean;
  created_at: string;
  updated_at?: string | null;
}

// ===== Ticket Row =====

export interface TicketRow {
  id: string;
  ticket_number: string;
  title: string;
  description?: string | null;
  category: string;
  priority: string;
  status: string;
  assignee_id?: string | null;
  creator_id?: string | null;
  conversation_id?: string | null;
  parent_ticket_id?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface TicketWithCounts {
  ticket: TicketRow;
  assignee_name: string | null;
  creator_name: string | null;
  comment_count: number;
}

// ===== Alert Row =====

export interface AlertRow {
  id: string;
  conversation_id?: string | null;
  type: string;
  severity: string;
  message: string;
  is_resolved: boolean;
  created_at: string;
  resolved_at?: string | null;
  metadata?: unknown;
}

export interface RecentAlert {
  id: string;
  conversation_id?: string | null;
  type: string;
  severity: string;
  message: string;
  is_resolved: boolean;
  created_at: string;
  conversations?: { id: string; title: string; status: string } | null;
}

// ===== User Row =====

export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: string;
  status: string;
  password_hash?: string | null;
  last_active_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// User row with password hash (for authentication)
export interface UserWithPassword extends UserRow {
  password_hash: string;
}

// ===== Shop Row =====

export interface ShopRow {
  id: string;
  name: string;
  platform: string;
  shop_url?: string | null;
  logo_url?: string | null;
  total_accounts: number;
  used_accounts: number;
  status: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  remark?: string | null;
  knowledge_ids?: string[]; // 关联的知识库条目ID列表
  config?: Record<string, unknown>; // 业务规则配置JSON
  agent_quota?: number; // 客服账号额度
  created_at: string;
  updated_at?: string | null;
}

// ===== Shop Agent Account Row =====

export interface ShopAgentAccountRow {
  id: string;
  shop_id: string;
  account_name: string;
  encrypted_password: string;
  platform?: string | null;
  status: string;
  created_at: string;
}

// ===== Settings Row =====

export interface SettingRow {
  key: string;
  value: string;
}

// ===== Quick Reply Row =====

export interface QuickReplyRow {
  id: string;
  title: string;
  content: string;
  category: string;
  variables?: unknown;
  scope: string;
  creator_id?: string | null;
  usage_count: number;
  created_at: string;
  updated_at?: string | null;
}

// ===== Conversation Tag Row =====

export interface ConversationTagDefRow {
  id: string;
  name: string;
  color: string;
  category: string;
  conversation_count: number;
  created_at: string;
  updated_at?: string | null;
}

export interface ConversationTagRecordRow {
  id: string;
  conversation_id: string;
  tag_id: string;
  tagged_by?: string | null;
  created_at: string;
}

// ===== Skill Group Row =====

export interface SkillGroupRow {
  id: string;
  name: string;
  description?: string | null;
  member_ids?: unknown;
  is_default: boolean;
  created_at: string;
  updated_at?: string | null;
}

// ===== Schedule Row =====

export interface ScheduleRow {
  id: string;
  user_id: string;
  skill_group_id: string;
  date: string;
  shift: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
}

// ===== Quality Rule Row =====

export interface QualityRuleRow {
  id: string;
  name: string;
  type: string;
  config?: unknown;
  is_enabled: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface QualityCheckRow {
  id: string;
  conversation_id: string;
  rule_id: string;
  result: string;
  detail?: string | null;
  created_at: string;
}

// ===== Knowledge Item Row =====

export interface KnowledgeItemRow {
  id: string;
  name: string;
  type: string;
  content?: string | null;
  doc_ids?: unknown;
  category?: string | null;
  status: string;
  chunk_count?: number | null;
  created_at: string;
  updated_at?: string | null;
}

export interface KnowledgeVersionRow {
  id: string;
  knowledge_item_id: string;
  version: number;
  title: string;
  content: string;
  category?: string | null;
  change_summary?: string | null;
  created_by?: string | null;
  created_at: string;
  creator_name?: string | null;
}

// ===== Bot Config Row =====

export interface BotConfigRow {
  id: string;
  name: string;
  description?: string | null;
  system_prompt: string;
  tools?: unknown;
  knowledge_ids?: unknown;
  skill_group_id?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at?: string | null;
}

// ===== Routing Rule Row =====

export interface RoutingRuleRow {
  id: string;
  name: string;
  condition_type: string;
  condition_config?: unknown;
  target_bot_id: string;
  priority: number;
  is_enabled: boolean;
  created_at: string;
  updated_at?: string | null;
  target_bot_name?: string | null;
}

// ===== Marketing Row =====

export interface MarketingCampaignRow {
  id: string;
  name: string;
  type: string;
  target_segment?: unknown;
  bot_id?: string | null;
  status: string;
  ab_variants?: unknown;
  created_at: string;
  updated_at?: string | null;
}

export interface MarketingLogRow {
  id: string;
  campaign_id: string;
  customer_id?: string | null;
  conversation_id?: string | null;
  variant?: string | null;
  sent_at: string;
  opened: boolean;
  replied: boolean;
  converted: boolean;
}

// ===== Agent Session Row =====

export interface AgentSessionRow {
  id: string;
  user_id: string;
  status: string;
  current_conversation_id?: string | null;
  last_active_at: string;
  created_at: string;
  updated_at?: string | null;
}

// ===== Agent Queue Row =====

export interface AgentQueueRow {
  id: string;
  conversation_id: string;
  customer_name?: string | null;
  priority: string;
  skill_group_id?: string | null;
  assigned_agent_id?: string | null;
  status: string;
  reason?: string | null;
  summary?: string | null;
  source_platform?: string | null;
  created_at: string;
  assigned_at?: string | null;
  resolved_at?: string | null;
}

// ===== Push Template Row =====

export interface PushTemplateRow {
  id: string;
  name: string;
  trigger_event: string;
  content_template: string;
  channels?: unknown;
  is_enabled: boolean;
  created_at: string;
  updated_at?: string | null;
}

// ===== Push Record Row =====

export interface PushRecordRow {
  id: string;
  template_id?: string | null;
  recipient: string;
  content: string;
  trigger_event: string;
  channel: string;
  status: string;
  error_message?: string | null;
  created_at: string;
}

// ===== Ticket Comment Row =====

export interface TicketCommentRow {
  id: string;
  ticket_id: string;
  author_id?: string | null;
  content: string;
  is_internal: boolean;
  created_at: string;
  author?: { id: string; name: string | null; avatar: string | null } | null;
  author_name?: string | null;
  author_avatar?: string | null;
}

// ===== Ticket Status Log Row =====

export interface TicketStatusLogRow {
  id: string;
  ticket_id: string;
  from_status?: string | null;
  to_status: string;
  operator_id?: string | null;
  created_at: string;
  operator?: { id: string; name: string | null } | null;
  operator_name?: string | null;
}

// ===== Customer Row =====

export interface CustomerRow {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  avatar?: string | null;
  source_platform: string;
  external_id?: string | null;
  tags?: unknown;
  metadata?: unknown;
  notes?: string | null;
  conversation_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at?: string | null;
}

// ===== Customer Tag Row =====

export interface CustomerTagRow {
  id: string;
  name: string;
  color: string;
  category: string;
  is_system: boolean;
  customer_count: number;
  created_at: string;
  updated_at?: string | null;
}

// ===== Knowledge Learning Row =====

export interface KnowledgeLearningRow {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  conversation_id?: string | null;
  conversation_title?: string | null;
  source_context?: string | null;
  category?: string | null;
  status: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  knowledge_item_id?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// ===== LLM Provider Row =====

export interface LlmProviderRow {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  api_type: string;
  base_url: string;
  api_key?: string | null;
  models: unknown[];
  default_model?: string | null;
  supports_vision: boolean;
  supports_streaming: boolean;
  max_context_tokens?: number | null;
  auth_config?: unknown | null;
  request_config?: unknown | null;
  is_enabled: boolean;
  is_default: boolean;
  priority: number;
  created_at: string;
  updated_at?: string | null;
}

export interface LlmModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  description?: string | null;
  type: string;
  max_tokens?: number | null;
  supports_vision: boolean;
  supports_streaming: boolean;
  supports_function_calling: boolean;
  default_temperature: number;
  default_max_tokens?: number | null;
  use_case: string;
  cost_per_1k_input?: number | null;
  cost_per_1k_output?: number | null;
  is_enabled: boolean;
  created_at: string;
  updated_at?: string | null;
}

// ===== Helper Functions =====

export function toMessageRow(raw: unknown): MessageRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid message row');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.conversation_id !== 'string') {
    throw new Error('Missing required fields in message row');
  }
  return obj as unknown as MessageRow;
}

export function toConversationRow(raw: unknown): ConversationRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid conversation row');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.title !== 'string') {
    throw new Error('Missing required fields in conversation row');
  }
  return obj as unknown as ConversationRow;
}

export function toTicketRow(raw: unknown): TicketRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid ticket row');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.ticket_number !== 'string') {
    throw new Error('Missing required fields in ticket row');
  }
  return obj as unknown as TicketRow;
}

export function toTicketWithCounts(raw: unknown, commentCount: number, assigneeName: string | null, creatorName: string | null): TicketWithCounts {
  const ticket = toTicketRow(raw);
  return {
    ticket,
    assignee_name: assigneeName,
    creator_name: creatorName,
    comment_count: commentCount,
  };
}

export function toAlertRow(raw: unknown): AlertRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid alert row');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string') {
    throw new Error('Missing required fields in alert row');
  }
  return obj as unknown as AlertRow;
}

export function toUserRow(raw: unknown): UserRow {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid user row');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.email !== 'string') {
    throw new Error('Missing required fields in user row');
  }
  return obj as unknown as UserRow;
}
