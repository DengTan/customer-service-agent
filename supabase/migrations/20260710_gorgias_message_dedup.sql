-- 为 messages 表中 metadata->>'gorgias_message_id' 添加唯一索引
-- 防止同一条 Gorgias 消息被重复插入（TOCTOU 竞态保护）

-- 先清理已有的重复数据：保留每组 gorgias_message_id 中最早插入的记录
-- 仅针对 metadata 中包含 gorgias_message_id 的消息
DELETE FROM messages m1
USING messages m2
WHERE m1.metadata->>'gorgias_message_id' IS NOT NULL
  AND m1.metadata->>'gorgias_message_id' = m2.metadata->>'gorgias_message_id'
  AND m1.id > m2.id;

-- 创建表达式唯一索引
-- 仅对 metadata->>'gorgias_message_id' 非 NULL 的行生效（WHERE 子句过滤）
CREATE UNIQUE INDEX IF NOT EXISTS messages_gorgias_message_id_unique_idx
  ON messages ((metadata->>'gorgias_message_id'))
  WHERE metadata->>'gorgias_message_id' IS NOT NULL;
