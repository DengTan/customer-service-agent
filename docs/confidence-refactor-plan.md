# 置信度体系重构设计方案

> 状态：规划文档，仅用于设计；本阶段不修改业务代码。
>
> 目标：将当前实际上衡量“依据强度”的 `confidence` 拆分为可解释的 `grounding_score` 与 `faithfulness_score`，再形成面向人工接管的 `final_confidence`。

## 1. 概念重新厘清

### 1.1 Grounding 与 Faithfulness

**Grounding（依据强度）**回答：“这次回答是否有足够相关、可靠、可追溯的外部依据？”它衡量检索证据的相关度、工具结果的可用性、结果是否为 mock、子 Agent 是否有可验证输入，不衡量模型是否正确使用了依据。`retrieval-orchestrator.ts` 的 `relevanceScore` 是相关度，不是事实正确性；`ToolResult.confidence` 是 provider 对结果可用性的估计，也不是回答忠实度。

**Faithfulness（回答忠实度）**回答：“回答中的可验证事实是否与给定依据一致？”它需要对最终 `fullContent` 逐条抽取 claim，并与知识 chunk、商品/尺码结果、工具结构化结果进行 `entailed/contradicted/unknown` 判断。真实订单结果可以令 grounding 很高，但若回答把金额、状态或时间说错，faithfulness 必须降低。

### 1.2 业务影响

- Grounding 低：回答缺乏可追溯依据，适合触发“无依据/知识缺口”提醒；但常识、澄清、礼貌语不应被机械判为错误。
- Faithfulness 低：回答可能曲解或幻觉式补充，即使证据很强也应优先人工复核；`contradicted` 比 `unknown` 更严重。
- 二者不可互相替代：检索 score 只能说明“找到了什么”，不能说明“说对了什么”；verifier 只能验证给定参考资料，不能替代检索质量评估。

### 1.3 建议权重

客服场景优先避免错误承诺，建议默认：

```ts
final_confidence = 0.35 * grounding_score
  + 0.50 * faithfulness_score
  + 0.10 * sub_agent_score
  + 0.05 * handoff_adjustment;
```

`handoff_adjustment` 不是正向质量分，建议作为独立惩罚/上限规则：检测到转人工意图时 `final_confidence = min(final_confidence, 0.35)`。无可验证事实的纯问候/澄清场景应将 `faithfulness_score` 标记为 `not_applicable`，使用 `0.3` 的保守先验而不是伪造高分。工具查询、退款、地址修改、金额、时效、政策等事实型回答应强制进行 faithfulness 核验。

## 2. 目标架构

### 2.1 指标定义

建议在 `src/lib/confidence-calculator.ts` 新增：

```ts
export type VerificationStatus = 'verified' | 'not_applicable' | 'unavailable' | 'failed';

export interface ConfidenceBreakdownV2 {
  grounding_score: number;
  faithfulness_score: number | null;
  faithfulness_status: VerificationStatus;
  knowledge_grounding_score: number;
  tool_grounding_score: number;
  sub_agent_score: number;
  supported_claim_count: number;
  factual_claim_count: number;
  contradicted_claim_count: number;
  unknown_claim_count: number;
  handoff_intent: boolean;
  no_support: boolean;
  verifier_error?: 'timeout' | 'provider_error' | 'invalid_response';
  final_confidence: number;
  /** Legacy alias; deprecated after migration. */
  final?: number;
}
```

`grounding_score`：对 accepted evidence、工具结果和子 Agent 依据做归一化聚合。知识项使用 orchestrator 的 `relevanceScore`/`knowledgeContext.confidence`；工具使用 `ToolResult.confidence`，但 mock、失败、未找到结果必须降权；产品和尺码结果应作为结构化 evidence，而不是简单把 context 非空当作 0.7。

`faithfulness_score`：按 factual claim 加权。建议 `entailed=1 * verifierConfidence`、`unknown=0.35 * verifierConfidence`、`contradicted=0`，再按 claim 重要性加权；无事实 claim 时为 `null`/`not_applicable`。任何关键业务事实被 contradicted 时，设置 `critical_contradiction=true` 并对 `final_confidence` 设置上限 0.25。

### 2.2 模块职责

- **`RetrievalOrchestrator`**：只负责检索、证据门控、来源身份和 provenance；返回 `EvidenceBundle`，不得计算回答忠实度。
- **`ToolExecutionService` / providers**：只负责授权、执行和返回结构化 `ToolResult`；补齐 `toolCallId`、`toolName`、`args`、`data`、`isMockData`、`failed` 等可验证参考资料元数据。
- **`ClaimSupportVerifier`**：负责 claim 抽取、claim 与 reference 的支持关系、知识 citation 过滤，并扩展到任意 `ReferenceItem`。
- **`ToolFaithfulnessVerifier`**：可作为 `ClaimSupportVerifier` 的 adapter；将工具结果标准化为 references，核对回答中的订单号、状态、金额、时间、物流节点等关键字段。
- **`ConfidenceAggregator`**：新增深模块 `src/server/services/confidence-aggregator.ts`，只接受结构化 signals，计算 grounding、faithfulness、最终分数、降级原因和阈值决策。
- **`LLMStreamingService`**：在生成结束、过滤内部 marker 后调用 verifier/aggregator，负责 SSE done 和 post-stream persistence；不在流式 token 阶段推断最终分数。
- **消息入口 route**：负责组装 retrieval、provider、verifier 配置和 feature flag，不复制聚合公式。

建议接口：

```ts
export interface ConfidenceSignals {
  evidence: EvidenceBundle;
  toolResults: ToolExecutionReference[];
  subAgentScore?: number;
  response: string;
  userQuestion: string;
  handoffIntent: boolean;
  verification?: FaithfulnessVerification;
}

export interface ConfidenceAggregator {
  aggregate(signals: ConfidenceSignals): ConfidenceBreakdownV2;
}
```

## 3. 关键模块设计

### 3.1 ClaimSupportVerifier 扩展

当前 `claim-support-verifier.ts:95-125` 的 `ClaimVerificationInput` 只接受 `CitationItem[]`，`169-297` 只构造 `[S1]` 知识来源，且失败时会清空 citation。改为：

```ts
export interface ReferenceItem {
  referenceId: string;
  type: 'knowledge' | 'tool' | 'product' | 'size_chart' | 'sub_agent';
  content: string;
  structuredData?: Record<string, unknown>;
  source?: CitationItem;
  reliability: number;
  isMock?: boolean;
}

export interface ClaimVerificationInput {
  response: string;
  userQuestion: string;
  references: ReferenceItem[];
  mode: 'citation_filter' | 'faithfulness_only' | 'full';
  auxLlmConfig: { baseUrl: string; apiKey: string; model: string };
}
```

保留旧 `verify(response, question, citations, config)` 作为 deprecated adapter，内部调用 `verifyReferences(...)`。知识模式继续“只缩小 citation”；faithfulness 模式即使没有 citation 也可以返回 claim 统计，不能把工具 result 当成知识 citation。

### 3.2 ToolFaithfulnessVerifier

新增 `src/server/services/tool-faithfulness-verifier.ts`，或作为现有 verifier 的内部 adapter。输入应来自 `llm-streaming-service.ts:264-265` 的 `toolCallsData`，但必须保留 provider 的 `data` 和执行状态，不能只传截断后的 `result` 字符串。

```ts
export interface ToolExecutionReference {
  referenceId: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  data?: Record<string, unknown>;
  confidence: number;
  isMockData?: boolean;
  failed?: boolean;
}

export interface ToolFaithfulnessVerifier {
  verify(
    response: string,
    userQuestion: string,
    toolResults: ToolExecutionReference[],
    config: AuxiliaryLlmConfig,
  ): Promise<FaithfulnessVerification>;
}
```

优先采用字段级 deterministic checks（回答中的订单号、金额、状态、日期必须等于 `structuredData`），再对剩余自然语言调用 LLM judge。对 `apply_refund`/地址修改等敏感动作，执行失败或 mock 结果不得被判为高 grounding；回答声称“已完成”而结果为 pending/rejected 时直接记录 contradicted。

### 3.3 ConfidenceAggregator

建议把当前 `calculateConfidence`、`buildConfidenceFromContent`、`calculateSimulationConfidence` 的公式集中迁移，避免 production/simulation 漂移。接口应明确缺失信号、verifier 失败与“不适用”的区别：

```ts
export function aggregateConfidence(input: ConfidenceAggregationInput): ConfidenceBreakdownV2;
```

推荐规则：

1. grounding：知识、工具、商品/尺码 evidence 按实际存在的信号重新归一化；失败工具和 mock 只保留保守先验。
2. faithfulness：有 factual claims 时按支持关系计算；无 claims 为 `null`；verifier 失败为 `unavailable`，不能默认 1.0。
3. verifier 失败时 final 使用 `min(grounding_score, 0.5)`，并写 `verifier_error`；关键工具回答建议直接进入人工复核队列。
4. handoff intent 是决策惩罚，不是 faithfulness；保留当前 `0.35` 上限规则。
5. 子 Agent 分数只作为质量信号，不能覆盖 contradicted claim；删除当前 `calculateConfidence` 中 `Math.max(final, subAgent * 0.9)` 的覆盖式 boost。

## 4. 前后端影响

### 4.1 SSE

`llm-streaming-service.ts:759-772` 的 `done` payload 增加：

```ts
{
  done: true,
  confidence: finalConfidence, // 兼容旧客户端，deprecated
  final_confidence: finalConfidence,
  grounding_score: breakdown.grounding_score,
  faithfulness_score: breakdown.faithfulness_score,
  confidence_breakdown: breakdown,
  verification: {
    status: breakdown.faithfulness_status,
    supported_claim_count: breakdown.supported_claim_count,
    factual_claim_count: breakdown.factual_claim_count,
    contradicted_claim_count: breakdown.contradicted_claim_count,
    elapsed_ms: verificationElapsedMs
  }
}
```

`src/lib/sse-parser.ts`、`simulation-page.tsx:503-520`、聊天窗口和 monitor detail 必须接受新旧 payload；done 前断流仍允许只有部分 content，不应伪造新分数。

### 4.2 数据模型/API

当前 `schema.ts:241-244` 已有 `messages.confidence_breakdown jsonb`，`simulationMessages` 在 `905-908` 也有同名字段；规划中的迁移应扩展 JSONB contract，而非重复建列。若需要查询/排序，再增加 nullable 的 `grounding_score`、`faithfulness_score`、`final_confidence` 数值列；第一阶段不建议拆列以避免双写漂移。

`conversations` 当前架构主要使用 `metadata jsonb`（`AGENTS.md` 表说明）；建议增加 `confidence_breakdown jsonb`（或明确统一存 `metadata.confidence_summary`，不可两种并存）。它保存会话最新值和聚合统计，不替代每条 message 的 breakdown。

`messages`/simulation repository 的 select、insert、类型需保留 `confidence`，新增字段在 JSONB 中读取。API 响应同时返回 `confidence`（旧别名）和 `final_confidence`。`ConfidenceBreakdown` 保留为 deprecated alias，新增 `ConfidenceBreakdownV2`；阶段 1 可让 `final` alias 指向 grounding 旧值，阶段 3 切换为 final_confidence 后必须在字段文档标明语义变化。

### 4.3 前端

`source-panel.tsx:38-64` 的两个 breakdown 类型新增新字段。当前 `302-355` 的“综合置信度/知识库匹配/工具调用”应改成：

- 顶部显示“最终安全度/最终置信度”并明确不是正确率。
- 两个主卡片分别显示“依据强度（grounding）”和“回答忠实度（faithfulness）”。
- faithfulness 为 `null` 显示“不适用”，`unavailable` 显示“验证不可用”，不能显示 0%。
- citation item 增加 claim 支持状态、reference 类型和 tool 字段核验详情。
- 保留旧消息没有新字段时的 legacy 展示，但加“旧版指标”标识。

`bot-settings.tsx` 当前未在读取结果中发现专门的置信度阈值控件；阈值 UI 应在其承载的 AI/对话设置区增加 `confidence_metric_version`、`final_confidence_threshold`、`faithfulness_critical_threshold`、`verifier_enabled`。同时更新 settings types 和 `/api/settings` 保存逻辑。

## 5. 迁移策略

### 5.1 数据库迁移

新增类似 `supabase/migrations/20260730_confidence_grounding_faithfulness.sql` 的迁移：

1. `messages.confidence_breakdown` 和 `simulation_messages.confidence_breakdown` 继续为 nullable jsonb，补充 contract 不做历史 JSONB 强制回填。
2. 为 `conversations` 增加 `confidence_breakdown jsonb`（若实际 schema 已有同名列则只补索引/说明）。
3. 可选增加 `messages.final_confidence double precision`、`grounding_score double precision`、`faithfulness_score double precision`；仅在告警/统计需要 SQL 筛选时采用。
4. 旧记录不反推 faithfulness，写 `faithfulness_status='unavailable'`，避免把旧 grounding 冒充忠实度。
5. 对 jsonb 约定 `schema_version: 2`，并保留 `legacy_final`、`legacy_semantics: 'grounding'`。

### 5.2 双轨期

阶段 2-3 期间在 `LLMStreamingService` 同时计算：

- `legacy_confidence`：调用当前 `buildConfidenceFromContent`，供旧告警、旧客户端使用。
- `new_breakdown`：调用 verifier + `ConfidenceAggregator`，写入 `confidence_breakdown_v2` 或同一 JSONB 的 `v2` 节点。

前端默认读旧 `confidence`，后台记录新旧分布、差值、verifier latency 和 error rate。禁止用新字段覆盖旧字段，直到灰度指标满足门槛。

### 5.3 阈值重标定与灰度

当前 `alert-service.ts:20-29` 的 `0.4` 是旧 grounding 体系阈值，不能直接沿用。建议先用离线标注集校准：以“需要人工介入/事实错误”为正例，选择使 false negative 可接受的阈值；初始候选值为 `final_confidence < 0.55` warning、`<0.35` critical，`faithfulness_score < 0.5` 单独 warning，任一关键 claim contradicted 直接 critical。最终值由 2 周 shadow 数据决定，不应仅凭经验上线。

新增 feature flags（settings 或环境变量）：`confidence_v2_shadow`、`confidence_v2_final_enabled`、`confidence_v2_ui_enabled`、`confidence_verifier_enabled`、`confidence_v2_thresholds_enabled`。建议按 shop/bot 灰度，保留一键回滚到 legacy decision。

## 6. 测试策略

### 6.1 单元测试

新增 `src/server/services/confidence-aggregator.test.ts`：

- 只有高相关知识：grounding 高、faithfulness 未验证时不应自动高。
- 工具真实结果：tool grounding 高；工具结果与回答字段一致时 faithfulness 高。
- contradicted claim：faithfulness 降为低，final 受上限约束。
- unknown claim：低于 entailed，但不等于 contradicted。
- 无 factual claims：`faithfulness_score=null`、status `not_applicable`。
- verifier timeout：status `unavailable`，final 保守降级。
- handoff intent：final 上限 0.35。
- 子 Agent 不得覆盖 contradiction。

扩展 `claim-support-verifier.test.ts`：验证 tool reference、structuredData、source filtering 与旧 API adapter。扩展 `confidence-calculator.test.ts`，锁定旧函数只作为 legacy adapter。

### 6.2 集成场景

| 场景 | grounding | faithfulness | 预期决策 |
|---|---:|---:|---|
| 工具调用 + 忠实回答 | 高 | 高 | 自动回复 |
| 工具调用 + 幻觉补充 | 高 | 低 | 复核/转人工 |
| 知识库命中 + 忠实 | 高 | 高 | 自动回复 |
| 知识库命中 + 曲解 | 高 | 低 | 复核/转人工 |
| 无依据 + 常识答对 | 低 | `not_applicable` 或中 | 不宣称高正确率，允许低风险回复 |
| 无依据 + 编故事 | 低 | 低/不可验证 | 转人工或保守回复 |
| mock 工具 + 事实回答 | 低/中 | 需验证 | 禁止按真实数据高分 |
| 工具执行失败但回答“已完成” | 低 | contradicted | critical |

覆盖 `llm-streaming-service.ts:549-591` 的 verifier-before-aggregation 顺序、`759-772` SSE done、`814-860` persistence、`messages/route.ts:239-275` auto-reply 旁路和 `391-463` 子 Agent 旁路。

### 6.3 回归与验收

用现有 0.3 无支撑、0.35 handoff、0.4 告警、0.7-0.85 工具结果样例建立 snapshot；验收重点不是数值相等，而是：工具+幻觉不得保持高分、知识+曲解必须降分、verifier 失败不阻断主回复且不会错误升分。增加 shadow eval：记录旧/新决策、分数、人工最终结果、首 token latency 和总 latency。

## 7. 风险与权衡

- **延迟**：每条事实型回复增加一次 auxiliary LLM judge，预计 1-3 秒。建议 verifier 与非关键后处理并行，但必须在 done 前等待 faithfulness；支持超时预算和按场景跳过。
- **成本**：每条消息增加 verifier token 费用。限制最多 10 claims，先 deterministic field check；对 auto-reply、纯问候、无事实回复可跳过。
- **失败降级**：timeout/provider error/invalid JSON 不阻断回复；写 `faithfulness_status=unavailable`、`verifier_error`，final 采用保守上限并触发可配置 warning。citation 过滤仍遵循现有 fail-closed，但不能把 citation 失败误当成整条消息生成失败。
- **提示注入**：工具结果和知识内容必须明确作为 reference，不允许 reference 改写 verifier system instruction；structured field checks 优先于 LLM 判断。
- **兼容性**：现有 alert、自动转人工、dashboard 读取的是 `confidence`。双轨期间分别记录 `legacy_confidence` 和 `final_confidence`，`alert-service.ts:131-177` 接受 metric version；高轮次规则不变，但低置信度规则需切换 flag。
- **语义误导**：UI 继续称“置信度”会复制造成混淆，必须明确“依据强度/回答忠实度/最终安全度”，并在 API 文档标记 final 不是统计意义上的正确率。

## 8. 工作量估算

| 模块 | 预估人天 | 说明 |
|---|---:|---|
| 指标/类型/聚合器设计与实现 | 2-3 | 新 `ConfidenceAggregator`、legacy adapter、单元测试 |
| Claim verifier 扩展 | 2-3 | Reference abstraction、structured data、兼容旧 citation 模式 |
| Tool faithfulness 与 provider 数据透传 | 2-3 | tool execution record、字段核验、mock/failed 语义 |
| LLM streaming 接入 | 2-3 | 结束阶段 verifier、SSE、post-stream persistence |
| API/repository/schema/migration | 1.5-2.5 | messages/simulation/conversations、双写和回填策略 |
| Alert/settings/阈值校准 | 1.5-2 | flag、metric version、shadow 统计 |
| 前端 source panel 与消费端 | 2-3 | 新分解、状态、旧消息兼容 |
| 测试/标注集/灰度观测 | 3-5 | 单测、集成、回归、人工标注和阈值选择 |
| **总计** | **16-24 人天** | 不含外部工具 API 改造和产品文案评审 |

**关键路径**：Reference abstraction → verifier/tool data → aggregator → streaming done/persistence → threshold shadow → UI。可并行：数据库/类型、前端 contract adapter、测试样例与标注集、settings flag；但前端最终展示需等待 V2 payload 定稿。

## 9. 阶段切分建议

### 阶段 1：仅文档与命名

建立 `ConfidenceBreakdownV2`、字段字典、API/SSE schema 和 feature flag；代码只增加类型/adapter，不改变旧公式和旧阈值。同步更新 `AGENTS.md` 中“置信度”措辞为 grounding/faithfulness/final confidence。

### 阶段 2：增加 faithfulness 但不影响 final

扩展 `ClaimSupportVerifier`，加入 tool references 和 `ToolFaithfulnessVerifier`；`LLMStreamingService` 在 `fullContent` 完成后计算并写入 shadow JSONB，SSE 可通过 debug flag 发送新字段，但 alert/自动转人工仍读旧 `confidence`。

### 阶段 3：融合 final 并调整阈值

启用 `confidence_v2_final_enabled`，由 `ConfidenceAggregator` 提供 `final_confidence`；`AlertService` 按 metric version 使用新阈值；先按 shop/bot 灰度，持续比较人工接管率、错误率、verifier 失败率、延迟和成本，确认后扩大范围。

### 阶段 4：前端 UI 改造

启用 `confidence_v2_ui_enabled`；`SourcePanel` 展示两个独立指标和验证状态，monitor/simulation/chat 的消息类型统一；旧数据显示 legacy 标签，不进行历史伪回填。最后再移除旧 UI 对 `final` 的直接依赖，但保留 API alias 至少一个版本周期。

## 10. 关键文件清单

### 需要读取/核对

- `src/lib/confidence-calculator.ts`：当前 `ConfidenceBreakdown`、三条旧计算路径（约 `24-225`）。
- `src/server/services/claim-support-verifier.ts`：现有 claim/support schema 与 fail-closed citation 逻辑（约 `95-297`、`303-368`）。
- `src/server/services/llm-streaming-service.ts`：tool records（约 `264-265`）、verifier 与旧计算（约 `549-591`）、SSE done（约 `759-772`）、持久化（约 `814-860`）。
- `src/server/services/tool-execution-service.ts`：`ToolExecutionResult`（约 `6-16`）、`executeTool`（约 `101-133`）。
- `src/server/services/tool-providers/types.ts`：`ToolResult`（约 `8-19`）。
- `src/server/services/tool-providers/order-provider.ts`：真实/mock/fallback confidence（约 `63-85`、`123-137`）。
- `src/server/services/retrieval-orchestrator.ts`：`EvidenceBundle`、`EvidenceItem`、`CitationItem`（约 `44-103`）。
- `src/components/chat/source-panel.tsx`：旧 breakdown 类型与展示（约 `38-64`、`302-355`）。
- `src/components/settings/bot-settings.tsx`：Bot 设置承载区及 settings 类型调用。
- `src/server/services/alert-service.ts`：旧阈值与决策（约 `20-37`、`109-177`）。
- `src/app/api/conversations/[id]/messages/route.ts`：消息入口、auto-reply 和子 Agent 旁路（约 `239-275`、`391-463`）。
- `src/storage/database/shared/schema.ts`：messages/simulation messages JSONB（约 `232-255`、`896-918`）。
- `src/lib/sse-parser.ts`、`src/components/simulation/simulation-page.tsx`、`src/components/chat/chat-window.tsx`、`src/components/monitor/conversation-detail.tsx`：SSE 与消息消费。
- `AGENTS.md`：架构说明、表字段和当前 0.4 阈值语义（约 `16-34`、`232-245`）。

### 计划修改

- `src/lib/confidence-calculator.ts`：旧接口 deprecated、V2 类型/兼容 adapter。
- `src/server/services/llm-streaming-service.ts`：verifier/aggregator 接入、SSE done、持久化参数。
- `src/server/services/claim-support-verifier.ts`：通用 reference、tool reference、结果状态。
- `src/server/services/tool-execution-service.ts`、`src/server/services/tool-providers/types.ts`、各 provider：透传结构化 tool result 和执行状态。
- `src/server/services/retrieval-orchestrator.ts`：只补齐 evidence/reference 元数据，不承担 faithfulness。
- `src/app/api/conversations/[id]/messages/route.ts`、`src/app/api/simulations/[id]/messages/route.ts`：统一传递 verifier config/flags，处理旁路响应。
- `src/server/services/alert-service.ts`、`src/components/settings/bot-settings.tsx`、settings types/API：metric version、V2 阈值和 flags。
- `src/components/chat/source-panel.tsx`、`src/components/simulation/simulation-page.tsx`、`src/components/chat/chat-window.tsx`、`src/components/monitor/conversation-detail.tsx`、`src/lib/sse-parser.ts`：新字段和 UI。
- `src/storage/database/shared/schema.ts` 及 message/conversation/simulation repositories：JSONB contract、可选查询列、双写读取。
- `AGENTS.md`：删除“knowledge/tool/LLM self-eval = confidence”的混合表述，改为新指标定义。

### 计划新增

- `src/server/services/confidence-aggregator.ts`：唯一 final 公式和决策规则。
- `src/server/services/tool-faithfulness-verifier.ts`：工具结果字段级与 LLM judge 核验（若选择合并，则不新增此文件）。
- `src/lib/confidence-types.ts`：若 `confidence-calculator.ts` 继续承担计算，类型可不拆；否则集中导出 V2 contract。
- `src/server/services/confidence-aggregator.test.ts`、`src/server/services/tool-faithfulness-verifier.test.ts`：单元/故障降级测试。
- `supabase/migrations/20260730_confidence_grounding_faithfulness.sql`：schema version、conversation breakdown、可选数值列和兼容说明。

### 明确不在本规划阶段执行

不修改现有 TypeScript/TSX/SQL 业务文件，不运行迁移、不改变线上阈值、不切换 UI、不删除旧 `confidence` 字段；本文件是后续实现的设计基线。
