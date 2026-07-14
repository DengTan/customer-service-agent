import { pgTable, serial, varchar, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// ============================================
// 尺码配置表
// ============================================

// 尺码配置表 - 结构化尺码表管理（与商品详情关联，支持 AI 查询与尺码推荐）
export const sizeCharts = pgTable(
  "size_charts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(), // 尺码表名称（如"女装T恤尺码表"）
    category: varchar("category", { length: 100 }).default("未分类"), // 适用分类（复用知识库分类体系）
    parent_category: varchar("parent_category", { length: 100 }), // 父分类
    // chart_type: 尺码表类型，决定推荐维度和表格列
    chart_type: varchar("chart_type", { length: 30 }).notNull().default("clothing"),
    // size_columns: 尺码列定义，如 [{"key":"size","label":"尺码"},{"key":"bust","label":"胸围(cm)"}]
    size_columns: jsonb("size_columns").notNull().default(sql`'[]'`),
    // size_rows: 尺码数据行，如 [{"size":"S","bust":"82-86","waist":"62-66"}]
    size_rows: jsonb("size_rows").notNull().default(sql`'[]'`),
    // 关联商品：NULL=通用尺码表（非NULL=商品专属尺码表）
    product_id: varchar("product_id", { length: 36 }).references(() => productDetails.id, { onDelete: "set null" }),
    // sku: 商品SKU（冗余字段，方便快速查询）
    sku: varchar("sku", { length: 100 }),
    // recommend_params: AI 尺码推荐参数结构化定义
    // 格式: {"dimensions":[{"key":"height","label":"身高","unit":"cm","range":[150,185],"required":true},{"key":"weight","label":"体重","unit":"kg","range":[40,120],"required":true},{"key":"preference","label":"穿着偏好","options":["修身","常规","宽松"],"required":false}]}
    recommend_params: jsonb("recommend_params"),
    // recommend_rules: 推荐规则说明（自然语言，供LLM理解如何根据尺寸推荐尺码）
    recommend_rules: text("recommend_rules"),
    // description: 尺码表补充说明（如"偏小一码建议选大一号"）
    description: text("description"),
    // image_url: 尺码表图片URL（可选，尺码示意图）
    image_url: varchar("image_url", { length: 500 }),
    // doc_ids: Coze SDK 向量文档ID（已废弃，Ollama 不再使用此字段）
    doc_ids: jsonb("doc_ids").default(sql`'[]'`),
    // embedding: Ollama 向量，存储为 JSON 数组字符串
    embedding: text("embedding"),
    // content_hash: SHA-256 去重哈希
    content_hash: varchar("content_hash", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, disabled
    // 引用追踪
    hit_count: integer("hit_count").notNull().default(0), // AI引用次数
    last_hit_at: timestamp("last_hit_at", { withTimezone: true }), // 最后引用时间
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("size_charts_category_idx").on(table.category),
    index("size_charts_product_id_idx").on(table.product_id),
    index("size_charts_sku_idx").on(table.sku),
    index("size_charts_status_idx").on(table.status),
    index("size_charts_content_hash_idx").on(table.content_hash),
    index("size_charts_hit_count_idx").on(table.hit_count),
  ]
);

// ============================================
// 尺码配置版本表
// ============================================

export const sizeChartVersions = pgTable(
  "size_chart_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    size_chart_id: varchar("size_chart_id", { length: 36 }).notNull().references(() => sizeCharts.id, { onDelete: "cascade" }),
    version_number: integer("version_number").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    chart_type: varchar("chart_type", { length: 30 }).notNull(),
    category: varchar("category", { length: 100 }),
    sku: varchar("sku", { length: 100 }),
    size_columns: jsonb("size_columns").notNull().default(sql`'[]'`),
    size_rows: jsonb("size_rows").notNull().default(sql`'[]'`),
    recommend_params: jsonb("recommend_params"),
    recommend_rules: text("recommend_rules"),
    description: text("description"),
    change_summary: text("change_summary"), // 变更摘要
    created_by: varchar("created_by", { length: 36 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scv_chart_id_idx").on(table.size_chart_id),
    index("scv_version_number_idx").on(table.version_number),
  ]
);

// Bot配置表 - 多Bot路由（支持父子层级：主Bot可包含多个子Agent）
export const botConfigs = pgTable(
  "bot_configs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    system_prompt: text("system_prompt").notNull(),
    tools: jsonb("tools").notNull().default(sql`'[]'`),
    knowledge_ids: jsonb("knowledge_ids").notNull().default(sql`'[]'`),
    skill_group_id: varchar("skill_group_id", { length: 36 }),
    is_default: boolean("is_default").notNull().default(false),
    parent_bot_id: varchar("parent_bot_id", { length: 36 }), // 父Bot ID，为空则为主Bot
    delegation_prompt: text("delegation_prompt"), // 委派提示词：描述何时委派给此子Agent
    collaboration_config: jsonb("collaboration_config").default(sql`'{}'`), // 协作配置：可通信的目标子Agent列表、通信模式等
    is_sub_agent: boolean("is_sub_agent").notNull().default(false), // 是否为子Agent
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, disabled
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("bot_configs_parent_bot_id_idx").on(table.parent_bot_id),
    index("bot_configs_is_sub_agent_idx").on(table.is_sub_agent),
  ]
);

// 路由规则表 - 意图路由到不同Bot
export const routingRules = pgTable(
  "routing_rules",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull(),
    condition_type: varchar("condition_type", { length: 30 }).notNull().default("keyword"), // keyword, intent, tag, customer_type
    condition_config: jsonb("condition_config").notNull().default(sql`'{}'`),
    target_bot_id: varchar("target_bot_id", { length: 36 }).notNull().references(() => botConfigs.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(0),
    is_enabled: boolean("is_enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("routing_rules_condition_type_idx").on(table.condition_type),
    index("routing_rules_is_enabled_idx").on(table.is_enabled),
  ]
);

// 营销活动表
export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 30 }).notNull().default("abandoned_cart"), // abandoned_cart, browsing_nurture, win_back
    target_segment: jsonb("target_segment").notNull().default(sql`'{}'`),
    bot_id: varchar("bot_id", { length: 36 }).references(() => botConfigs.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("draft"), // draft, running, paused, completed, scheduled, active
    ab_variants: jsonb("ab_variants"),
    message_template: text("message_template"), // 消息模板内容
    trigger_type: varchar("trigger_type", { length: 20 }).default("manual"), // manual, scheduled, event
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }), // 定时投放时间
    trigger_config: jsonb("trigger_config"), // 触发器配置
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("marketing_campaigns_status_idx").on(table.status),
    index("marketing_campaigns_type_idx").on(table.type),
    index("marketing_campaigns_trigger_type_idx").on(table.trigger_type),
    index("marketing_campaigns_scheduled_at_idx").on(table.scheduled_at),
  ]
);

// 营销日志表
export const marketingLogs = pgTable(
  "marketing_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    campaign_id: varchar("campaign_id", { length: 36 }).notNull().references(() => marketingCampaigns.id, { onDelete: "cascade" }),
    customer_id: varchar("customer_id", { length: 36 }).references(() => customers.id, { onDelete: "set null" }),
    conversation_id: varchar("conversation_id", { length: 36 }).references(() => conversations.id, { onDelete: "set null" }),
    variant: varchar("variant", { length: 10 }),
    sent_at: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    opened: boolean("opened").notNull().default(false),
    replied: boolean("replied").notNull().default(false),
    converted: boolean("converted").notNull().default(false),
  },
  (table) => [
    index("marketing_logs_campaign_id_idx").on(table.campaign_id),
    index("marketing_logs_customer_id_idx").on(table.customer_id),
  ]
);

// 对话表
export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    title: varchar("title", { length: 255 }).notNull().default("新对话"),
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, ended, handoff
    rating: integer("rating"), // 1-5 星评分
    rating_comment: text("rating_comment"),
    message_count: integer("message_count").notNull().default(0),
    source: varchar("source", { length: 20 }).notNull().default("web"), // web, qianniu, doudian, gorgias_email, gorgias_chat
    priority: varchar("priority", { length: 20 }).notNull().default("normal"), // urgent, normal
    unread_count: integer("unread_count").notNull().default(0),
    platform_connection_id: varchar("platform_connection_id", { length: 36 }),
    external_user_id: varchar("external_user_id", { length: 255 }), // 平台侧买家ID
    external_session_id: varchar("external_session_id", { length: 255 }), // 平台侧会话ID
    handoff_reason: text("handoff_reason"), // 转人工原因
    assigned_agent: varchar("assigned_agent", { length: 100 }), // 接管的人工客服
    summary: text("summary"), // 对话增量摘要，人工接管时快速了解上下文
    participant_ids: jsonb("participant_ids"), // 协同会话参与者ID列表
    is_collaborative: boolean("is_collaborative").default(false), // 是否协同会话
    metadata: jsonb("metadata"), // 扩展元数据（如 gorgias_ticket_id, gorgias_tags 等）
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("conversations_status_idx").on(table.status),
    index("conversations_created_at_idx").on(table.created_at),
  ]
);

// 消息表
export const messages = pgTable(
  "messages",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // user, assistant, system
    content: text("content").notNull(),
    sources: jsonb("sources"), // 知识库引用来源
    confidence: doublePrecision("confidence"), // AI回复置信度(0-1浮点数)
    confidence_breakdown: jsonb("confidence_breakdown"), // 置信度分解(knowledge/tool/llm_self/sub_agent/handoff_intent/no_support)
    tool_calls: jsonb("tool_calls"), // Function Call 调用记录
    tool_results: jsonb("tool_results"), // 工具执行结果
    image_url: text("image_url"), // 图片消息的URL
    message_type: varchar("message_type", { length: 20 }).notNull().default("text"), // text, image, card, order, logistics, action_buttons
    rich_content: jsonb("rich_content"), // 富消息结构化数据(订单卡片/物流卡片/操作按钮等)
    metadata: jsonb("metadata"), // 扩展元数据（如 gorgias_message_id, gorgias_author 等）
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_id_idx").on(table.conversation_id),
    index("messages_created_at_idx").on(table.created_at),
  ]
);

// 自动回复规则表
export const autoReplyRules = pgTable(
  "auto_reply_rules",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    keyword: varchar("keyword", { length: 255 }).notNull(),
    match_mode: varchar("match_mode", { length: 20 }).notNull().default("fuzzy"), // exact, fuzzy
    reply_content: text("reply_content").notNull(),
    is_enabled: boolean("is_enabled").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("auto_reply_rules_enabled_idx").on(table.is_enabled),
  ]
);

// 店铺管理表 - 管理多店铺及客服账号配额
export const shops = pgTable(
  "shops",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(), // 店铺名称
    platform: varchar("platform", { length: 50 }).notNull().default("qianniu"), // qianniu, doudian, etc.
    shop_url: varchar("shop_url", { length: 500 }), // 店铺链接
    logo_url: varchar("logo_url", { length: 500 }), // 店铺Logo URL
    total_accounts: integer("total_accounts").notNull().default(0), // 总账号数
    used_accounts: integer("used_accounts").notNull().default(0), // 已用账号数
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, disabled
    contact_name: varchar("contact_name", { length: 100 }), // 联系人
    contact_phone: varchar("contact_phone", { length: 20 }), // 联系电话
    remark: text("remark"), // 备注
    knowledge_ids: jsonb("knowledge_ids").default([]), // 关联的知识库条目ID列表
    config: jsonb("config").default({}), // 业务规则配置(包邮/发货/退换/工作时间等)
    agent_quota: integer("agent_quota").notNull().default(0), // 客服账号额度
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("shops_platform_idx").on(table.platform),
    index("shops_status_idx").on(table.status),
  ]
);

// 店铺托管客服账号表 - 每个店铺下的客服账号（名称+加密密码）
export const shopAgentAccounts = pgTable(
  "shop_agent_accounts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    shop_id: varchar("shop_id", { length: 36 }).notNull().references(() => shops.id, { onDelete: "cascade" }), // 所属店铺 FK→shops
    account_name: varchar("account_name", { length: 255 }).notNull(), // 账号名称（抖店为邮箱）
    encrypted_password: text("encrypted_password").notNull(), // AES-256加密后的密码
    platform: varchar("platform", { length: 50 }), // 平台来源
    status: varchar("status", { length: 20 }).notNull().default("active"), // active/disabled
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("shop_agent_accounts_shop_id_idx").on(table.shop_id),
    uniqueIndex("shop_agent_accounts_shop_account_idx").on(table.shop_id, table.account_name),
  ]
);

// 知识库条目追踪表 - 记录导入的知识库资料
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 20 }).notNull().default("text"), // text, url, file, image
    content: text("content"), // 文本内容或URL
    content_hash: varchar("content_hash", { length: 64 }), // SHA-256 hash for dedup
    doc_ids: jsonb("doc_ids"), // Coze SDK 向量文档ID（已废弃，Ollama 不再使用）
    embedding: text("embedding"), // Ollama 向量，存储为 JSON 数组字符串
    category: varchar("category", { length: 100 }).default("未分类"),
    parent_category: varchar("parent_category", { length: 100 }), // 层级分类：父分类
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, deleted
    chunk_count: integer("chunk_count").default(0),
    hit_count: integer("hit_count").default(0), // 被引用次数
    last_hit_at: timestamp("last_hit_at", { withTimezone: true }), // 最后被引用时间
    adopted_count: integer("adopted_count").notNull().default(0), // 引用后被采纳/有用的次数
    rejected_count: integer("rejected_count").notNull().default(0), // 引用后被标记为不准确/无用的次数
    archived_at: timestamp("archived_at", { withTimezone: true }), // 归档时间，null=未归档
    expires_at: timestamp("expires_at", { withTimezone: true }), // 失效时间，null=永久有效
    image_url: text("image_url"), // 知识条目关联的图片URL，AI回复时可引用
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_items_status_idx").on(table.status),
    index("knowledge_items_category_idx").on(table.category),
    index("knowledge_items_content_hash_idx").on(table.content_hash),
    index("knowledge_items_archived_at_idx").on(table.archived_at),
    index("knowledge_items_expires_at_idx").on(table.expires_at),
  ]
);

// 知识引用反馈表 - 记录每次引用是否被采纳/被拒绝（检索质量反馈）
export const knowledgeFeedback = pgTable(
  "knowledge_feedback",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    message_id: varchar("message_id", { length: 36 }).notNull(), // 关联的AI回复消息ID
    conversation_id: varchar("conversation_id", { length: 36 }), // 对话ID（方便按对话聚合）
    knowledge_item_id: varchar("knowledge_item_id", { length: 36 }), // 引用的知识条目ID
    // P2: stable chunk identity for citation-level feedback precision
    chunk_id: varchar("chunk_id", { length: 36 }), // chunk UUID when sub-chunk matched; null when parent item matched directly
    chunk_index: integer("chunk_index"), // chunk position within parent (0 when parent matched)
    content_hash: varchar("content_hash", { length: 64 }), // SHA-256 of chunk content at time of citation (audit trail)
    knowledge_name: varchar("knowledge_name", { length: 255 }), // 冗余：知识条目名称（条目删除后仍可追溯）
    knowledge_score: doublePrecision("knowledge_score"), // 引用时的相关度分数
    feedback_type: varchar("feedback_type", { length: 20 }).notNull(), // adopted | rejected
    reason: varchar("reason", { length: 50 }), // user_rejected | user_handoff | user_low_rating | low_confidence
    comment: text("comment"), // 用户填写的反馈说明（可选）
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_feedback_message_id_idx").on(table.message_id),
    index("knowledge_feedback_item_id_idx").on(table.knowledge_item_id),
    index("knowledge_feedback_type_idx").on(table.feedback_type),
    index("knowledge_feedback_created_at_idx").on(table.created_at),
  ]
);

// 知识缺口信号表 - 挖掘"用户问了很多但知识库没答案"的问题
export const knowledgeGapSignals = pgTable(
  "knowledge_gap_signals",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    question_hash: varchar("question_hash", { length: 100 }).notNull().unique(), // SHA-256(归一化问题)，前缀 gap_sha256_ + hash
    sample_question: text("sample_question").notNull(), // 首次出现的原始问题
    question_category: varchar("question_category", { length: 100 }),
    frequency: integer("frequency").notNull().default(1), // 累计触发次数
    first_seen_at: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    last_top_score: doublePrecision("last_top_score"), // 最近一次检索最高相关度
    triggers_handoff: boolean("triggers_handoff").notNull().default(false), // 是否触发过转人工
    source_conversation_ids: jsonb("source_conversation_ids").notNull().default([]), // 关联对话ID列表（最多20）
    status: varchar("status", { length: 20 }).notNull().default("open"), // open | in_progress | resolved | dismissed
    resolved_by: varchar("resolved_by", { length: 36 }),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
    linked_knowledge_item_id: varchar("linked_knowledge_item_id", { length: 36 }), // 解决后关联的知识条目
    notes: text("notes"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_gap_status_idx").on(table.status),
    index("knowledge_gap_frequency_idx").on(table.frequency),
    index("knowledge_gap_last_seen_idx").on(table.last_seen_at),
  ]
);

// 告警表 - 异常对话告警
export const alerts = pgTable(
  "alerts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).references(() => conversations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(), // low_confidence, negative_sentiment, high_rounds, token_expired
    severity: varchar("severity", { length: 20 }).notNull().default("warning"), // info, warning, critical
    message: text("message").notNull(),
    is_resolved: boolean("is_resolved").notNull().default(false),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("alerts_conversation_id_idx").on(table.conversation_id),
    index("alerts_is_resolved_idx").on(table.is_resolved),
    index("alerts_created_at_idx").on(table.created_at),
  ]
);

// 知识自学习队列表 - 从对话中提取的候选QA对
export const knowledgeLearningQueue = pgTable(
  "knowledge_learning_queue",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0),
    conversation_id: varchar("conversation_id", { length: 36 }).references(() => conversations.id, { onDelete: "set null" }),
    conversation_title: varchar("conversation_title", { length: 255 }),
    source_context: text("source_context"), // 原始对话上下文片段
    category: varchar("category", { length: 100 }).default("未分类"),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, approved, rejected
    reviewed_by: varchar("reviewed_by", { length: 100 }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
    knowledge_item_id: varchar("knowledge_item_id", { length: 36 }), // 审核通过后关联的知识库条目ID
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("klq_status_idx").on(table.status),
    index("klq_confidence_idx").on(table.confidence),
    index("klq_created_at_idx").on(table.created_at),
    index("klq_conversation_id_idx").on(table.conversation_id),
  ]
);

// 推送模板表 - 主动消息推送模板
export const pushTemplates = pgTable(
  "push_templates",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(),
    trigger_event: varchar("trigger_event", { length: 50 }).notNull(), // order_shipped, order_delivered, refund_completed, refund_rejected, logistics_delayed
    content_template: text("content_template").notNull(),
    channels: jsonb("channels").notNull().default(sql`'["web"]'`), // ["web", "qianniu", "sms"]
    is_enabled: boolean("is_enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("push_templates_trigger_event_idx").on(table.trigger_event),
    index("push_templates_is_enabled_idx").on(table.is_enabled),
  ]
);

// 推送记录表 - 已发送的推送消息记录
export const pushRecords = pgTable(
  "push_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    template_id: varchar("template_id", { length: 36 }).references(() => pushTemplates.id, { onDelete: "set null" }),
    recipient: varchar("recipient", { length: 255 }).notNull(),
    content: text("content").notNull(),
    trigger_event: varchar("trigger_event", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull().default("web"),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, sent, failed
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("push_records_template_id_idx").on(table.template_id),
    index("push_records_status_idx").on(table.status),
    index("push_records_created_at_idx").on(table.created_at),
  ]
);

// 推送事件日志表 - Webhook接收到的事件记录
export const pushEventLog = pgTable(
  "push_event_log",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    event_type: varchar("event_type", { length: 50 }).notNull(),
    event_data: jsonb("event_data").notNull().default(sql`'{}'`),
    status: varchar("status", { length: 20 }).notNull().default("received"), // received, processed, failed
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("push_event_log_event_type_idx").on(table.event_type),
    index("push_event_log_status_idx").on(table.status),
    index("push_event_log_created_at_idx").on(table.created_at),
  ]
);

// 系统设置表
export const settings = pgTable(
  "settings",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    key: varchar("key", { length: 100 }).notNull().unique(),
    value: text("value").notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("settings_key_idx").on(table.key),
  ]
);

// ====== Phase 1: RBAC + 客户画像 ======

// 用户表 - 团队成员与权限管理
export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    avatar: text("avatar"),
    role: varchar("role", { length: 20 }).notNull().default("agent"), // admin, agent, observer
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, disabled
    last_active_at: timestamp("last_active_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("users_email_idx").on(table.email),
    index("users_role_idx").on(table.role),
    index("users_status_idx").on(table.status),
  ]
);

// 角色权限表 - RBAC 权限矩阵
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    role: varchar("role", { length: 20 }).notNull(), // admin, agent, observer
    resource: varchar("resource", { length: 50 }).notNull(), // conversations, knowledge, settings, team, customers, analytics
    action: varchar("action", { length: 20 }).notNull(), // read, write, delete
    allowed: boolean("allowed").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("role_permissions_role_idx").on(table.role),
    index("role_permissions_resource_idx").on(table.resource),
  ]
);

// 客户表 - 客户画像与标签
export const customers = pgTable(
  "customers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    avatar: text("avatar"),
    source_platform: varchar("source_platform", { length: 20 }).notNull().default("web"), // web, qianniu, doudian
    external_id: varchar("external_id", { length: 255 }), // 平台侧用户ID
    tags: jsonb("tags").notNull().default(sql`'[]'`), // tag 名称列表
    metadata: jsonb("metadata"), // 扩展信息（地址、备注等）
    notes: text("notes"), // 客户备注
    conversation_count: integer("conversation_count").notNull().default(0),
    is_anonymous: boolean("is_anonymous").notNull().default(false), // Web 匿名访客自动创建的客户标记
    platform_connection_id: varchar("platform_connection_id", { length: 36 }), // 平台客户关联的店铺/连接 ID，用于跨店铺区分
    first_seen_at: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("customers_source_platform_idx").on(table.source_platform),
    index("customers_external_id_idx").on(table.external_id),
    index("customers_last_seen_at_idx").on(table.last_seen_at),
    index("customers_platform_connection_id_idx").on(table.platform_connection_id),
    // partial unique index: 保证同一平台+外部 ID+店铺下的客户唯一
    index("customers_external_id_unique_idx").on(table.source_platform, table.external_id, table.platform_connection_id),
  ]
);

// 客户标签表
export const customerTags = pgTable(
  "customer_tags",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 50 }).notNull().unique(),
    color: varchar("color", { length: 20 }).notNull().default("#2F6BFF"), // 标签颜色
    category: varchar("category", { length: 20 }).notNull().default("manual"), // auto, manual
    is_system: boolean("is_system").notNull().default(false), // 系统内置标签不可删除
    customer_count: integer("customer_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("customer_tags_category_idx").on(table.category),
  ]
);

// 客户对话关联表
export const customerConversations = pgTable(
  "customer_conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    customer_id: varchar("customer_id", { length: 36 }).notNull().references(() => customers.id, { onDelete: "cascade" }),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customer_conversations_customer_id_idx").on(table.customer_id),
    index("customer_conversations_conversation_id_idx").on(table.conversation_id),
  ]
);

// ====== Phase 2: 坐席工作台 ======

// 坐席会话表 - 坐席在线状态与当前服务
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("offline"), // online, away, offline
    current_conversation_id: varchar("current_conversation_id", { length: 36 }),
    last_active_at: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_sessions_user_id_idx").on(table.user_id),
    index("agent_sessions_status_idx").on(table.status),
  ]
);

// 坐席排队表 - 转人工后的排队与服务管理
export const agentQueue = pgTable(
  "agent_queue",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    customer_name: varchar("customer_name", { length: 100 }),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"), // urgent, normal
    skill_group_id: varchar("skill_group_id", { length: 36 }),
    assigned_agent_id: varchar("assigned_agent_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("queued"), // queued, assigned, resolved
    reason: text("reason"), // 转人工原因
    summary: text("summary"), // 对话摘要
    source_platform: varchar("source_platform", { length: 20 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    assigned_at: timestamp("assigned_at", { withTimezone: true }),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_queue_status_idx").on(table.status),
    index("agent_queue_assigned_agent_id_idx").on(table.assigned_agent_id),
    index("agent_queue_created_at_idx").on(table.created_at),
  ]
);

// 技能组表 - 坐席技能分组
export const skillGroups = pgTable(
  "skill_groups",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 50 }).notNull().unique(),
    description: text("description"),
    member_ids: jsonb("member_ids").notNull().default(sql`'[]'`), // 成员用户ID列表
    is_default: boolean("is_default").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  }
);

// 快捷回复话术库表
export const quickReplies = pgTable(
  "quick_replies",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    title: varchar("title", { length: 100 }).notNull(),
    content: text("content").notNull(),
    category: varchar("category", { length: 50 }).notNull().default("通用"),
    variables: jsonb("variables").notNull().default(sql`'[]'`),
    scope: varchar("scope", { length: 20 }).notNull().default("global"), // personal, team, global
    creator_id: varchar("creator_id", { length: 36 }),
    usage_count: integer("usage_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("quick_replies_category_idx").on(table.category),
    index("quick_replies_scope_idx").on(table.scope),
  ]
);

// 对话标签定义表
export const conversationTagsDef = pgTable(
  "conversation_tags_def",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 50 }).notNull().unique(),
    color: varchar("color", { length: 20 }).notNull().default("#2F6BFF"),
    category: varchar("category", { length: 20 }).notNull().default("question_type"), // question_type, sentiment, business_line
    conversation_count: integer("conversation_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("conversation_tags_def_category_idx").on(table.category),
  ]
);

// 对话标签记录表
export const conversationTagRecords = pgTable(
  "conversation_tag_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    tag_id: varchar("tag_id", { length: 36 }).notNull().references(() => conversationTagsDef.id, { onDelete: "cascade" }),
    tagged_by: varchar("tagged_by", { length: 36 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("conversation_tag_records_conversation_id_idx").on(table.conversation_id),
    index("conversation_tag_records_tag_id_idx").on(table.tag_id),
  ]
);

// 质检规则表
export const qualityRules = pgTable(
  "quality_rules",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 30 }).notNull().default("first_response_timeout"),
    config: jsonb("config").notNull().default(sql`'{}'`),
    is_enabled: boolean("is_enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  }
);

// 质检记录表
export const qualityChecks = pgTable(
  "quality_checks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    rule_id: varchar("rule_id", { length: 36 }).notNull().references(() => qualityRules.id, { onDelete: "cascade" }),
    result: varchar("result", { length: 10 }).notNull().default("pass"), // pass, fail
    detail: text("detail"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("quality_checks_conversation_id_idx").on(table.conversation_id),
    index("quality_checks_rule_id_idx").on(table.rule_id),
    index("quality_checks_result_idx").on(table.result),
  ]
);

// 排班表 - 坐席排班管理
export const schedules = pgTable(
  "schedules",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    skill_group_id: varchar("skill_group_id", { length: 36 }).notNull().references(() => skillGroups.id, { onDelete: "cascade" }),
    date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD format
    shift: varchar("shift", { length: 20 }).notNull().default("morning"), // morning, afternoon, evening
    status: varchar("status", { length: 20 }).notNull().default("scheduled"), // scheduled, active, completed
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("schedules_user_id_idx").on(table.user_id),
    index("schedules_date_idx").on(table.date),
  ]
);

// 知识库版本表 - 知识条目版本历史
export const knowledgeVersions = pgTable(
  "knowledge_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    knowledge_item_id: varchar("knowledge_item_id", { length: 36 }).notNull(),
    version: integer("version").notNull().default(1),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    category: varchar("category", { length: 50 }),
    change_summary: text("change_summary"),
    chunk_diff: jsonb("chunk_diff"), // 变更明细: added/modified/removed chunks
    chunk_count: integer("chunk_count").default(0), // 当前chunk数量
    created_by: varchar("created_by", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_versions_item_id_idx").on(table.knowledge_item_id),
    uniqueIndex("knowledge_versions_item_version_idx").on(table.knowledge_item_id, table.version),
  ]
);

// ====== 子Agent系统 ======

// Agent委派记录表 - 主Bot委派任务给子Agent的记录
export const agentDelegations = pgTable(
  "agent_delegations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    parent_bot_id: varchar("parent_bot_id", { length: 36 }).notNull(), // 委派方Bot ID
    child_bot_id: varchar("child_bot_id", { length: 36 }).notNull(), // 被委派子Agent ID
    trigger_intent: varchar("trigger_intent", { length: 100 }), // 触发委派的意图
    input_message: text("input_message"), // 委派给子Agent的用户消息
    result_content: text("result_content"), // 子Agent返回的结果
    confidence: doublePrecision("confidence"), // 子Agent返回的置信度
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, processing, completed, failed
    error_message: text("error_message"),
    metadata: jsonb("metadata"), // 额外元数据（工具调用、来源等）
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_delegations_conversation_id_idx").on(table.conversation_id),
    index("agent_delegations_parent_bot_id_idx").on(table.parent_bot_id),
    index("agent_delegations_child_bot_id_idx").on(table.child_bot_id),
    index("agent_delegations_status_idx").on(table.status),
  ]
);

// Agent协作通信表 - 子Agent间的协作通信记录
export const agentCollaborations = pgTable(
  "agent_collaborations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    delegation_id: varchar("delegation_id", { length: 36 }).references(() => agentDelegations.id, { onDelete: "cascade" }),
    sender_bot_id: varchar("sender_bot_id", { length: 36 }).notNull(), // 发送方Bot ID
    receiver_bot_id: varchar("receiver_bot_id", { length: 36 }).notNull(), // 接收方Bot ID
    message_type: varchar("message_type", { length: 30 }).notNull().default("request"), // request, response, notify
    content: text("content").notNull(), // 通信内容
    context: jsonb("context"), // 附带的上下文信息
    status: varchar("status", { length: 20 }).notNull().default("sent"), // sent, delivered, processed, failed
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_collaborations_conversation_id_idx").on(table.conversation_id),
    index("agent_collaborations_delegation_id_idx").on(table.delegation_id),
    index("agent_collaborations_sender_bot_id_idx").on(table.sender_bot_id),
    index("agent_collaborations_receiver_bot_id_idx").on(table.receiver_bot_id),
  ]
);

// ============================================
// 模拟测试相关表
// ============================================

// 模拟测试会话表
export const simulationConversations = pgTable(
  "simulation_conversations",
  {
    id: varchar("id", { length: 50 }).primaryKey(), // 使用 sim-{timestamp}-{random} 格式
    title: varchar("title", { length: 255 }).notNull(),
    scenario_id: varchar("scenario_id", { length: 50 }), // order_inquiry, refund, logistics, custom 等
    scenario_name: varchar("scenario_name", { length: 100 }).notNull().default("订单查询"), // 场景名称
    status: varchar("status", { length: 20 }).notNull().default("active"), // active, ended
    message_count: integer("message_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("simulation_conversations_status_idx").on(table.status),
    index("simulation_conversations_created_at_idx").on(table.created_at),
  ]
);

// 模拟测试消息表
export const simulationMessages = pgTable(
  "simulation_messages",
  {
    id: varchar("id", { length: 50 }).primaryKey(),
    conversation_id: varchar("conversation_id", { length: 50 }).notNull().references(() => simulationConversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(), // user, assistant, system
    content: text("content").notNull(),
    sources: jsonb("sources"), // 知识库引用来源
    confidence: doublePrecision("confidence"), // AI回复置信度
    confidence_breakdown: jsonb("confidence_breakdown"), // 置信度分解
    tool_calls: jsonb("tool_calls"), // Function Call 调用记录
    tool_results: jsonb("tool_results"), // 工具执行结果
    image_url: text("image_url"), // 图片消息URL
    message_type: varchar("message_type", { length: 20 }).notNull().default("text"), // text, image, card, order, logistics, action_buttons
    rich_content: jsonb("rich_content"), // 富消息结构化数据
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("simulation_messages_conversation_id_idx").on(table.conversation_id),
    index("simulation_messages_created_at_idx").on(table.created_at),
  ]
);

// ============================================
// 商品详情表
// ============================================

// 商品详情表 - 结构化商品信息管理（与知识库向量检索打通，AI 可通过向量检索或 Function Call 获取商品信息）
export const productDetails = pgTable(
  "product_details",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull(), // 商品名称
    sku: varchar("sku", { length: 100 }).notNull().unique(), // 商品SKU编码
    category: varchar("category", { length: 100 }).default("未分类"), // 商品分类（复用知识库分类体系）
    parent_category: varchar("parent_category", { length: 100 }), // 父分类
    brand: varchar("brand", { length: 100 }), // 品牌
    price: doublePrecision("price"), // 售价
    original_price: doublePrecision("original_price"), // 原价
    // specifications: JSON 数组，每个元素 {key: "颜色", value: "黑色/白色"}, 用于展示规格参数
    specifications: jsonb("specifications").default(sql`'[]'`),
    // features: 卖点/特色数组，用于 AI 回复时引用
    features: jsonb("features").default(sql`'[]'`),
    description: text("description"), // 商品详细描述
    usage_instructions: text("usage_instructions"), // 使用说明/注意事项
    // image_urls: 商品图片URL数组，最多10张
    image_urls: jsonb("image_urls").default(sql`'[]'`),
    status: varchar("status", { length: 20 }).notNull().default("on_sale"), // on_sale, off_sale, discontinued
    // doc_ids: Coze SDK 向量化后返回的文档ID列表（已废弃）
    doc_ids: jsonb("doc_ids").default(sql`'[]'`),
    // embedding: Ollama 向量，存储为 JSON 数组字符串
    embedding: text("embedding"),
    // content_hash: SHA-256(名称+品牌+规格+卖点拼接)，用于导入去重
    content_hash: varchar("content_hash", { length: 64 }),
    tags: jsonb("tags").default(sql`'[]'`), // 标签数组，便于搜索和分类
    // 平台商品ID（预留：未来从千牛/抖店同步商品时存储平台侧商品ID）
    external_product_id: varchar("external_product_id", { length: 100 }),
    // sync_source: 手动录入 / qianniu（千牛同步）/ doudian（抖店同步）
    sync_source: varchar("sync_source", { length: 20 }).notNull().default("manual"),
    // 引用追踪
    hit_count: integer("hit_count").notNull().default(0), // AI引用次数
    last_hit_at: timestamp("last_hit_at", { withTimezone: true }), // 最后引用时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("product_details_sku_idx").on(table.sku),
    index("product_details_category_idx").on(table.category),
    index("product_details_status_idx").on(table.status),
    index("product_details_content_hash_idx").on(table.content_hash),
    index("product_details_sync_source_idx").on(table.sync_source),
    index("product_details_hit_count_idx").on(table.hit_count),
  ]
);

// ============================================
// Gorgias Webhook 事件处理记录表
// ============================================

// Webhook 事件处理记录表 - 用于 Webhook 事件幂等性检查（替代内存缓存，支持多实例部署）
export const webhookEventProcessed = pgTable(
  "webhook_event_processed",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // event_id: Gorgias Webhook 事件 ID（唯一索引）
    event_id: varchar("event_id", { length: 100 }).notNull(),
    // event_type: 事件类型
    event_type: varchar("event_type", { length: 50 }).notNull(),
    // object_id: 关联对象 ID（如工单 ID）
    object_id: varchar("object_id", { length: 50 }),
    // 处理结果：success / failed
    result: varchar("result", { length: 20 }).notNull().default("success"),
    // 错误信息（如果失败）
    error_message: text("error_message"),
    // 处理时间
    processed_at: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_event_processed_event_id_idx").on(table.event_id),
    index("webhook_event_processed_event_type_idx").on(table.event_type),
    index("webhook_event_processed_processed_at_idx").on(table.processed_at),
  ]
);

// ============================================
// 内容安全过滤表
// ============================================

// 敏感词表 - 用户消息敏感词过滤规则
export const contentSensitiveWords = pgTable(
  "content_sensitive_words",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // word: 敏感词内容
    word: varchar("word", { length: 100 }).notNull().unique(),
    // match_mode: 匹配模式 exact=精确, fuzzy=模糊(含敏感词的短语)
    match_mode: varchar("match_mode", { length: 20 }).notNull().default("exact"),
    // action: 处理动作 block=阻止, replace=替换, warn=警告
    action: varchar("action", { length: 20 }).notNull().default("block"),
    // replacement: 替换词(当action=replace时)
    replacement: varchar("replacement", { length: 100 }),
    // category: 分类: 脏话/政治/广告/其他
    category: varchar("category", { length: 50 }).default("脏话"),
    is_enabled: boolean("is_enabled").notNull().default(true),
    // hit_count: 命中次数统计
    hit_count: integer("hit_count").notNull().default(0),
    created_by: varchar("created_by", { length: 36 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("csw_word_idx").on(table.word),
    index("csw_category_idx").on(table.category),
    index("csw_is_enabled_idx").on(table.is_enabled),
  ]
);

// URL白名单表 - 允许发送的域名白名单
export const allowedDomains = pgTable(
  "allowed_domains",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // domain: 域名,支持通配符如 *.example.com
    domain: varchar("domain", { length: 255 }).notNull().unique(),
    // pattern_type: 匹配模式 exact=精确, wildcard=通配符, suffix=域名后缀
    pattern_type: varchar("pattern_type", { length: 20 }).notNull().default("exact"),
    // description: 用途说明
    description: varchar("description", { length: 255 }),
    is_enabled: boolean("is_enabled").notNull().default(true),
    // hit_count: 命中次数统计
    hit_count: integer("hit_count").notNull().default(0),
    created_by: varchar("created_by", { length: 36 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ad_domain_idx").on(table.domain),
    index("ad_is_enabled_idx").on(table.is_enabled),
  ]
);

// 过滤日志表 - 记录所有内容过滤事件
export const contentFilterLogs = pgTable(
  "content_filter_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // conversation_id: 关联对话
    conversation_id: varchar("conversation_id", { length: 36 }),
    // message_id: 关联消息(如果已保存)
    message_id: varchar("message_id", { length: 36 }),
    // filter_type: 过滤类型 sensitive_word, url
    filter_type: varchar("filter_type", { length: 20 }).notNull(),
    // word: 命中的敏感词/域名
    word: varchar("word", { length: 100 }),
    // action: 处理动作 blocked, replaced, warned
    action: varchar("action", { length: 20 }).notNull(),
    // original_content: 原始消息内容
    original_content: text("original_content").notNull(),
    // filtered_content: 过滤后内容(如有替换)
    filtered_content: text("filtered_content"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("cfl_conversation_id_idx").on(table.conversation_id),
    index("cfl_filter_type_idx").on(table.filter_type),
    index("cfl_created_at_idx").on(table.created_at),
  ]
);

// ============================================
// 孤儿表补全 (2026-07-03)
// 以下 8 张表在数据库中存在，但 schema.ts 之前缺少定义
// ============================================

// ============================================
// 平台连接配置表
// ============================================
// 存储各平台的 API 连接配置（千牛、抖店等）
export const platformConnections = pgTable(
  "platform_connections",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 连接名称（用户友好名称）
    name: varchar("name", { length: 255 }),
    // 平台标识
    platform: varchar("platform", { length: 50 }).notNull(),
    // 认证信息
    app_key: varchar("app_key", { length: 100 }).notNull(),
    app_secret: varchar("app_secret", { length: 200 }).notNull(),
    access_token: text("access_token"),
    refresh_token: text("refresh_token"),
    token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
    // 店铺信息
    shop_name: varchar("shop_name", { length: 255 }),
    shop_id: varchar("shop_id", { length: 100 }),
    // 连接状态
    status: varchar("status", { length: 20 }).notNull().default("disconnected"),
    // Webhook 配置
    webhook_url: text("webhook_url"),
    // 扩展配置
    config: jsonb("config"),
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("platform_connections_platform_idx").on(table.platform),
    index("platform_connections_status_idx").on(table.status),
  ]
);

// ============================================
// 登录日志表
// ============================================
// 记录所有登录事件（成功/失败），用于安全审计
export const loginEvents = pgTable(
  "login_events",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 关联用户（可为 NULL，登录失败时无用户）
    user_id: varchar("user_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    email: varchar("email", { length: 255 }),
    // 事件类型
    event_type: varchar("event_type", { length: 20 }).notNull(),
    // 请求信息
    ip_address: varchar("ip_address", { length: 50 }),
    user_agent: text("user_agent"),
    // 结果
    success: boolean("success").notNull().default(true),
    error_message: text("error_message"),
    // 时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("login_events_user_id_idx").on(table.user_id),
    index("login_events_created_at_idx").on(table.created_at),
    index("login_events_email_idx").on(table.email),
    index("login_events_event_type_idx").on(table.event_type),
  ]
);

// ============================================
// 工单表
// ============================================
// 企业级工单系统，支持子工单、自定义字段、工单关联
// 注意: parent_ticket_id 自引用在数据库层处理（迁移脚本已添加 FK 约束）
// TypeScript 类型上不添加自引用，避免循环类型错误
export const tickets = pgTable(
  "tickets",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 工单编号（全局唯一）
    ticket_number: varchar("ticket_number", { length: 50 }).notNull().unique(),
    // 基本信息
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 50 }).default("其他"),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    // 指派
    assignee_id: varchar("assignee_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    creator_id: varchar("creator_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    // 关联对话（重命名自 related_conversation_id）
    conversation_id: varchar("conversation_id", { length: 36 }).references(() => conversations.id, { onDelete: "set null" }),
    // 子工单（父工单 ID）— 数据库层约束由迁移脚本处理，TypeScript 层不做自引用避免循环类型
    parent_ticket_id: varchar("parent_ticket_id", { length: 36 }),
    // 自定义字段
    custom_fields: jsonb("custom_fields").default(sql`'{}'`),
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("tickets_status_idx").on(table.status),
    index("tickets_priority_idx").on(table.priority),
    index("tickets_assignee_id_idx").on(table.assignee_id),
    index("tickets_conversation_id_idx").on(table.conversation_id),
    index("tickets_parent_ticket_id_idx").on(table.parent_ticket_id),
  ]
);

// ============================================
// 工单评论表
// ============================================
// 工单内部评论和对话，支持内部/外部区分
export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 关联工单
    ticket_id: varchar("ticket_id", { length: 36 }).notNull().references(() => tickets.id, { onDelete: "cascade" }),
    // 作者
    author_id: varchar("author_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    // 内容
    content: text("content").notNull(),
    // 是否内部评论（内部评论对客户不可见）
    is_internal: boolean("is_internal").notNull().default(false),
    // 时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ticket_comments_ticket_id_idx").on(table.ticket_id),
  ]
);

// ============================================
// 工单状态变更日志表
// ============================================
// 记录工单状态流转历史，用于审计和 SLA 计算
export const ticketStatusLog = pgTable(
  "ticket_status_log",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 关联工单
    ticket_id: varchar("ticket_id", { length: 36 }).notNull().references(() => tickets.id, { onDelete: "cascade" }),
    // 状态变更
    from_status: varchar("from_status", { length: 20 }),
    to_status: varchar("to_status", { length: 20 }).notNull(),
    // 操作人
    operator_id: varchar("operator_id", { length: 36 }).references(() => users.id, { onDelete: "set null" }),
    // 时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ticket_status_log_ticket_id_idx").on(table.ticket_id),
  ]
);

// ============================================
// 坐席分配配置表
// ============================================
// 配置坐席自动分配策略（轮询/负载均衡/指定店铺）
export const agentAssignmentConfig = pgTable(
  "agent_assignment_config",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 配置名称
    name: varchar("name", { length: 100 }).notNull(),
    // 分配策略
    strategy: varchar("strategy", { length: 50 }).notNull().default("round_robin"),
    // 关联店铺（NULL 表示全局策略）
    shop_id: varchar("shop_id", { length: 36 }).references(() => shops.id, { onDelete: "set null" }),
    // 坐席最大并发数
    max_concurrent: integer("max_concurrent").default(5),
    // 是否启用
    is_enabled: boolean("is_enabled").notNull().default(true),
    // 条件配置（JSON，可配置优先技能组等）
    condition_config: jsonb("condition_config"),
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_assignment_config_shop_id_idx").on(table.shop_id),
    index("agent_assignment_config_enabled_idx").on(table.is_enabled),
  ]
);

// ============================================
// 坐席分配统计表
// ============================================
// 按日统计坐席的分配、活跃、完成情况
export const agentAssignmentStats = pgTable(
  "agent_assignment_stats",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 关联坐席（使用 user_id，与代码层对齐）
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    // 统计日期
    date: varchar("date", { length: 10 }).notNull(),
    // 分配统计
    assigned_count: integer("assigned_count").notNull().default(0),
    // 活跃会话数
    active_conversations: integer("active_conversations").notNull().default(0),
    // 已完成数
    completed_count: integer("completed_count").notNull().default(0),
    // 已解决数（独立统计）
    resolved_count: integer("resolved_count").notNull().default(0),
    // 平均处理时长（秒）
    avg_handle_time: doublePrecision("avg_handle_time").default(0),
    // 最后分配时间
    last_assigned_at: timestamp("last_assigned_at", { withTimezone: true }),
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_assignment_stats_user_date_idx").on(table.user_id, table.date),
    index("agent_assignment_stats_date_idx").on(table.date),
  ]
);

// ============================================
// 店铺坐席绑定表
// ============================================
// 建立店铺与坐席的多对多关系，支持优先级和角色
export const shopAgentBindings = pgTable(
  "shop_agent_bindings",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 关联店铺
    shop_id: varchar("shop_id", { length: 36 }).notNull().references(() => shops.id, { onDelete: "cascade" }),
    // 关联坐席
    user_id: varchar("user_id", { length: 36 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    // 优先级（数字越小优先级越高）
    priority: integer("priority").notNull().default(0),
    // 是否启用
    is_enabled: boolean("is_enabled").notNull().default(true),
    // 坐席角色
    role: varchar("role", { length: 50 }).default("agent"),
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shop_agent_bindings_shop_user_idx").on(table.shop_id, table.user_id),
    index("shop_agent_bindings_user_id_idx").on(table.user_id),
    index("shop_agent_bindings_enabled_idx").on(table.is_enabled),
  ]
);

// ============================================
// 大模型提供商配置表
// ============================================
// 支持扩展额外的 LLM API 提供商（OpenAI、DeepSeek、Claude 等）
export const llmProviders = pgTable(
  "llm_providers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 提供商标识
    name: varchar("name", { length: 100 }).notNull().unique(), // 唯一标识，如 openai/deepseek/claude
    display_name: varchar("display_name", { length: 100 }).notNull(), // 显示名称
    description: text("description"), // 描述
    // API 配置
    api_type: varchar("api_type", { length: 50 }).notNull().default("openai_compatible"), // openai_compatible / coze / anthropic / custom
    base_url: varchar("base_url", { length: 500 }).notNull(), // API 基础 URL
    api_key: varchar("api_key", { length: 500 }), // API Key（加密存储）
    // 模型配置
    models: jsonb("models").notNull().default(sql`'[]'`), // 可用模型列表
    default_model: varchar("default_model", { length: 100 }), // 默认模型
    // 功能支持
    supports_vision: boolean("supports_vision").notNull().default(false), // 是否支持视觉（多模态）
    supports_streaming: boolean("supports_streaming").notNull().default(true), // 是否支持流式输出
    max_context_tokens: integer("max_context_tokens"), // 最大上下文 Token 数
    // 认证配置（可选的额外配置）
    auth_config: jsonb("auth_config"), // 额外认证参数（如 organization, project 等）
    // 请求配置
    request_config: jsonb("request_config").notNull().default(sql`'{}'`), // 请求配置（超时、重试等）
    // 状态
    is_enabled: boolean("is_enabled").notNull().default(true), // 是否启用
    is_default: boolean("is_default").notNull().default(false), // 是否为默认提供商
    priority: integer("priority").notNull().default(0), // 优先级（数字越大优先级越高）
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("llm_providers_name_idx").on(table.name),
    index("llm_providers_enabled_idx").on(table.is_enabled),
    index("llm_providers_priority_idx").on(table.priority),
  ]
);

// ============================================
// LLM 模型表（关联到提供商）
// ============================================
export const llmModels = pgTable(
  "llm_models",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    // 关联到提供商
    provider_id: varchar("provider_id", { length: 36 }).notNull().references(() => llmProviders.id, { onDelete: "cascade" }),
    // 模型标识
    model_id: varchar("model_id", { length: 100 }).notNull(), // API 中的模型 ID
    display_name: varchar("display_name", { length: 100 }).notNull(), // 显示名称
    description: text("description"), // 模型描述
    // 模型能力
    type: varchar("type", { length: 50 }).notNull().default("chat"), // chat / embedding / vision / audio
    max_tokens: integer("max_tokens"), // 最大输出 Token
    // 功能支持
    supports_vision: boolean("supports_vision").notNull().default(false),
    supports_streaming: boolean("supports_streaming").notNull().default(true),
    supports_function_calling: boolean("supports_function_calling").notNull().default(false),
    // 性能参数
    default_temperature: doublePrecision("default_temperature").notNull().default(0.7),
    default_max_tokens: integer("default_max_tokens"), // 默认最大输出
    // 用途标记
    use_case: varchar("use_case", { length: 50 }).notNull().default("general"), // general / fast / quality / reasoning
    // 成本信息（可选）
    cost_per_1k_input: doublePrecision("cost_per_1k_input"), // 每 1000 输入 Token 成本
    cost_per_1k_output: doublePrecision("cost_per_1k_output"), // 每 1000 输出 Token 成本
    // 状态
    is_enabled: boolean("is_enabled").notNull().default(true),
    // 审计字段
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("llm_models_provider_idx").on(table.provider_id),
    index("llm_models_type_idx").on(table.type),
    index("llm_models_enabled_idx").on(table.is_enabled),
  ]
);
