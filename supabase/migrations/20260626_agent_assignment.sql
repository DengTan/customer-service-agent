-- 客服坐席分配配置与统计表
-- 创建时间: 2026-06-26
-- 描述: 坐席分配策略配置、店铺-坐席绑定、分配统计

-- ============================================
-- 表1: agent_assignment_config - 分配配置主表
-- ============================================
CREATE TABLE agent_assignment_config (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy VARCHAR(30) NOT NULL,  -- round_robin | load_balance | designated_shop
  name VARCHAR(100) NOT NULL,
  priority INT NOT NULL DEFAULT 0,  -- 多个规则时按优先级匹配
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  condition_config JSONB,  -- 条件配置（平台/店铺等）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX idx_agent_assignment_config_strategy ON agent_assignment_config(strategy);
CREATE INDEX idx_agent_assignment_config_is_enabled ON agent_assignment_config(is_enabled);
CREATE INDEX idx_agent_assignment_config_priority ON agent_assignment_config(priority DESC);

-- ============================================
-- 表2: agent_assignment_stats - 分配统计表
-- ============================================
CREATE TABLE agent_assignment_stats (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,  -- 按天统计
  assigned_count INT NOT NULL DEFAULT 0,  -- 今日分配次数
  active_conversations INT NOT NULL DEFAULT 0,  -- 当前活跃会话数（需同步维护）
  completed_count INT NOT NULL DEFAULT 0,  -- 今日已完成会话数
  last_assigned_at TIMESTAMPTZ,  -- 上次分配时间（用于轮询）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_agent_assignment_stats_user_date ON agent_assignment_stats(user_id, date);
CREATE INDEX idx_agent_assignment_stats_active_conversations ON agent_assignment_stats(active_conversations);

-- ============================================
-- 表3: shop_agent_bindings - 店铺-坐席绑定表
-- ============================================
CREATE TABLE shop_agent_bindings (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id VARCHAR(36) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 0,  -- 同一店铺多个坐席时按优先级
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, user_id)
);

CREATE INDEX idx_shop_agent_bindings_shop ON shop_agent_bindings(shop_id);
CREATE INDEX idx_shop_agent_bindings_user ON shop_agent_bindings(user_id);
CREATE INDEX idx_shop_agent_bindings_shop_enabled ON shop_agent_bindings(shop_id, is_enabled) WHERE is_enabled = true;

-- ============================================
-- 注释说明
-- ============================================
COMMENT ON TABLE agent_assignment_config IS '坐席分配策略配置表';
COMMENT ON COLUMN agent_assignment_config.strategy IS '分配策略: round_robin(轮询), load_balance(负载均衡), designated_shop(指定店铺)';
COMMENT ON COLUMN agent_assignment_config.condition_config IS '条件配置JSON: {platforms: [], shops: [], skill_groups: []}';

COMMENT ON TABLE agent_assignment_stats IS '坐席分配统计表(按天)';
COMMENT ON COLUMN agent_assignment_stats.assigned_count IS '今日分配给该坐席的总次数';
COMMENT ON COLUMN agent_assignment_stats.active_conversations IS '当前正在接待的会话数,需在accept/resolve/transfer时同步更新';
COMMENT ON COLUMN agent_assignment_stats.completed_count IS '今日该坐席已完成的会话数';

COMMENT ON TABLE shop_agent_bindings IS '店铺与坐席的绑定关系表(用于指定店铺分配策略)';
COMMENT ON COLUMN shop_agent_bindings.priority IS '同一店铺有多个坐席时,按priority升序分配';
