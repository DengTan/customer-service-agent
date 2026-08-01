-- 2026-08-01
-- 为 ticket_status_log 添加 (to_status) 和 (created_at) 索引
-- 业务背景: analytics 首响时长统计 WHERE to_status='in_progress' AND created_at>=?
--           现有索引仅 ticket_id, 大数据量下全表扫描
CREATE INDEX IF NOT EXISTS ticket_status_log_to_status_idx
  ON public.ticket_status_log USING btree (to_status);

CREATE INDEX IF NOT EXISTS ticket_status_log_created_at_idx
  ON public.ticket_status_log USING btree (created_at);
