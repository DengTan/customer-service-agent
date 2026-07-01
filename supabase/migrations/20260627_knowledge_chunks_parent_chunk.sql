-- ============================================
-- 知识库 Chunks 父子分片支持
-- 2026-06-27
-- ============================================

-- 检查 knowledge_chunks 表是否存在
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'knowledge_chunks'
    ) THEN
        -- 创建 knowledge_chunks 表
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
            id VARCHAR(100) PRIMARY KEY,
            knowledge_item_id VARCHAR(36) NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            content_hash VARCHAR(64) NOT NULL,
            doc_id VARCHAR(100),
            version_added INTEGER DEFAULT 1,
            version_removed INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            -- 父子分片支持
            parent_chunk_id VARCHAR(100),
            chunk_level VARCHAR(10) DEFAULT 'child', -- child, parent
            doc_type VARCHAR(20) -- pdf, docx, url, text, image
        );

        CREATE INDEX IF NOT EXISTS kc_knowledge_item_id_idx ON knowledge_chunks(knowledge_item_id);
        CREATE INDEX IF NOT EXISTS kc_parent_chunk_id_idx ON knowledge_chunks(parent_chunk_id)
            WHERE parent_chunk_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS kc_level_idx ON knowledge_chunks(chunk_level);
        CREATE INDEX IF NOT EXISTS kc_doc_type_idx ON knowledge_chunks(doc_type);
    ELSE
        -- 表已存在，添加缺失的列
        ALTER TABLE knowledge_chunks
        ADD COLUMN IF NOT EXISTS parent_chunk_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS chunk_level VARCHAR(10) DEFAULT 'child',
        ADD COLUMN IF NOT EXISTS doc_type VARCHAR(20);

        -- 添加索引（如果不存在）
        CREATE INDEX IF NOT EXISTS kc_parent_chunk_id_idx ON knowledge_chunks(parent_chunk_id)
            WHERE parent_chunk_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS kc_level_idx ON knowledge_chunks(chunk_level);
    END IF;
END $$;

-- 添加注释
COMMENT ON TABLE knowledge_chunks IS '知识库文本分片表，支持父子分片架构';
COMMENT ON COLUMN knowledge_chunks.parent_chunk_id IS '父分片ID，NULL表示顶层分片';
COMMENT ON COLUMN knowledge_chunks.chunk_level IS '分片层级：child(子分片用于检索) / parent(父分片返回给LLM)';
COMMENT ON COLUMN knowledge_chunks.doc_type IS '文档类型：pdf, docx, url, text, image';
