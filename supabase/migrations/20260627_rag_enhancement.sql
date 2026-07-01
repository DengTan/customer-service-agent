-- ============================================
-- 知识库检索增强：BM25 + 评估体系
-- 2026-06-27
-- ============================================

-- 1. Q&A 测试集表 - 用于评估检索质量
CREATE TABLE IF NOT EXISTS knowledge_qa_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL,
    expected_answer TEXT,
    category VARCHAR(100) DEFAULT '未分类',
    difficulty VARCHAR(20) DEFAULT 'medium', -- easy, medium, hard
    test_set VARCHAR(50) DEFAULT 'default', -- default, regression, spot_check
    metadata JSONB DEFAULT '{}',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kqat_category_idx ON knowledge_qa_tests(category);
CREATE INDEX IF NOT EXISTS kqat_test_set_idx ON knowledge_qa_tests(test_set);
CREATE INDEX IF NOT EXISTS kqat_difficulty_idx ON knowledge_qa_tests(difficulty);

-- 2. 检索评估日志表 - 记录每次检索的评估结果
CREATE TABLE IF NOT EXISTS retrieval_evaluation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qa_test_id UUID REFERENCES knowledge_qa_tests(id) ON DELETE SET NULL,
    query TEXT NOT NULL,
    top_k INTEGER NOT NULL DEFAULT 5,
    -- 检索结果
    retrieved_ids JSONB NOT NULL DEFAULT '[]', -- 检索返回的知识条目ID列表
    retrieved_scores JSONB NOT NULL DEFAULT '[]', -- 对应分数
    retrieved_contents JSONB NOT NULL DEFAULT '[]', -- 对应内容片段
    -- 评估指标
    recall_at_k DOUBLE PRECISION, -- Recall@K
    mrr DOUBLE PRECISION, -- Mean Reciprocal Rank
    ndcg_at_k DOUBLE PRECISION, -- Normalized Discounted Cumulative Gain
    precision_at_k DOUBLE PRECISION, -- Precision@K
    -- Rerank 前后对比
    rerank_improvement DOUBLE PRECISION, -- Rerank 后 MRR 提升百分比
    -- 混合检索 vs 纯向量对比
    hybrid_vs_vector_mrr_improvement DOUBLE PRECISION, -- 混合检索 vs 纯向量 MRR 提升
    -- 配置快照
    config_snapshot JSONB DEFAULT '{}',
    -- 执行信息
    execution_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reval_qa_test_id_idx ON retrieval_evaluation_logs(qa_test_id);
CREATE INDEX IF NOT EXISTS reval_created_at_idx ON retrieval_evaluation_logs(created_at);
CREATE INDEX IF NOT EXISTS reval_recall_at_k_idx ON retrieval_evaluation_logs(recall_at_k);
CREATE INDEX IF NOT EXISTS reval_mrr_idx ON retrieval_evaluation_logs(mrr);

-- 3. 检索配置表 - 管理混合检索参数
CREATE TABLE IF NOT EXISTS retrieval_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value JSONB NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 默认配置
INSERT INTO retrieval_configs (config_key, config_value, description, is_active)
VALUES (
    'default',
    '{
        "vector_weight": 0.6,
        "bm25_weight": 0.4,
        "rerank_enabled": true,
        "rerank_top_n": 5,
        "rerank_model": "bge-reranker-v2-m3",
        "vector_top_k": 20,
        "bm25_top_k": 20,
        "rrf_k": 60,
        "min_score_threshold": 0.75,
        "parent_chunk_enabled": false
    }'::jsonb,
    '默认检索配置：向量60% + BM25 40%，启用 Rerank',
    true
) ON CONFLICT (config_key) DO NOTHING;

-- 4. 为 knowledge_items 添加全文搜索索引（支持中文分词）
-- 使用 pg_trgm 配合 gin 索引实现模糊全文搜索
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建 gin trigram 索引用于模糊搜索
CREATE INDEX IF NOT EXISTS knowledge_items_content_gin_idx
ON knowledge_items
USING gin (content gin_trgm_ops)
WHERE content IS NOT NULL;

-- 创建 gin trigram 索引用于名称搜索
CREATE INDEX IF NOT EXISTS knowledge_items_name_gin_idx
ON knowledge_items
USING gin (name gin_trgm_ops)
WHERE name IS NOT NULL;

-- 创建 btree 索引用于精确分类过滤
CREATE INDEX IF NOT EXISTS knowledge_items_status_category_idx
ON knowledge_items(status, category)
WHERE status = 'active';

-- 5. knowledge_chunks 表增加父子分片支持
-- 注意：已在现有 schema 中添加 parent_chunk_id 字段的逻辑，此处添加物理列
ALTER TABLE knowledge_chunks
ADD COLUMN IF NOT EXISTS parent_chunk_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS chunk_level VARCHAR(10) DEFAULT 'child', -- child, parent
ADD COLUMN IF NOT EXISTS doc_type VARCHAR(20); -- pdf, docx, url, text, image

CREATE INDEX IF NOT EXISTS kc_parent_chunk_id_idx ON knowledge_chunks(parent_chunk_id)
WHERE parent_chunk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kc_level_idx ON knowledge_chunks(chunk_level);

-- 6. 检索统计表 - 聚合检索效果指标
CREATE TABLE IF NOT EXISTS retrieval_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stat_date DATE NOT NULL,
    stat_hour INTEGER, -- 0-23, NULL 表示全天统计
    config_id UUID,
    -- 检索量统计
    total_queries INTEGER NOT NULL DEFAULT 0,
    queries_with_results INTEGER NOT NULL DEFAULT 0, -- 有结果的查询数
    queries_no_results INTEGER NOT NULL DEFAULT 0, -- 无结果的查询数
    -- 效果指标（加权平均）
    avg_recall_at_5 DOUBLE PRECISION,
    avg_mrr DOUBLE PRECISION,
    avg_ndcg_at_5 DOUBLE PRECISION,
    avg_precision_at_5 DOUBLE PRECISION,
    -- Rerank 效果
    avg_rerank_improvement DOUBLE PRECISION,
    -- 混合检索效果
    avg_hybrid_vs_vector_improvement DOUBLE PRECISION,
    -- 延迟统计
    avg_execution_time_ms DOUBLE PRECISION,
    p99_execution_time_ms DOUBLE PRECISION,
    -- 知识库覆盖率
    knowledge_items_covered INTEGER NOT NULL DEFAULT 0, -- 被检索到的知识条目数
    knowledge_items_total INTEGER NOT NULL DEFAULT 0, -- 知识库总条目数
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS rs_date_hour_config_idx
ON retrieval_stats(stat_date, stat_hour, config_id)
WHERE config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rs_stat_date_idx ON retrieval_stats(stat_date);

COMMENT ON TABLE knowledge_qa_tests IS 'Q&A 测试集，用于评估检索质量和建立基线';
COMMENT ON TABLE retrieval_evaluation_logs IS '检索评估日志，记录每次检索的评估指标';
COMMENT ON TABLE retrieval_configs IS '检索配置：混合权重、Rerank 参数、Top-K 等';
COMMENT ON TABLE retrieval_stats IS '检索统计聚合表，支持按日期/配置维度分析检索效果';
