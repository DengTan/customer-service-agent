-- 原子自增客户对话计数 + 更新最后活跃时间
-- 通过行级锁保证并发安全
CREATE OR REPLACE FUNCTION increment_customer_conversation_count(p_customer_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET conversation_count = conversation_count + 1,
      last_seen_at = NOW(),
      updated_at = NOW()
  WHERE id = p_customer_id;
END;
$$ LANGUAGE plpgsql;
