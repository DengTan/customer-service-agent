# SmartAssist 智能客服系统产品路线图

> 文档版本：1.1  
> 制定日期：2026-07-28  
> 依据来源：[github-customer-service-agents.md](./github-customer-service-agents.md)

---

## 目录

1. [背景与目标](#背景与目标)
2. [MVP 定义](#mvp-定义)
3. [功能依赖关系](#功能依赖关系)
4. [技术债务与存量迁移](#技术债务与存量迁移)
5. [短期计划：检索质量优化（1-3 个月）](#短期计划1-3-个月)
6. [中期计划：智能化提升（3-6 个月）](#中期计划3-6-个月)
7. [长期计划：规模化（6-12 个月）](#长期计划6-12-个月)
8. [资源估算与里程碑](#资源估算与里程碑)

---

## 背景与目标

### 竞品分析核心发现

基于对 8 个主流开源智能客服/RAG 项目的调研，得出以下关键结论：

| 能力维度 | 行业标杆 | SmartAssist 当前状态 | 差距分析 |
|---------|---------|---------------------|---------|
| 混合检索 | Dify, Kotaemon（BM25 + 向量） | 仅向量检索 | **重大差距** |
| 评测框架 | Simba（RAGAS 指标） | 无 | **重大差距** |
| 分块策略 | Dify（多策略可配置） | 固定分块 | 中等差距 |
| 多 Agent 协作 | CrewAI, LangGraph | 子 Agent 委派（基础） | 中等差距 |
| 引用溯源 | Kotaemon（chunk 级高亮） | 段落级展示 | 中等差距 |
| 知识自学习 | Dify（缺口驱动） | 手动添加 | 中等差距 |
| 知识图谱 | LightRAG, GraphRAG | 无 | **重大差距** |
| 多模态 | Kotaemon（表格/图表） | 图片上传（基础） | 中等差距 |
| 企业安全 | Chatwoot, Botpress | 基础 RBAC | 中等差距 |

### 总体演进策略

```
Phase 1 (1-3M): 打好检索基础 —— 混合检索 + 评测框架 + 分块配置化
Phase 2 (3-6M): 提升智能化 —— 多 Agent 协作 + 引用溯源 + 自学习闭环
Phase 3 (6-12M): 迈向规模化 —— 知识图谱 + 多模态增强 + 企业安全
```

---

## MVP 定义

| 阶段 | MVP 功能 | 可后续迭代 |
|-----|---------|-----------|
| 短期 | 混合检索上线 + 多 Agent 顺序协作 | 评测框架、分块策略 |
| 中期 | 引用溯源 + 知识自学习 | 并行 Agent、语义分块 |
| 长期 | PostgreSQL 图存储 | Neo4j、多模态增强 |

---

## 功能依赖关系

```
混合检索 (W1-4) ──→ 评测框架 (W5-10)
      │                      │
      │                      ↓
      └────→ 分块策略 (W11-12)
                  │
                  ↓
            多 Agent (W5-10) ←→ 引用溯源 (W13-14)
                  │
                  ↓
            知识自学习 (W15-16)
```

**说明**：评测框架和分块策略可并行开发，不阻塞多 Agent

---

## 技术债务与存量迁移

| 任务 | 说明 | 工作量估算 |
|-----|------|-----------|
| 存量 chunks 迁移 | 现有 chunks 需要重建 BM25 索引 | 0.5 人周 |
| 现有子 Agent 重用 | 复用 `agent_delegations` 表 | 已包含 |
| 现有 learning_queue 重用 | 复用 `knowledge_learning_queue` 表 | 已包含 |
| 现有 source-panel 扩展 | 扩展而非重建引用面板 | 已包含 |

---

## 短期计划：检索质量优化（1-3 个月）

**核心主题**：让 AI 回复更准确、更可解释  
**关键假设**：检索质量是生成质量的天花板，混合检索 + 评测驱动迭代是行业最佳实践

### 1.1 混合检索升级（BM25 + 向量）

#### 功能描述

引入全文检索（BM25）与向量语义检索的双通道混合搜索，解决纯向量检索在关键词精确匹配场景下的不足。

#### 影响范围

- 知识库检索模块（`knowledge-search-service.ts`）
- 商品详情检索
- 尺码表检索
- 对话消息处理流程

#### 优先级：P0（阻塞性）

**理由**：当前纯向量检索在用户使用品牌名、SKU、政策条款等精确术语时表现不佳，直接影响核心体验。

#### 技术方案

**1. BM25 索引构建**

```typescript
// src/server/services/hybrid-search-service.ts（新建）
interface HybridSearchOptions {
  query: string;
  topK?: number;           // 默认 10
  vectorWeight?: number;   // 向量权重，默认 0.6
  bm25Weight?: number;     // BM25 权重，默认 0.4
  minScore?: number;       // 综合得分阈值，默认 0.4
}

interface SearchResult {
  id: string;
  content: string;
  source: 'vector' | 'bm25' | 'hybrid';
  scores: {
    vectorScore: number;
    bm25Score: number;
    hybridScore: number;
  };
  metadata: Record<string, unknown>;
}
```

**2. 索引策略**

| 数据类型 | 向量检索 | BM25 检索 | 归并策略 |
|---------|---------|----------|---------|
| 知识库文本 | ✓ | ✓ | Reciprocal Rank Fusion (RRF) |
| 商品名称/描述 | ✓ | ✓ | RRF + 类目加权 |
| 尺码表 | ✓ | ✓ | RRF |
| 聊天记录 | ✗ | ✓ | 纯 BM25 |

**3. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/hybrid-search-service.ts` | 新建 | 混合检索核心服务 |
| `src/server/services/knowledge-search-service.ts` | 修改 | 集成 BM25 通道 |
| `src/server/services/product-detail-service.ts` | 修改 | 集成 BM25 检索 |
| `src/server/services/size-chart-service.ts` | 修改 | 集成 BM25 检索 |
| `src/storage/database/shared/schema.ts` | 修改 | BM25 索引配置表 |
| `src/app/api/knowledge/search/hybrid/route.ts` | 新建 | 混合检索 API |
| `src/app/api/knowledge/route.ts` | 修改 | 路由转发到混合检索 |
| `supabase/migrations/2026XX_hybrid_search.sql` | 新建 | 数据库变更（索引） |

**4. API 设计**

```typescript
// GET /api/knowledge/search
// 查询参数：
// - query: string（搜索文本）
// - type?: 'knowledge' | 'product' | 'size_chart' | 'all'
// - hybrid?: boolean（默认 true）
// - vectorWeight?: number（0.0-1.0）
// - topK?: number（默认 10）
// - minScore?: number（默认 0.4）

// 响应：
// {
//   results: SearchResult[],
//   metadata: {
//     total: number,
//     hybrid: boolean,
//     vectorCount: number,
//     bm25Count: number
//   }
//// }
```

**5. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W1** | BM25 算法实现（Okapi BM25） | `bm25.ts` 模块，可独立测试 |
| **W1** | 知识库文本索引构建（基于现有 chunks） | 索引构建脚本，可构建可搜索索引 |
| **W2** | 存量数据迁移 | 现有 chunks 迁移完成，BM25 索引可用 |
| **W3** | 混合检索服务实现（RRF 归并） | `hybrid-search-service.ts`，通过单元测试 |
| **W3** | 与知识库搜索集成 | 知识搜索 API 返回混合得分 |
| **W4** | 集成测试 + 配置化 UI + 灰度发布 | 混合检索上线 |

#### 验收标准

- [ ] 混合检索延迟 P99 < 500ms（10k 知识条目规模）
- [ ] 关键词精确查询（如"退货政策"）召回率提升 ≥ 20%
- [ ] 向量 + BM25 综合得分阈值可动态配置
- [ ] 监控面板显示向量/BM25 各自贡献度
- [ ] 单元测试覆盖率 ≥ 80%

---

### 1.2 评测框架集成

#### 功能描述

构建 RAG 评测体系，量化检索质量，为迭代优化提供数据支撑。

#### 影响范围

- 知识库管理（FAQ 页面）
- 数据分析（Dashboard）
- 运营团队日常监控

#### 优先级：P2（中优先级，可延后）

**理由**：评测框架是持续优化的基础设施，但短期可先上线混合检索后补充。

#### 技术方案

**1. 评测指标体系（仅检索指标）**

| 类别 | 指标 | 计算方式 | 目标值 |
|-----|------|---------|-------|
| **检索** | Recall@K | 检索结果中相关文档占比 | ≥ 0.85 |
| **检索** | MRR | 首个相关结果排名的倒数均值 | ≥ 0.7 |
| **检索** | NDCG@K | 归一化折损累计增益 | ≥ 0.75 |
| **业务** | 知识缺口率 | 无检索结果对话占比 | ≤ 15% |
| **业务** | 转人工率 | 转人工对话占比 | ≤ 10% |
| **业务** | 对话满意度 | 平均评分 | ≥ 4.2 |

> **注**：生成指标（Answer Faithfulness、Context Precision）暂不实现，依赖 LLM Judge 成本高，待后续评估。

**2. 核心数据结构**

```typescript
// src/server/services/rag-evaluator.ts（新建）
interface EvaluationCase {
  id: string;
  query: string;
  expectedAnswer?: string;
  relevantDocIds: string[];
  createdAt: Date;
  source: 'manual' | 'auto_sampled' | 'production';
}

interface RetrievalMetrics {
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  precisionAt5: number;
}

interface EvaluationResult {
  caseId: string;
  timestamp: Date;
  retrieval: RetrievalMetrics;
  overall: number;  // 加权综合分
}
```

**3. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/rag-evaluator.ts` | 新建 | 评测核心服务 |
| `src/server/services/evaluation-dataset-repository.ts` | 新建 | 评测数据集管理 |
| `src/server/repositories/knowledge-gap-repository.ts` | 修改 | 复用缺口检测能力 |
| `src/app/api/evaluation/route.ts` | 新建 | 评测管理 API |
| `src/app/api/evaluation/run/route.ts` | 新建 | 执行评测 API |
| `src/components/evaluation/evaluation-panel.tsx` | 新建 | 评测面板组件 |
| `src/components/dashboard/dashboard-page.tsx` | 修改 | 集成评测指标卡片 |
| `supabase/migrations/2026XX_evaluation_schema.sql` | 新建 | 评测数据集表 |

**4. 数据库表设计**

```sql
-- 评测数据集
CREATE TABLE evaluation_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  case_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 评测用例
CREATE TABLE evaluation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES evaluation_datasets(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  expected_answer TEXT,
  relevant_doc_ids JSONB,  -- ['doc_id_1', 'doc_id_2']
  source VARCHAR(20) DEFAULT 'manual',  -- manual/auto_sampled/production
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 评测结果
CREATE TABLE evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID REFERENCES evaluation_datasets(id),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  metrics JSONB NOT NULL,  -- { retrieval: {...}, overall: 0.85 }
  sample_size INTEGER,
  duration_ms INTEGER
);

-- 索引
CREATE INDEX idx_evaluation_cases_dataset ON evaluation_cases(dataset_id);
CREATE INDEX idx_evaluation_results_dataset ON evaluation_results(dataset_id);
CREATE INDEX idx_evaluation_results_run_at ON evaluation_results(run_at);
```

**5. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W9** | 评测指标计算模块（Recall/MRR/NDCG） | `rag-evaluator.ts`，可独立计算 |
| **W9** | 评测数据集 CRUD | Dataset/Case 管理 API |
| **W10** | 评测执行引擎（批量） | 评测 API，支持手动触发 |
| **W10** | 评测面板 UI + Dashboard 集成 | 评测列表、详情、趋势图 |

#### 验收标准

- [ ] 支持 Recall@K、MRR、NDCG@K 三大检索指标计算
- [ ] 支持手动添加/导入评测用例（批量 CSV）
- [ ] 评测结果支持时间维度趋势查看
- [ ] ~~Answer Faithfulness 评测~~（移除，依赖 LLM Judge 成本高）

---

### 1.3 分块策略配置化

#### 功能描述

支持按知识类型选择不同的分块策略，解决固定分块在复杂文档结构上的信息碎片化问题。

#### 影响范围

- 知识库导入流程
- 文本分块模块
- 知识库管理

#### 优先级：P2（中优先级，可延后）

**理由**：当前固定分块可用，分块优化可在混合检索上线后补充。

#### 技术方案

**1. 分块策略类型（移除语义分块）**

| 策略 | 适用场景 | 关键参数 | 行业参考 |
|-----|---------|---------|---------|
| `fixed_size` | 通用文本 | chunk_size=500, overlap=50 | Kotaemon 默认 |
| `recursive` | 保持段落完整 | separators=["\\n\\n", "\\n", "。", "！"], chunk_size=500 | Dify |
| `markdown_aware` | Markdown 文档 | 保留标题层级 | Dify |
| `sliding_window` | 高连续性要求 | window=300, step=100 | LightRAG |

> **注**：移除 `semantic`（语义分块），依赖 LLM 判定成本高且效果不稳定。

**2. 核心数据结构**

```typescript
// src/server/services/text-chunker.ts（扩展现有模块）
interface ChunkingConfig {
  strategy: 'fixed_size' | 'recursive' | 'markdown_aware' | 'sliding_window';
  chunkSize: number;         // 默认 500 字符
  overlap: number;           // 默认 50 字符（块间重叠）
  separators?: string[];      // 递归分块分隔符
  
  // 知识类型特定配置
  knowledgeType?: 'faq' | 'product' | 'policy' | 'manual' | 'custom';
  preserveFormatting?: boolean;  // 保留 Markdown 格式
}

interface ChunkResult {
  chunks: Chunk[];
  metadata: {
    strategy: string;
    totalChunks: number;
    processingTimeMs: number;
    avgChunkSize: number;
  };
}

interface Chunk {
  content: string;
  chunkIndex: number;
  contentHash: string;
  startChar: number;
  endChar: number;
  docMetadata?: Record<string, unknown>;
}
```

**3. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/text-chunker.ts` | 修改 | 扩展分块策略，添加递归/markdown感知/滑动窗口 |
| `src/server/services/knowledge-import-service.ts` | 修改 | 导入时选择分块策略 |
| `src/server/services/knowledge-service.ts` | 修改 | 编辑时支持重新分块 |
| `src/app/api/knowledge/import/route.ts` | 修改 | 增加 chunking_config 参数 |
| `src/app/api/knowledge/items/route.ts` | 修改 | 编辑时支持重新分块 |
| `src/components/faq/import-progress.tsx` | 修改 | 导入时显示策略选择 |
| `src/components/faq/faq-page.tsx` | 修改 | 知识库设置页支持分块策略配置 |

**4. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W11** | 递归分块实现 | `text-chunker.ts` 支持 separators 配置 |
| **W11** | 滑动窗口分块实现 | 支持 window/step 参数 |
| **W11** | Markdown 感知分块实现 | 保留标题层级 |
| **W12** | 分块预览组件 | 可视化预览切分效果 |
| **W12** | 导入流程集成 | 选择策略 → 预览 → 确认 → 执行 |
| **W12** | 重新分块功能 | 已有知识条目支持重新分块（版本管理） |

#### 验收标准

- [ ] 支持 4 种分块策略：fixed_size、recursive、markdown_aware、sliding_window
- [ ] 导入前提供分块预览功能
- [ ] 已有知识条目支持一键重新分块

---

## 中期计划：智能化提升（3-6 个月）

**核心主题**：让 AI 更专业、更协作、更自主  
**关键假设**：检索质量提升后，需要更智能的 Agent 编排和自学习能力来消化增长的知识

### 2.1 多 Agent 协作架构

#### 功能描述

构建专业化 Agent 团队，实现意图识别 → 路由 → 专项处理 → 协作回复的完整流水线。

#### 影响范围

- 消息处理流程（`messages/route.ts`）
- 子 Agent 管理（`sub-agents`）
- 工具调用系统

#### 优先级：P0（阻塞性）

**理由**：当前子 Agent 委派是手动触发，需要升级为基于意图识别的自动委派 + Agent 间协作。

#### 技术方案

**1. Agent 角色定义**

```typescript
// src/server/services/multi-agent-service.ts（新建）
interface AgentRole {
  id: string;
  name: string;           // "知识库专家"、"订单管家"、"投诉处理"
  description: string;
  systemPrompt: string;
  tools: string[];       // 可调用工具列表
  capabilities: string[]; // ["product_query", "refund_action"]
  confidenceThreshold: number;
  isSubAgent: boolean;
}

// 协作模式
type CollaborationMode = 
  | 'sequential'   // 顺序：意图分类 → 知识检索 → 回复生成
  | 'parallel'      // 并行：多个 Agent 同时处理，取最优
  | 'hierarchical'; // 层级：主 Agent 分解任务 → 子 Agent 执行 → 主 Agent 汇总

interface CollaborationConfig {
  mode: CollaborationMode;
  agents: string[];        // 参与的 Agent ID
  aggregationStrategy: 'best_confidence' | 'all_results' | 'weighted_fusion';
  timeoutMs: number;
}
```

**2. 意图分类 Agent（规则优先，LLM 降级）**

```typescript
// 内置意图分类（无需 LLM 调用）
interface IntentClassification {
  intent: 'greeting' | 'product_query' | 'order_inquiry' | 'refund' | 
          'complaint' | 'general' | 'handoff';
  confidence: number;      // 0.0-1.0
  entities: {
    sku?: string;
    orderId?: string;
    productName?: string;
  };
  suggestedAgent?: string; // 建议路由到的 Agent
}

// 意图路由规则
interface RoutingRule {
  id: string;
  intent: string;
  targetAgent: string;
  priority: number;
  conditions?: {
    entities?: string[];  // 必须包含的实体
    keywords?: string[];  // 关键词匹配
    confidenceMin?: number;
  };
}
```

**3. Agent 协作流程（顺序模式 MVP）**

```
用户消息
    │
    ▼
┌─────────────────────┐
│  意图识别 Agent      │ ──→ 意图分类 + 实体提取（规则优先）
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  路由决策           │ ──→ 根据意图路由到专业 Agent
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
┌────────┐  ┌────────────┐
│知识库  │  │ 订单/物流  │  ──→ 顺序执行（先知识库，后工具）
│Agent   │  │ Agent      │
└───┬────┘  └─────┬──────┘
    │             │
    └──────┬──────┘
           ▼
┌─────────────────────┐
│  回复生成 Agent     │ ──→ 综合各 Agent 结果生成回复
└──────────┬──────────┘
           │
           ▼
      最终回复（含引用）
```

**4. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/multi-agent-service.ts` | 新建 | 多 Agent 协作核心服务 |
| `src/server/services/intent-classifier.ts` | 新建 | 意图分类服务（规则优先） |
| `src/server/services/agent-collaboration-service.ts` | 新建 | Agent 间通信服务 |
| `src/app/api/conversations/[id]/messages/route.ts` | 修改 | 集成多 Agent 流程 |
| `src/app/api/sub-agents/route.ts` | 修改 | Agent 配置管理增强 |
| `src/app/api/sub-agents/delegate/route.ts` | 修改 | 支持自动委派 |
| `src/server/services/llm-streaming-service.ts` | 修改 | 支持多 Agent 上下文 |
| `src/components/chat/source-panel.tsx` | 修改 | 显示 Agent 协作链路 |
| `src/app/api/bot-configs/route.ts` | 修改 | Agent 角色配置 |

**5. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W5** | 意图分类服务（规则优先） | `intent-classifier.ts`，支持 7 大意图 |
| **W6** | 意图分类服务（LLM 降级） | 规则无法识别时调用 LLM |
| **W6** | 路由决策引擎 | 根据意图自动路由到专业 Agent |
| **W7** | 多 Agent 执行框架（顺序模式 MVP） | 支持顺序执行 |
| **W8** | 结果聚合策略 | RRF/加权融合多种聚合方式 |
| **W8** | 可视化追踪面板 | 显示意图 → 路由 → Agent 执行链路 |

> **注**：并行执行模式（W17-20）作为可选升级，非阻塞。

#### 验收标准

- [ ] 支持 7 种以上意图自动分类（F1 ≥ 0.85）
- [ ] 意图分类延迟 P99 < 100ms
- [ ] 支持顺序协作模式
- [ ] Agent 执行链路可追踪、可回放
- [ ] 平均对话处理时间不显著增加（< 500ms 额外延迟）

---

### 2.2 引用溯源增强

#### 功能描述

实现精确到 chunk 级的引用溯源，支持答案中高亮标注引用来源，点击可跳转到源文档。

#### 影响范围

- AI 回复渲染（`chat-window.tsx`）
- 引用溯源面板（`source-panel.tsx`）
- 知识库条目详情页

#### 优先级：P2（中优先级）

**理由**：增强用户对 AI 回复的信任度，但后置处理模式实现难度降低。

#### 技术方案

**1. 引用数据结构**

```typescript
// src/server/services/citation-service.ts（新建）
interface Citation {
  id: string;
  sourceType: 'knowledge' | 'product' | 'size_chart' | 'policy';
  sourceId: string;
  sourceName: string;
  chunkId: string;
  chunkContent: string;
  highlightRange?: {
    start: number;
    end: number;
  };  // 在 chunk 内容中的高亮位置
  relevanceScore: number;
  position: number;  // 在回复中的引用顺序
}

interface CitationSpan {
  startIndex: number;  // 在回复文本中的字符位置
  endIndex: number;
  citationId: string;
}

interface EnrichedResponse {
  text: string;        // 原始回复文本
  citations: Citation[];
  citationSpans: CitationSpan[];  // 回复中高亮位置映射
  confidence: {
    overall: number;
    knowledgeContribution: number;
    toolContribution: number;
    llmSelfAssessment: number;
  };
}
```

**2. 引用生成流程（后置处理模式）**

> **注**：移除流式引用（难度高），采用后置处理模式。

```typescript
// 引用溯源流程（后置处理）
async function generateWithCitations(
  query: string,
  retrievedContexts: SearchResult[],
  generatedText: string
): Promise<EnrichedResponse> {
  // 1. LLM 生成回复（不注入引用指令）
  const rawResponse = await llm.generate(query, retrievedContexts);
  
  // 2. 后置处理：提取引用（使用关键词匹配或 LLM 分析）
  const citations = extractCitationsPostHoc(rawResponse, retrievedContexts);
  
  // 3. 计算引用覆盖率
  const coverage = calculateCitationCoverage(citations, rawResponse);
  
  // 4. 无引用时返回降级文案
  if (coverage < 0.3) {
    return {
      text: rawResponse,
      citations: [],
      citationSpans: [],
      confidence: { /* ... */ },
      noCitationsMessage: '未找到相关知识，建议转人工咨询'
    };
  }
  
  return { text, citations, citationSpans, confidence };
}
```

**3. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/citation-service.ts` | 新建 | 引用生成服务（后置处理） |
| `src/server/services/llm-streaming-service.ts` | 修改 | 流式输出后提取引用信息 |
| `src/components/chat/chat-window.tsx` | 修改 | 渲染带高亮的引用文本 |
| `src/components/chat/source-panel.tsx` | 修改 | 增强溯源面板 |
| `src/components/chat/markdown-renderer.tsx` | 修改 | 支持引用高亮语法 |
| `src/lib/types.ts` | 修改 | 扩展 Message 类型支持 citations |

**4. 前端渲染设计**

```tsx
// 引用高亮语法示例
// AI 回复: "根据我们的[退货政策][1]，..."
// 渲染为: "根据我们的<span class="citation" data-id="1">退货政策</span>，..."

// 交互行为
// - Hover: 显示引用卡片（来源名称 + 片段预览）
// - Click: 跳转到源文档详情 + 高亮对应 chunk
// - 侧边栏: 显示引用列表，支持点击定位
// - 无引用: 显示"未找到相关知识"降级文案
```

**5. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W13** | 引用提取服务（后置处理） | 从回复中提取引用标记 |
| **W13** | 来源映射服务 | 引用标记映射到实际来源 |
| **W14** | Markdown 渲染器增强 | 支持引用高亮语法 |
| **W14** | 侧边溯源面板升级 | chunk 级详情 + 高亮定位 |
| **W14** | 无引用降级文案 | 显示"未找到相关知识" |

#### 验收标准

- [ ] AI 回复中引用标记覆盖率 ≥ 70%（原 90%）
- [ ] 点击引用可正确跳转到源文档
- [ ] 无引用时显示"未找到相关知识"降级文案
- [ ] 侧边溯源面板支持折叠/展开

---

### 2.3 知识自学习闭环

#### 功能描述

建立"缺口检测 → 候选生成 → 人工审核 → 入库生效 → 效果验证"的完整闭环。

#### 影响范围

- 知识库管理（FAQ 页面）
- 评测框架（已建）
- 运营工作流

#### 优先级：P1（高优先级）

**理由**：当前知识库依赖人工维护，缺口驱动学习可大幅降低运营成本。

#### 技术方案

**1. 自学习状态机（复用现有 knowledge_learning_queue）**

```typescript
// src/server/services/knowledge-loop-service.ts（扩展现有）
type LearningStatus = 
  | 'pending_review'    // 待审核
  | 'approved'           // 已通过，待入库
  | 'rejected'           // 已拒绝
  | 'published'          // 已发布
  | 'archived';          // 已归档

interface LearningCandidate {
  id: string;
  question: string;
  suggestedAnswer: string;
  sourceConversationId: string;
  sourceMessageId: string;
  confidence: number;     // LLM 生成置信度
  frequency: number;      // 相同问题出现频次
  category?: string;
  status: LearningStatus;
  reviewedBy?: string;     // 审核人
  reviewedAt?: Date;
  feedback?: string;      // 审核意见
  publishedKnowledgeItemId?: string;  // 入库后的知识条目 ID
  createdAt: Date;
}

// 优先级计算
function calculatePriority(candidate: LearningCandidate): number {
  return candidate.frequency * 0.6 + candidate.confidence * 0.4;
}
```

> **注**：复用现有 `knowledge_learning_queue` 表，无需新建。

**2. 答案生成策略**

```typescript
// 基于多轮对话生成答案
interface AnswerGenerationStrategy {
  // 单轮直接生成
  directGenerate(conversationId: string, messageId: string): Promise<string>;
  
  // 多轮汇总生成
  multiTurnSummarize(messages: Message[]): Promise<string>;
  
  // 参考知识库生成
  knowledgeGuidedGenerate(question: string, similarItems: KnowledgeItem[]): Promise<string>;
}
```

**3. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/knowledge-loop-service.ts` | 修改 | 扩展现有服务 |
| `src/server/repositories/knowledge-learning-repository.ts` | 修改 | 扩展字段（category/frequency） |
| `src/app/api/knowledge-learning/route.ts` | 修改 | 增删改查 + 批量操作 |
| `src/app/api/knowledge-learning/generate/route.ts` | 修改 | 答案生成 API |
| `src/components/faq/knowledge-learning-tab.tsx` | 修改 | 增强学习队列 UI |
| `src/components/knowledge-learning/candidate-detail.tsx` | 新建 | 候选详情 + 编辑 |

**4. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W15** | 候选优先级排序 | 按频率 × 置信度排序 |
| **W15** | 答案生成策略增强 | 多轮汇总 + 知识库引导 |
| **W16** | 批量审核功能 | 勾选批量通过/拒绝 |
| **W16** | 审核意见反馈 | 审核时可填写修改建议 |
| **W16** | 学习效果看板 | 展示学习成果（入库数/覆盖缺口数） |

#### 验收标准

- [ ] 每日自动从高风险对话中提取 ≥ 10 条候选
- [ ] 候选答案生成准确率 ≥ 80%（人工抽检）
- [ ] 审核操作支持批量（≥ 20 条/次）
- [ ] 知识缺口率月度下降 ≥ 10%

---

### 2.4 并行 Agent 执行（可选升级）

#### 功能描述

支持多个 Agent 并行处理，提升复杂查询的处理效率。

#### 优先级：可选升级，非阻塞

**理由**：顺序模式可满足大部分场景，并行模式作为可选升级。

#### 实现步骤

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W17-18** | 并行执行框架 | 支持多个 Agent 同时处理 |
| **W19-20** | 结果聚合策略 | RRF/加权融合/AHP 多种聚合方式 |
| **W20** | 性能优化 | Agent 调用超时控制、缓存 |

---

## 长期计划：规模化（6-12 个月）

**核心主题**：支撑大规模知识、多语言、多渠道的企业级需求  
**关键假设**：基础能力稳固后，需要知识图谱结构化、多模态深度理解、企业安全合规

### 3.1 知识图谱集成

#### 功能描述

引入轻量级知识图谱能力，支持实体关系推理和多跳问答。

#### 影响范围

- 知识库检索（`knowledge-search-service.ts`）
- 实体关系存储
- 问答处理流程

#### 优先级：P1（高优先级）

**理由**：知识图谱可解决复杂关系查询（如"同品牌其他商品"、"关联尺码表"），提升专业化场景表现。

#### 技术方案

**1. 图谱存储策略（PostgreSQL JSONB MVP）**

> **注**：Neo4j 作为可选扩展，MVP 使用 PostgreSQL JSONB + 邻接表模式。

```typescript
// src/server/services/knowledge-graph-service.ts（新建）
interface KGEntity {
  id: string;
  type: 'product' | 'category' | 'brand' | 'policy' | 'faq' | 'concept';
  name: string;
  properties: Record<string, unknown>;
  sourceChunkId: string;
  confidence: number;
}

interface KGRelation {
  id: string;
  sourceId: string;    // 源实体
  targetId: string;     // 目标实体
  type: string;        // 'belongs_to' | 'related_to' | 'alternative_of' | ...
  weight: number;      // 关系强度 0-1
  sourceChunkId: string;
}

interface KGQueryResult {
  entities: KGEntity[];
  paths: KGPath[];      // 实体间的推理路径
  explanation: string;  // 自然语言推理解释
}
```

**2. 图谱构建流程**

```
知识条目 → 实体提取（NER） → 关系抽取 → 图构建 → 图索引
              ↓
        LLM API / 本地 NER 模型
```

**3. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/knowledge-graph-service.ts` | 新建 | 图谱核心服务 |
| `src/server/services/entity-extractor.ts` | 新建 | 实体抽取服务 |
| `src/server/services/relation-extractor.ts` | 新建 | 关系抽取服务 |
| `src/storage/database/shared/schema.ts` | 修改 | 图谱实体/关系表（JSONB） |
| `src/server/services/hybrid-search-service.ts` | 修改 | 集成图谱检索 |
| `supabase/migrations/2026XX_knowledge_graph.sql` | 新建 | 图谱数据库变更 |

**4. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W25-26** | 实体/关系抽取服务 | NER + 关系分类 |
| **W27-28** | 图谱存储与查询（PostgreSQL JSONB） | 实体/关系 CRUD，图遍历 |
| **W29-30** | 图谱检索集成 | 混合检索支持图查询 |
| **W31-32** | 多跳推理能力 | 支持 2-3 跳问答 |
| **W33-36** | 图谱可视化 + 管理 UI | 实体关系图展示 |

> **注**：Neo4j 扩展在 W36 后评估是否引入。

#### 验收标准

- [ ] 支持 5 种实体类型 + 10 种关系类型
- [ ] 单跳查询延迟 < 200ms
- [ ] 多跳问答准确率 ≥ 80%
- [ ] 图谱覆盖率：≥ 80% 商品有关联实体

---

### 3.2 多模态支持增强

#### 功能描述

扩展图片理解能力，支持商品图片自动解析、发票/截图信息提取、视觉问答。

#### 影响范围

- 消息处理流程
- 图片上传与理解
- 商品详情管理

#### 优先级：P2（中优先级）

**理由**：当前已支持基础图片上传，长期需要深度视觉理解能力。

#### 技术方案

**1. 多模态处理管道（移除跨模态检索）**

> **注**：移除 W45-48 跨模态检索，调整为发票 OCR + 尺码图片分析。

```typescript
// src/server/services/multimodal-service.ts（新建）
type ImageIntent = 
  | 'product_identify'    // 商品识别
  | 'size_check'          // 尺码查看
  | 'defect_report'       // 瑕疵反馈
  | 'invoice_extract'     // 发票提取
  | 'screenshot_ocr'     // 截图 OCR
  | 'other';

interface ImageAnalysisResult {
  intent: ImageIntent;
  confidence: number;
  extractedInfo: {
    productName?: string;
    sku?: string;
    size?: string;
    defectDescription?: string;
    invoiceData?: Record<string, string>;
    textContent?: string;
  };
  relatedKnowledgeItems?: string[];
  suggestedResponses: string[];
}
```

**2. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/multimodal-service.ts` | 新建 | 多模态处理服务 |
| `src/app/api/tools/image-analysis/route.ts` | 新建 | 图片分析 API |
| `src/app/api/conversations/[id]/messages/route.ts` | 修改 | 图片自动分析 |
| `src/components/chat/chat-window.tsx` | 修改 | 图片分析结果展示 |
| `src/server/services/llm-streaming-service.ts` | 修改 | 多模态系统提示词 |

**3. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W37-38** | 商品图片识别 | 识别商品名称/SKU/颜色 |
| **W39-40** | 发票/截图 OCR | 提取订单号/金额/日期 |
| **W41-42** | 尺码图片分析 | 识别尺码表/尺码数据 |
| **W43-44** | 视觉问答 | 基于图片内容回答问题 |
| **W45-48** | ~~跨模态检索~~ | ~~已移除~~ |

> **注**：跨模态检索（图片 → 知识库关联）已移除，待后续评估。

#### 验收标准

- [ ] 商品图片识别准确率 ≥ 85%
- [ ] 发票 OCR 字段提取准确率 ≥ 90%
- [ ] 尺码图片分析可用率 ≥ 80%
- [ ] 多模态处理延迟 P99 < 3s

---

### 3.3 企业级安全加固

#### 功能描述

完善企业级安全能力：细粒度 RBAC、操作审计、数据脱敏、SSO 集成。

#### 影响范围

- 认证授权（`auth.tsx`, `jwt.ts`）
- 用户管理（`users`）
- API 安全
- 数据导出

#### 优先级：P2（中优先级）

**理由**：面向企业客户需要满足合规要求，提升商业化竞争力。

#### 技术方案

**1. 资源级权限模型**

```typescript
// src/server/services/rbac-service.ts（新建）
type Permission = 
  | 'conversation:view' | 'conversation:handoff' | 'conversation:delete'
  | 'knowledge:view' | 'knowledge:edit' | 'knowledge:delete'
  | 'user:view' | 'user:manage'
  | 'ticket:view' | 'ticket:manage'
  | 'report:view' | 'report:export'
  | 'setting:view' | 'setting:manage';

type Role = 'admin' | 'supervisor' | 'agent' | 'viewer';

interface RBACConfig {
  role: Role;
  permissions: Permission[];
  resourceRestrictions?: {
    scope?: 'global' | 'team' | 'own';
    allowedShopIds?: string[];
  };
}
```

**2. 需要修改的文件**

| 文件 | 操作 | 说明 |
|-----|------|------|
| `src/server/services/rbac-service.ts` | 新建 | RBAC 核心服务 |
| `src/lib/api-utils.ts` | 修改 | 增强权限校验 |
| `src/middleware.ts` | 修改 | 资源级权限校验 |
| `src/app/api/permissions/route.ts` | 修改 | 权限配置 API |
| `src/app/api/audit-log/route.ts` | 新建 | 审计日志 API |
| `src/app/api/auth/sso/route.ts` | 新建 | SSO 登录 API |
| `src/components/team/team-page.tsx` | 修改 | 权限矩阵配置 UI |
| `supabase/migrations/2026XX_rbac_audit.sql` | 新建 | 权限/审计表 |

**3. 实现步骤（按周拆分）**

| 周次 | 任务 | 可交付物 |
|-----|------|---------|
| **W49-50** | 资源级 RBAC 实现 | 权限模型 + 校验中间件 |
| **W51-52** | 操作审计日志 | 全量操作记录 + 查询 API |
| **W53-54** | 数据脱敏导出 | 敏感字段自动脱敏 |
| **W55-56** | SSO 集成（SAML/OIDC） | 企业 SSO 登录 |
| **W57-60** | 安全合规检查 | 渗透测试 + 修复 |

#### 验收标准

- [ ] 权限配置支持 20+ 权限项
- [ ] 审计日志完整率 ≥ 99.9%
- [ ] 数据导出自动脱敏（手机号/邮箱）
- [ ] SSO 登录成功率 ≥ 99%
- [ ] 通过等保/ISO27001 相关安全评估

---

## 资源估算与里程碑

### 总体工作量估算

| 阶段 | 功能点 | 人月估算 | 备注 |
|-----|-------|---------|------|
| **短期** | 混合检索升级 | 1.5 | BM25 + 向量集成 |
| | 评测框架集成 | 1.0 | 仅检索指标（移除生成指标） |
| | 分块策略配置化 | 1.0 | 4 种策略（移除语义分块） |
| **小计** | | **3.5 人月** | -0.5（简化评测、移除语义分块） |
| **中期** | 多 Agent 协作 | 2.0 | 意图分类 + 顺序协作 |
| | 引用溯源增强 | 1.0 | 后置处理模式（移除流式引用） |
| | 知识自学习闭环 | 1.5 | 复用现有表 |
| **小计** | | **4.5 人月** | -1.0（简化引用、复用现有） |
| **长期** | 知识图谱集成 | 3.0 | PostgreSQL JSONB（Neo4j 可选） |
| | 多模态增强 | 1.5 | 发票 OCR + 尺码分析（移除跨模态检索） |
| | 企业安全加固 | 1.5 | RBAC + 审计 |
| **小计** | | **6.0 人月** | -1.0（简化多模态） |
| **总计** | | **14.0 人月** | -2.5 |

### 关键里程碑

| 里程碑 | 周次 | 交付内容 |
|-------|------|---------|
| **M1** | W4 | 混合检索上线 |
| **M2** | W8 | **多 Agent 协作架构上线**（原 W16，提前） |
| **M3** | W10 | 评测框架 v1.0（仅检索指标） |
| **M4** | W12 | 分块策略配置化完成（4 种策略） |
| **M5** | W16 | 引用溯源增强 + 知识自学习闭环 |
| **M6** | W24 | 并行 Agent（可选升级） |
| **M7** | W36 | 知识图谱上线（PostgreSQL JSONB） |
| **M8** | W48 | 多模态能力完善（发票 OCR + 尺码分析） |
| **M9** | W60 | 企业安全加固完成 |

### 风险与依赖

| 风险项 | 影响 | 缓解措施 |
|-------|-----|---------|
| LLM API 成本超预期 | 高 | 引入本地 embedding 模型 + 缓存策略 |
| 评测数据标注成本高 | 中 | 采用主动学习，最小化标注需求 |
| 知识图谱构建质量不稳定 | 中 | 引入人工审核 + 置信度过滤 |
| 多 Agent 协作复杂度高 | 高 | 分阶段交付，先顺序后并行 |
| 企业安全合规周期长 | 中 | 提前与法务/安全团队对齐 |

---

## 附录

### A. 技术选型参考

| 能力 | 短期方案 | 中长期方案 |
|-----|---------|-----------|
| BM25 检索 | PostgreSQL full-text search | Elasticsearch |
| 向量检索 | Ollama 本地模型 | Qdrant/Pinecone |
| 嵌入模型 | `bge-m3` / `text-embedding-3-small` | 多语言专用模型 |
| LLM | GPT-4o / Claude 3.5 | 本地 Llama3 (70B) |
| NER 模型 | GPT-4o API | 本地 RoBERTa-NER |
| 图数据库 | **PostgreSQL + JSONB**（MVP） | Neo4j（可选扩展） |

### B. 监控指标

| 阶段 | 核心监控指标 | 告警阈值 |
|-----|------------|---------|
| 短期 | 检索延迟、Recall@10、MRR | P99 > 500ms |
| 中期 | 意图识别准确率、引用覆盖率 | F1 < 0.85 |
| 长期 | 图查询延迟、多模态成功率 | P99 > 2s |

---

*文档生成时间：2026-07-28*  
*下次评审时间：2026-08-11（W4 结束时）*
