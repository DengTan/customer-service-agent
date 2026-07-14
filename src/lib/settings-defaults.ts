/**
 * 系统设置出厂默认值（客户端安全版本）
 *
 * ⚠️  此文件可被服务端与客户端代码同时导入（无 React / 浏览器 API 依赖）。
 *
 *    `system_prompt` 不在此常量中 —— 完整的 LLM 系统提示词属于服务端隐私，
 *    已隔离至 `server-only-settings-defaults.ts`。
 *    客户端 UI 若需 system_prompt 默认值，单独导入 `DEFAULT_SYSTEM_PROMPT` 即可。
 *
 * ─── 修改默认值后必须同步的文件 ───────────────────────────────────────────
 *
 * 下游消费者地图（按文件分组，维护者 grep 可定位）：
 *
 * API 层（写入/读取 settings 表）：
 *   welcome_message          → conversations/route.ts l.69
 *   new_conversation_notify  → conversations/route.ts l.79
 *   rating_enabled           → conversations/[id]/rating/route.ts l.19
 *   session_timeout / max_turns / unhandled_remind
 *                            → conversations/[id]/messages/route.ts l.204,221,246
 *                            → server/services/background-scheduler-service.ts l.91
 *   ai_model / llm_provider  → conversations/[id]/messages/route.ts l.168,454
 *                              simulations/[id]/messages/route.ts l.238,303
 *   multimodal_* / ai_*    → conversations/[id]/messages/route.ts l.452-461
 *   ai_max_concurrent       → conversations/[id]/messages/route.ts l.144
 *   session_timeout / max_turns / unhandled_remind
 *                            → conversations/[id]/messages/route.ts l.204,221,246
 *   url_filter_mode / sensitive_word_default_action
 *                            → admin/migrate/route.ts l.94-95,138-139
 *
 * Service 层（消费 settings 表）：
 *   alert_confidence* / alert_high_rounds* / alert_auto_handoff_rounds
 *                            → server/services/alert-service.ts l.120-124
 *   knowledge_min_score / knowledge_search_limit / knowledge_image_search_limit
 *                            → server/services/knowledge-search-service.ts l.95-97
 *   knowledge_smart_chunking_enabled / knowledge_chunk_size / knowledge_chunk_overlap
 *                            → server/services/smart-chunking-service.ts
 *   content_filter_enabled / sensitive_word_* / url_filter_*
 *                            → server/services/content-filter-service.ts l.90-135
 *   knowledge_learning_confidence_threshold / knowledge_learning_scan_interval_hours
 *                            → server/services/knowledge-learning-service.ts l.76,97
 *   max_main_bots           → server/services/sub-agent-service.ts l.85
 *   system_prompt           → server/services/llm-streaming-service.ts l.50,772
 *                            → server/services/gorgias-sync-service.ts l.1425
 *   ai_model / ai_temperature / ai_max_tokens / ai_model_enabled
 *                            → server/services/gorgias-sync-service.ts l.1422-1427
 *
 * 前端 UI（仅展示/编辑，不涉及业务逻辑）：
 *   welcome_message          → components/settings/chat-settings.tsx l.57
 *   ai_max_concurrent       → components/settings/ai-settings.tsx l.253,259,260
 *   ai_temperature / ai_max_tokens / ai_model_enabled
 *                            → components/settings/ai-settings.tsx l.45-241
 *   alert_confidence* / alert_high_rounds*
 *                            → components/settings/settings-page.tsx l.118-121
 *   system_prompt           → components/settings/ai-settings.tsx l.351-352
 *   theme / font_size / show_timestamps / compact_mode
 *                            → components/settings/appearance-settings.tsx
 *                            → lib/theme-settings-context.tsx l.38-41
 *
 * Demo 数据（仅 demo 模式下生效）：
 *   ai_model / ai_model_enabled / multimodal_* / llm_provider_id
 *                            → server/repositories/demo-data/demo-settings.ts
 *
 * ⚠️  新增 key 时：必须在此处添加一行，否则未来维护者会漏掉同步。
 *
 * ⚠️  content_filter / sensitive_word_* / url_filter_* 等键同时存在于
 *    migration (`20260726_content_security_filter.sql`) 和此处。
 *    迁移脚本负责已有环境的初始化；此处负责新部署时的首次 seeding。
 *    `upsertMany` 使用 `ON CONFLICT DO UPDATE`，以 FACTORY_DEFAULTS 为权威。
 */

export const FACTORY_DEFAULTS: Record<string, string> = {
  // —— 对话控制 ——
  welcome_message: '您好！欢迎使用 SmartAssist 智能客服，请问有什么可以帮助您的？',
  session_timeout: '30',
  max_turns: '20',
  rating_enabled: 'true',
  new_conversation_notify: 'true',
  // unhandled_remind split into separate enabled + minutes keys (2026-07-13)
  // to fix the boolean-as-minutes parse bug. The legacy `unhandled_remind` key
  // is left inert: legacy rows in the DB are no longer consulted.
  unhandled_remind_enabled: 'true',
  unhandled_remind_minutes: '30',

  // —— 告警阈值 ——
  alert_confidence_threshold: '0.4',
  alert_confidence_critical_threshold: '0.2',
  alert_high_rounds_threshold: '10',
  alert_high_rounds_critical_threshold: '15',
  alert_auto_handoff_rounds: '6',

  // —— AI 模型 ——
  ai_model_enabled: 'true',
  ai_model: 'doubao-seed-2-0-lite-260215',
  llm_provider_id: 'coze',
  multimodal_enabled: 'true',
  multimodal_model: 'doubao-seed-2-0-pro-260215',
  multimodal_disabled_action: 'fixed_message',
  multimodal_fixed_message: '抱歉，当前未开启图片识别功能，无法识别您发送的图片。如需帮助，请转接人工客服或以文字描述您的问题。',
  ai_temperature: '0.7',
  ai_max_tokens: '2048',
  ai_max_concurrent: '0',

  // —— 知识检索 ——
  knowledge_min_score: '0.75',
  knowledge_search_limit: '5',
  knowledge_image_search_limit: '3',

  // —— 知识库分段 ——
  knowledge_smart_chunking_enabled: 'true',
  knowledge_chunk_size: '500',
  knowledge_chunk_overlap: '50',

  // —— 内容安全过滤（由 20260726_content_security_filter.sql 补充，下方为默认配置） ——
  content_filter_enabled: 'true',
  sensitive_word_filter_enabled: 'true',
  url_filter_enabled: 'true',
  url_filter_mode: 'whitelist',
  sensitive_word_default_action: 'block',
  sensitive_word_block_message: '您的消息包含不合规内容，请修改后再试。',
  sensitive_word_warn_message: '提示：消息中包含可能不合适的敏感词',
  url_block_message: '抱歉,发送的链接不在白名单范围内',

  // —— 知识自学习 ——
  knowledge_learning_confidence_threshold: '0.85',
  knowledge_learning_scan_interval_hours: '24',
  knowledge_learning_auto_scan_enabled: 'false',

  // —— 外观 / 前端 ——
  theme: 'system',
  font_size: '14',
  show_timestamps: 'true',
  compact_mode: 'false',

  // —— Bot 配额 ——
  max_main_bots: '10',
};

// Export DEFAULT_SYSTEM_PROMPT separately so client code can still import it
// for the AI settings UI (ai-settings.tsx uses DEFAULT_SYSTEM_PROMPT as fallback).
export const DEFAULT_SYSTEM_PROMPT = `你是 SmartAssist 智能客服助手，专注于为用户提供专业、准确、友好的客户服务。

核心职责：
1. 回答用户关于产品、订单、退换货、支付等常见问题
2. 根据知识库内容提供准确信息，并在回复中标注引用来源
3. 引导用户完成相关操作流程
4. 遇到无法解决的问题时，建议转接人工客服

对话原则：
- 语气友好专业，简洁明了
- 优先使用知识库中的信息回答问题
- 如果知识库中没有相关内容，诚实告知并建议其他获取帮助的途径
- 多轮对话中记住上下文，保持连贯性
- 当用户表达不满时，先表示理解再提供解决方案

回复格式：
- 如果引用了知识库信息，在回复末尾用【引用来源：xxx】标注
- 分步骤说明时使用编号列表
- 关键信息使用加粗标记`;