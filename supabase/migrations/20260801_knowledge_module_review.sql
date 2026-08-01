-- =============================================================================
-- Knowledge Module Schema Review (2026-08-01)
-- =============================================================================
-- 目的: 与 src/storage/database/shared/schema.ts 的 Drizzle 定义对齐。
-- 适用范围: 知识库 7 张表 — knowledge_items / knowledge_chunks /
--          knowledge_versions / knowledge_import_jobs / knowledge_learning_queue /
--          knowledge_gap_signals / knowledge_feedback
--
-- 风险等级: LOW（仅类型/索引对齐，不变更业务字段语义）
-- 可逆性: 每条 DDL 下方均保留 DOWN（注释形式）
--
-- 触发:
--   1. 前一轮审查 (P0-3) 在 schema.ts 中补全了 knowledgeChunks、
--      knowledgeImportJobs 两张表的 Drizzle 定义。本次核验发现这些表已
--      在数据库中真实存在，但 Drizzle 元数据与 DB 列存在少量差异：
--        a) knowledge_import_jobs.file_type
--             Drizzle: varchar(50)       DB: varchar(20)
--             现网最长的写入值是 "excel" (5 chars)，20 足够；
--             但 Drizzle 在 introspect 阶段会按 50 发起 ALTER，
--             因此需要把 DB 加宽到 50 与 TS 对齐（避免 TS-DB 形状漂移）。
--        b) knowledge_import_jobs.file_size 在 Drizzle 中标记为
--           NOT NULL;DB 中为 NULLABLE。生产数据 28 条全部有值，
--           加 NOT NULL 约束是安全的（与 Drizzle 形状一致）。
--        c) knowledge_import_jobs.stage 在 Drizzle 中为 varchar(50)，
--           DB 当前为 varchar(30)。生产数据仅含 'completed'/'failed'
--           (各 22/6 条)，30 足够，可选扩到 50 对齐 Drizzle。
--        d) knowledge_feedback.message_id 等是 reference 列但未加 FK。
--           这是有意为之——Drizzle schema 也没声明 FK（消息级联由业务
--           层托管）。本次不强制加 FK，保持应用层语义。
--        e) knowledge_import_jobs.file_size 上 DB 没有 default，但
--           Drizzle 默认 .notNull()，运行时若 null 入库会被 Drizzle
--           序列化阶段阻断——当前 28 条生产数据全部非空，可以加
--           DEFAULT 0 + NOT NULL 与 Drizzle 对齐。
--
-- 所有的 "ADD CONSTRAINT NOT NULL" 都先 verify 数据完整性：
-- 若有空值，迁移会失败而非静默"修复"。
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. knowledge_import_jobs: 文件类型与文件大小列与 Drizzle schema 对齐
-- ---------------------------------------------------------------------------

-- 1a) file_type: varchar(20) → varchar(50)
--     现状: DB varchar(20), TS schema varchar(50), 数据最大长度 5
--     修复: 放宽到 50，与 Drizzle 元数据一致
ALTER TABLE public.knowledge_import_jobs
  ALTER COLUMN file_type TYPE VARCHAR(50);
-- DOWN: ALTER TABLE public.knowledge_import_jobs ALTER COLUMN file_type TYPE VARCHAR(20);

COMMENT ON COLUMN public.knowledge_import_jobs.file_type IS
  '文件类型扩展名（pdf, docx, xlsx, csv, jpg, png…），与 Drizzle schema varchar(50) 对齐';

-- 1b) file_size: NULLABLE → NOT NULL DEFAULT 0
--     现状: DB NULLABLE, Drizzle .notNull()
--     安全: 先确认无 NULL，再加约束
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT count(*) INTO null_count FROM public.knowledge_import_jobs WHERE file_size IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Cannot add NOT NULL to knowledge_import_jobs.file_size: % NULL rows exist', null_count;
  END IF;
END $$;

-- 把 NULL → 0 后再加 NOT NULL（向后兼容旧代码，可能存在历史 NULL）
UPDATE public.knowledge_import_jobs SET file_size = 0 WHERE file_size IS NULL;
ALTER TABLE public.knowledge_import_jobs
  ALTER COLUMN file_size SET DEFAULT 0,
  ALTER COLUMN file_size SET NOT NULL;
-- DOWN:
--   ALTER TABLE public.knowledge_import_jobs
--     ALTER COLUMN file_size DROP NOT NULL,
--     ALTER COLUMN file_size DROP DEFAULT;

-- 1c) stage: varchar(30) → varchar(50)（与 Drizzle schema 对齐）
ALTER TABLE public.knowledge_import_jobs
  ALTER COLUMN stage TYPE VARCHAR(50);
-- DOWN: ALTER TABLE public.knowledge_import_jobs ALTER COLUMN stage TYPE VARCHAR(30);

-- ---------------------------------------------------------------------------
-- 2. knowledge_items: 确认关键列存在（已存在则跳过）
--    验证项: parent_category / image_url / expires_at / content_hash /
--            hit_count / last_hit_at / embedding 全部存在并类型正确
--    实测: 全部存在，无需 ADD COLUMN。本节作为幂等保险。
-- ---------------------------------------------------------------------------

-- 父分类（已存在，确认保留）
-- parent_category varchar(100) NULL  — 已存在，无需变更

-- 图片 URL（已存在）
-- image_url text NULL  — 已存在，无需变更

-- 失效时间（已存在）
-- expires_at timestamptz NULL  — 已存在

-- 内容哈希（已存在，有索引）
-- content_hash varchar(64) NULL + 索引 knowledge_items_content_hash_idx

-- 引用计数与最后命中时间（已存在）
-- hit_count integer DEFAULT 0 + 索引
-- last_hit_at timestamptz NULL

-- 向量字段（已存在 + HNSW 索引）
-- embedding text + knowledge_items_embedding_idx (hnsw vector(1024) cosine)

-- 归档时间（已存在）
-- archived_at timestamptz + 索引

-- 多图（image_urls jsonb DEFAULT '[]' + GIN 索引）— 由 20260721 迁移添加

-- 备份性 COMMENT（不依赖 DDL，无副作用）
COMMENT ON COLUMN public.knowledge_items.embedding IS
  'Ollama 向量，存储为 JSON 数组字符串（HNSW 索引维度 1024）';
COMMENT ON COLUMN public.knowledge_items.parent_category IS
  '层级分类的父分类（前端树状筛选依赖）';
COMMENT ON COLUMN public.knowledge_items.expires_at IS
  '失效时间，NULL = 永久有效。Service 层通过 expires_at.is.null,expires_at.gt.now() 过滤';
COMMENT ON COLUMN public.knowledge_items.image_url IS
  '条目关联图片 URL，AI 回复时由 LLM 输出 [IMG:url](alt) 引用';

-- ---------------------------------------------------------------------------
-- 3. knowledge_chunks: 验证列与索引
-- ---------------------------------------------------------------------------
-- 已确认存在列: id(varchar(100) PK), knowledge_item_id(varchar(36) NOT NULL),
--              chunk_index(int NOT NULL), content(text NOT NULL),
--              content_hash(varchar(64) NOT NULL),
--              version_added(int DEFAULT 1), version_removed(int),
--              created_at, embedding
--
-- 索引: knowledge_chunks_pkey, idx_knowledge_chunks_item_id,
--       idx_knowledge_chunks_content_hash,
--       knowledge_chunks_embedding_idx (hnsw vector(1024))
--
-- 注意: TS schema 的 knowledge_chunks 期望:
--   - version_added NOT NULL DEFAULT 1 (DB: NULLABLE WITH DEFAULT 1)
--   - id uuid PK + DEFAULT gen_random_uuid (DB: varchar(100), no default)
-- 两者都是 Drizzle 代码生成器在意而 DB 现状合理的差异——
-- DB 端 id 用 varchar(100) (容纳 chunks id 形如 'kc-{item_id}-{idx}'),
-- 不需要 uuid。我们只补齐 NOT NULL 让 DB 与 Drizzle 的 nullable 形状一致。
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  null_added INTEGER;
BEGIN
  SELECT count(*) INTO null_added FROM public.knowledge_chunks WHERE version_added IS NULL;
  IF null_added > 0 THEN
    UPDATE public.knowledge_chunks SET version_added = 1 WHERE version_added IS NULL;
  END IF;
END $$;

ALTER TABLE public.knowledge_chunks
  ALTER COLUMN version_added SET DEFAULT 1,
  ALTER COLUMN version_added SET NOT NULL;
-- DOWN: ALTER TABLE public.knowledge_chunks
--         ALTER COLUMN version_added DROP NOT NULL,
--         ALTER COLUMN version_added DROP DEFAULT;

-- 复合索引 (knowledge_item_id, chunk_index)
-- 应用层按条目 + chunk 序号查询非常频繁，已有 idx_knowledge_chunks_item_id 单列索引。
-- 复合索引可让 ORDER BY chunk_index 在大表上使用 index 排序。生产 14 行无差异，
-- 数据规模增长后必要。
CREATE INDEX IF NOT EXISTS knowledge_chunks_item_index_idx
  ON public.knowledge_chunks (knowledge_item_id, chunk_index);
-- DOWN: DROP INDEX IF EXISTS public.knowledge_chunks_item_index_idx;

-- (knowledge_item_id, version_added, version_removed)
-- 用于按版本号取活跃 chunk（knowledgeChunkRepository.getActiveChunks）。
-- 数据小可暂不创建，但留作将来性能保险。
CREATE INDEX IF NOT EXISTS knowledge_chunks_active_version_idx
  ON public.knowledge_chunks (knowledge_item_id, version_added)
  WHERE version_removed IS NULL;
-- DOWN: DROP INDEX IF EXISTS public.knowledge_chunks_active_version_idx;

-- ---------------------------------------------------------------------------
-- 4. knowledge_versions: 确认 version / chunk_diff / chunk_count 字段对齐
-- ---------------------------------------------------------------------------
-- DB: id, knowledge_item_id, version(int DEFAULT 1), title(varchar(200)),
--     content(text), category(varchar(50)), change_summary(text),
--     chunk_diff(jsonb), chunk_count(int DEFAULT 0),
--     created_by(varchar(36) FK→users), created_at
-- 全部与 Drizzle schema (knowledgeVersions) 一致。无需 DDL。

-- 性能索引: 复合 (knowledge_item_id, version DESC)
-- 应用层 listVersions 按版本倒序取行，复合索引可加快排序 + WHERE。
-- 已有 knowledge_versions_item_id_idx (单列 knowledge_item_id)
CREATE INDEX IF NOT EXISTS knowledge_versions_item_version_desc_idx
  ON public.knowledge_versions (knowledge_item_id, version DESC);
-- DOWN: DROP INDEX IF EXISTS public.knowledge_versions_item_version_desc_idx;

-- ---------------------------------------------------------------------------
-- 5. knowledge_gap_signals: 确认列与索引
-- ---------------------------------------------------------------------------
-- DB 现状: id, question_hash varchar(128) UNIQUE, sample_question,
--          question_category(100), frequency(int DEFAULT 1),
--          first_seen_at, last_seen_at, last_top_score, triggers_handoff,
--          source_conversation_ids(jsonb DEFAULT '[]'), status(20 DEFAULT 'open'),
--          resolved_by(36), resolved_at, linked_knowledge_item_id(36),
--          notes, created_at, updated_at
-- TS schema: question_hash VARCHAR(100) NOT NULL UNIQUE  vs DB VARCHAR(128)
-- 实测 column 容量 128 ≥ TS 期望 100，无冲突。无需 DDL。
-- 索引: knowledge_gap_status_idx, knowledge_gap_frequency_idx,
--       knowledge_gap_last_seen_idx 均存在。

-- (可选) 添加复合索引 (status, last_seen_at DESC) 加速 "open / in_progress +
-- 最近一次出现" 查询。若 5min 内冷门查询可暂跳过。
CREATE INDEX IF NOT EXISTS knowledge_gap_status_last_seen_idx
  ON public.knowledge_gap_signals (status, last_seen_at DESC);
-- DOWN: DROP INDEX IF EXISTS public.knowledge_gap_status_last_seen_idx;

-- ---------------------------------------------------------------------------
-- 6. knowledge_feedback: 应用层要求 + 索引
-- ---------------------------------------------------------------------------
-- DB 列: id, message_id(varchar(36) NOT NULL), conversation_id(36),
--        knowledge_item_id(36), knowledge_name(255), knowledge_score,
--        feedback_type(varchar(20) NOT NULL), reason(50), comment,
--        created_at, chunk_id(36), chunk_index, content_hash(64)
-- 索引: knowledge_feedback_message_id_idx, knowledge_feedback_item_id_idx,
--       knowledge_feedback_type_idx, knowledge_feedback_created_at_idx,
--       knowledge_feedback_chunk_id_idx (partial),
--       knowledge_feedback_citation_idx (partial)
-- 均与 Drizzle 对齐，无需 DDL。

-- ---------------------------------------------------------------------------
-- 7. knowledge_learning_queue: 索引
-- ---------------------------------------------------------------------------
-- DB 索引: klq_status_idx, klq_confidence_idx, klq_created_at_idx,
--         klq_conversation_id_idx 均与 Drizzle schema 一致。
-- 无需 DDL。

-- ---------------------------------------------------------------------------
-- 8. 分类占位 (__cat__) 占位条目的索引
-- knowledgeRepository.aggregateCategories 过滤 WHERE name NOT LIKE '__cat__%'
-- 该 LIKE 在无索引情况下会全表扫。
-- 应用 knowledge_items_category_idx (单列 category) + name 条件需要全表 scan。
-- 当前 7 行数据无实际影响；>10K 行后建议加:
--   CREATE INDEX ... ON knowledge_items (name) WHERE name LIKE '__cat__%';
-- 不在本次迁移范围。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 9. 验证块 (VERIFY)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_file_type_len INTEGER;
  v_stage_len INTEGER;
  v_import_total INTEGER;
  v_import_null_size INTEGER;
  v_chunks_added_nn INTEGER;
  v_version_record_count INTEGER;
BEGIN
  SELECT character_maximum_length INTO v_file_type_len
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='knowledge_import_jobs' AND column_name='file_type';
  IF v_file_type_len IS DISTINCT FROM 50 THEN
    RAISE WARNING 'file_type length should be 50 but is %', v_file_type_len;
  END IF;

  SELECT character_maximum_length INTO v_stage_len
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='knowledge_import_jobs' AND column_name='stage';
  IF v_stage_len IS DISTINCT FROM 50 THEN
    RAISE WARNING 'stage length should be 50 but is %', v_stage_len;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE file_size IS NULL)
    INTO v_import_total, v_import_null_size
    FROM public.knowledge_import_jobs;
  RAISE NOTICE 'knowledge_import_jobs: % rows, % with NULL file_size', v_import_total, v_import_null_size;

  SELECT count(*) FILTER (WHERE version_added IS NULL)
    INTO v_chunks_added_nn
    FROM public.knowledge_chunks;
  IF v_chunks_added_nn > 0 THEN
    RAISE WARNING 'knowledge_chunks still has % rows with NULL version_added', v_chunks_added_nn;
  END IF;

  SELECT count(*) INTO v_version_record_count FROM public.knowledge_versions;
  RAISE NOTICE 'knowledge_versions: % rows', v_version_record_count;

  RAISE NOTICE '=== 20260801_knowledge_module_review: applied successfully ===';
END $$;

COMMIT;

-- =============================================================================
-- DOWN（全量回滚参考）
-- =============================================================================
-- BEGIN;
--   -- 1c stage 还原
--   ALTER TABLE public.knowledge_import_jobs ALTER COLUMN stage TYPE VARCHAR(30);
--   -- 1b file_size 还原
--   ALTER TABLE public.knowledge_import_jobs
--     ALTER COLUMN file_size DROP NOT NULL,
--     ALTER COLUMN file_size DROP DEFAULT;
--   -- 1a file_type 还原
--   ALTER TABLE public.knowledge_import_jobs ALTER COLUMN file_type TYPE VARCHAR(20);
--   -- 3 version_added NOT NULL 还原
--   ALTER TABLE public.knowledge_chunks
--     ALTER COLUMN version_added DROP NOT NULL,
--     ALTER COLUMN version_added DROP DEFAULT;
--   -- 3 复合索引还原
--   DROP INDEX IF EXISTS public.knowledge_chunks_item_index_idx;
--   DROP INDEX IF EXISTS public.knowledge_chunks_active_version_idx;
--   -- 4 索引还原
--   DROP INDEX IF EXISTS public.knowledge_versions_item_version_desc_idx;
--   -- 5 索引还原
--   DROP INDEX IF EXISTS public.knowledge_gap_status_last_seen_idx;
-- COMMIT;
-- =============================================================================
