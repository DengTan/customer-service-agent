-- 客户标签计数同步机制
-- 当客户的 tags 数组添加/删除标签时，自动更新 customer_tags 表中对应标签的 customer_count 字段

-- 批量更新多个标签的计数
CREATE OR REPLACE FUNCTION update_customer_tag_counts_batch(tag_names text[])
RETURNS void AS $$
DECLARE
  tag_name text;
BEGIN
  FOREACH tag_name IN ARRAY tag_names
  LOOP
    UPDATE customer_tags
    SET customer_count = (
      SELECT COUNT(*)
      FROM customers,
      LATERAL (SELECT unnest(tags) AS name) t
      WHERE t.name = customer_tags.name
    )
    WHERE customer_tags.name = tag_name;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 从所有客户的 tags 数组中移除指定标签
CREATE OR REPLACE FUNCTION remove_tag_from_customers(tag_name text)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET tags = array_remove(tags, tag_name),
      updated_at = NOW()
  WHERE tag_name = ANY(tags);
END;
$$ LANGUAGE plpgsql;

-- 为已有标签初始化计数
UPDATE customer_tags tc
SET customer_count = (
  SELECT COUNT(*)
  FROM customers,
  LATERAL (SELECT unnest(tags) AS name) t
  WHERE t.name = tc.name
);
