-- =============================================================================
-- SmartAssist 数据库安全加固：启用 RLS + 收紧对象权限
-- 项目: avmregjnnsmshwxrwjie (remote Supabase)
-- 日期: 2026-07-13
-- 执行人: MCP user-supabase execute_sql
--
-- 策略前提
-- ----------
-- 应用层统一使用 service_role key（见 src/storage/database/supabase-client.ts）
-- 调用所有查询和 RPC。service_role 默认 BYPASSES RLS。
-- 因此启用 RLS 不会破坏应用功能，反而是必要的防御层。
--
-- 加固原则
-- ----------
-- 1. ENABLE ROW LEVEL SECURITY — 双重屏障之一
--    即使 anon/authenticated 持有对象权限，RLS 仍可限制行级访问。
--    service_role 不受影响（bypass RLS），应用层保持正常。
--
-- 2. REVOKE ALL ON TABLE ... FROM anon, authenticated — 双重屏障之二
--    撤销对象权限，即使 RLS 被误关闭，PostgREST 也会直接拒绝访问。
--    这是一种"纵深防御"策略：两道防线，任一失效另一道仍生效。
--
-- 3. FORCE ROW LEVEL SECURITY — 不使用
--    FORCE 会让表 owner（postgres）也受限，可能影响 Supabase 内部运维操作。
--    最小权限原则，默认只 ENABLE。
--
-- 4. settings 表 — 由另一任务负责，跳过
--
-- 5. RPC 函数 — 由另一任务处理，不修改
--
-- 6. Storage bucket — 由另一任务处理，不修改
--
-- 执行批次
-- ----------
-- Batch 1: 最高危 — 凭据与认证 (users, shop_agent_accounts, login_events,
--           llm_providers, platform_connections, role_permissions)
-- Batch 2: 高危 — 对话与客户隐私 (messages, conversations, customers,
--           customer_conversations, agent_sessions, agent_queue, shop_agent_bindings)
-- Batch 3: 中危 — 业务规则与运营 (bot_configs, routing_rules, auto_reply_rules,
--           quick_replies, skill_groups, schedules, alerts, agent_assignment_config,
--           agent_assignment_stats, tickets, ticket_comments, ticket_status_log,
--           conversation_tags_def, conversation_tag_records, customer_tags,
--           quality_rules, quality_checks, agent_collaborations, agent_delegations)
-- Batch 4: 低危 — 内容资产/统计/日志 (knowledge_*, marketing_*, push_*,
--           product_details, size_charts, webhook_event_processed,
--           simulation_*, content_*, allowed_domains, health_check, llm_models, shops)
--
-- 幂等性说明
-- ----------
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY — 幂等（重复执行无效果）
-- REVOKE ALL ON TABLE ... FROM anon, authenticated — 幂等（重复执行无效果）
-- 所有语句均可安全重复执行。
-- =============================================================================


-- =============================================================================
-- PHASE 1: 最高危 — 凭据与认证
-- =============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_agent_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE shop_agent_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE login_events FROM anon, authenticated;
REVOKE ALL ON TABLE llm_providers FROM anon, authenticated;
REVOKE ALL ON TABLE platform_connections FROM anon, authenticated;
REVOKE ALL ON TABLE role_permissions FROM anon, authenticated;


-- =============================================================================
-- PHASE 2: 高危 — 对话与客户隐私
--
-- 注意: shop_agent_bindings 已有 "Allow all for authenticated users" policy，
-- 但原 RLS 关闭故 policy 不生效。启用 RLS 后 policy 生效（authenticated 全量访问）。
-- 因此同时 REVOKE，使 authenticated 也必须通过 service_role 访问（双保险）。
-- =============================================================================

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_agent_bindings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE messages FROM anon, authenticated;
REVOKE ALL ON TABLE conversations FROM anon, authenticated;
REVOKE ALL ON TABLE customers FROM anon, authenticated;
REVOKE ALL ON TABLE customer_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE agent_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE agent_queue FROM anon, authenticated;
REVOKE ALL ON TABLE shop_agent_bindings FROM anon, authenticated;


-- =============================================================================
-- PHASE 3: 中危 — 业务规则与运营
--
-- 注意: agent_assignment_config 和 agent_assignment_stats 已有
-- "Allow all for authenticated users" policy，启用 RLS 后 policy 生效，
-- 但 REVOKE 让 authenticated 也必须走 service_role，双保险。
-- =============================================================================

ALTER TABLE bot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_reply_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_assignment_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_assignment_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tags_def ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_tag_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_collaborations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_delegations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE bot_configs FROM anon, authenticated;
REVOKE ALL ON TABLE routing_rules FROM anon, authenticated;
REVOKE ALL ON TABLE auto_reply_rules FROM anon, authenticated;
REVOKE ALL ON TABLE quick_replies FROM anon, authenticated;
REVOKE ALL ON TABLE skill_groups FROM anon, authenticated;
REVOKE ALL ON TABLE schedules FROM anon, authenticated;
REVOKE ALL ON TABLE alerts FROM anon, authenticated;
REVOKE ALL ON TABLE agent_assignment_config FROM anon, authenticated;
REVOKE ALL ON TABLE agent_assignment_stats FROM anon, authenticated;
REVOKE ALL ON TABLE tickets FROM anon, authenticated;
REVOKE ALL ON TABLE ticket_comments FROM anon, authenticated;
REVOKE ALL ON TABLE ticket_status_log FROM anon, authenticated;
REVOKE ALL ON TABLE conversation_tags_def FROM anon, authenticated;
REVOKE ALL ON TABLE conversation_tag_records FROM anon, authenticated;
REVOKE ALL ON TABLE customer_tags FROM anon, authenticated;
REVOKE ALL ON TABLE quality_rules FROM anon, authenticated;
REVOKE ALL ON TABLE quality_checks FROM anon, authenticated;
REVOKE ALL ON TABLE agent_collaborations FROM anon, authenticated;
REVOKE ALL ON TABLE agent_delegations FROM anon, authenticated;


-- =============================================================================
-- PHASE 4: 低危 — 内容资产/统计/日志
--
-- 注意:
-- - simulation_evaluations 和 test_cases 已启用 RLS 但无 policy，
--   导致所有访问被拒绝（包括 service_role）。REVOKE 让 service_role 可访问。
-- - health_check 和 allowed_domains 可能是运维用途，但仍按最小权限收紧。
-- =============================================================================

ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_gap_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_learning_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE size_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE size_chart_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_event_processed ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_filter_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_sensitive_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE allowed_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE knowledge_items FROM anon, authenticated;
REVOKE ALL ON TABLE knowledge_chunks FROM anon, authenticated;
REVOKE ALL ON TABLE knowledge_versions FROM anon, authenticated;
REVOKE ALL ON TABLE knowledge_import_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE knowledge_feedback FROM anon, authenticated;
REVOKE ALL ON TABLE knowledge_gap_signals FROM anon, authenticated;
REVOKE ALL ON TABLE knowledge_learning_queue FROM anon, authenticated;
REVOKE ALL ON TABLE marketing_campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE marketing_logs FROM anon, authenticated;
REVOKE ALL ON TABLE push_templates FROM anon, authenticated;
REVOKE ALL ON TABLE push_records FROM anon, authenticated;
REVOKE ALL ON TABLE push_event_log FROM anon, authenticated;
REVOKE ALL ON TABLE product_details FROM anon, authenticated;
REVOKE ALL ON TABLE size_charts FROM anon, authenticated;
REVOKE ALL ON TABLE size_chart_versions FROM anon, authenticated;
REVOKE ALL ON TABLE webhook_event_processed FROM anon, authenticated;
REVOKE ALL ON TABLE simulation_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE simulation_messages FROM anon, authenticated;
REVOKE ALL ON TABLE content_filter_logs FROM anon, authenticated;
REVOKE ALL ON TABLE content_sensitive_words FROM anon, authenticated;
REVOKE ALL ON TABLE allowed_domains FROM anon, authenticated;
REVOKE ALL ON TABLE health_check FROM anon, authenticated;
REVOKE ALL ON TABLE llm_models FROM anon, authenticated;
REVOKE ALL ON TABLE shops FROM anon, authenticated;


-- =============================================================================
-- PHASE 5: 补全 — simulation_evaluations 和 test_cases 剩余权限
--
-- 这两张表已启用 RLS 但无 policy，导致所有访问被拒绝（包括 service_role）。
-- REVOKE 让 service_role 可访问（通过 bypass RLS）。
-- 注意：REVOKE SELECT/INSERT/UPDATE/DELETE 需要单独显式指定（不在 ALL 范围内）。
-- =============================================================================

REVOKE SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE simulation_evaluations FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON TABLE test_cases FROM anon, authenticated;
