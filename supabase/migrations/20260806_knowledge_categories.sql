-- 知识库分类系统（平铺结构，无层级）
-- 创建时间: 2026-08-06

-- 1. 创建分类表
CREATE TABLE IF NOT EXISTS knowledge_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  color VARCHAR(20) DEFAULT '#6366f1',
  sort_order INTEGER DEFAULT 0,
  description TEXT,
  item_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ
);

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_knowledge_categories_sort_order ON knowledge_categories(sort_order);
CREATE INDEX IF NOT EXISTS idx_knowledge_categories_name ON knowledge_categories(name);

-- 3. 在 knowledge_items 表中添加 category_id 字段
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL;

-- 4. 创建索引
CREATE INDEX IF NOT EXISTS idx_knowledge_items_category_id ON knowledge_items(category_id);

-- 5. RPC 函数：增量更新分类计数
CREATE OR REPLACE FUNCTION increment_knowledge_category_count(cat_id UUID, delta INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE knowledge_categories
  SET item_count = GREATEST(0, item_count + delta)
  WHERE id = cat_id;
END;
$$ LANGUAGE plpgsql;

-- 6. 初始化默认分类
INSERT INTO knowledge_categories (name, color, sort_order, description) VALUES
  ('产品相关', '#6366f1', 1, '产品介绍、功能说明等'),
  ('物流相关', '#8b5cf6', 2, '物流查询、发货时间等'),
  ('售后相关', '#ec4899', 3, '退换货、维修等'),
  ('支付相关', '#f97316', 4, '支付方式、订单问题等')
ON CONFLICT (name) DO NOTHING;
