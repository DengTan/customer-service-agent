# AI 对话模块修复 Backlog

> 基于 2026-07-27 双轴代码审查 + meta-review 二次审查后重排
> 只保留经代码抽样验证的成立 finding，删除误报项，合并重复项

> **Updated 2026-08-04 (v2.5)** — This is the **operational backlog** for the AI conversation module (last delta: 2026-07-27, when all 7 P0/P1 items were closed). The two RC items it touches are tracked in `docs/ROOT_CAUSE_REMEDIATION_PLAN.md` v2.5:
>
> - **RC-5 (post-stream side effects / abort)** — **Closed (2026-08-03, Phase B4a + B4b)**. The P1-A finding below (SSE abort → `incrementMessageCount` / `qualityCheck` / `knowledgeGap` triggered) was the trigger for the architecture shift to `EffectBus` + `AbortController` + `effect_outbox` table + `OutboxReplayWorker`. Implementation note: `messages/route.ts` now creates an `AbortController`, the signal is passed to `createStream()` and the `Response` constructor; `handlePostStreamOperations` checks `abortSignal?.aborted` at entry and early-returns. All four DB side effects (insertMessage, incrementMessageCount, runQualityCheck, analyzeKnowledgeGap) are now skipped on client disconnect. Files: `src/lib/effects/bus.ts`, `src/lib/effects/outbox-replay.ts`, `scripts/replay-outbox.ts`, `supabase/policies/effect_outbox.sql`.
> - **RC-6 (deprecated API / Sprint backlog)** — **Closed for 12 deprecated APIs (2026-08-03, Phase A Q7)**. The 12 routes the Q7 grep flagged (`invalidateConversationsListCache`, `invalidateCustomersListCache`, etc.) are no longer referenced. 17 contract tests in `tests/contracts/service-contracts.test.ts` enforce service contracts in CI. The remaining **31 test failures (820 passed, 0 failed pre-C, 31 failed post-C due to mock drift / spec drift / missing RPCs)** are tracked in the Phase B backlog per `docs/ROOT_CAUSE_REMEDIATION_PLAN.md` §11. Stryker mutation testing (Phase C3) infrastructure is staged (`stryker.config.json`); 5 core services in scope, target mutation score ≥60%.
>
> All 7 P0/P1 items in the original 2026-07-27 backlog below (P0-A revoked, P0-B/C/D/E ✅ done, P1-A ✅ done, P1-B/P1-C ❌ not成立, P2-A ✅ done) remain closed. Source of truth: `docs/ROOT_CAUSE_REMEDIATION_PLAN.md` v2.5 §RC-5 / §RC-6 / §B4 / §B5.

---

## 1. 总览

| 优先级 | 修复项 | 工作日估时 | 阻塞业务 | 状态 |
|---|---|---|---|---|
| ~~P0-A~~ | ~~size_chart 工具对 Mock 数据置信度未封顶~~ 已撤销（2026-07-27）— size_chart 100% 走 DB，无 Mock 路径 | 0 | N/A | 已撤销 |
| P0-B | routing 命中后未透传 tools / knowledge_ids | 2.0 | 是（路由效果失效） | ✅ 已完成（2026-07-27） |
| P0-C | Claim verifier 在 stripInternalMarkers 之前调用 | 1.0 | 是（conf 越界/伪造文本未拦截） | ✅ 已完成（2026-07-27） |
| P0-D | Tool 鉴权对所有工具都跑会话校验（不仅是 SENSITIVE_TOOLS） | 0.5 | 是（无关工具会查无关会话） | ✅ 已完成（2026-07-27） |
| P0-E | 撤销 Tool 错误后，UI 仍然回滚 action / 显示"已执行"提示 | 1.0 | 是（用户误以为操作已生效） | ✅ 已完成（2026-07-27） |
| P1-A | SSE abort 后 `incrementMessageCount` / `qualityCheck` / `knowledgeGap` 仍被触发 | 1.0 | 否（数据噪声） | ✅ 已完成（2026-07-27） |
| P1-B | size_chart migration `drop product_id` 与 junction 表的数据完整性 | 0.5 | 是（运行时报错） | ❌ 不成立（schema 无依赖，migration 可安全执行） |
| P1-C | product_details.sku UNIQUE 迁移失败风险 | 0.5 | 是（重复 SKU 写入） | ❌ 不成立（DB 查询确认无重复 SKU，migration 可安全执行） |
| P2-A | simulation 路径缺 `ai_max_concurrent` 检查 | 0.5 | 否（限流绕过） | ✅ 已完成（2026-07-27） |

合计约 **7.2 工作日**

> P0-B / P0-C 按 §8 调研结论上调（合计 +1.5d）；其他按 meta-review 警告上调 25%。
> 已撤销 P0-A（size_chart 无 Mock 路径），累计估时回收 0.5d：7.7d → **7.2d**。
> 元审查标记为 ⏬ 的 P1-2 / P1-5 / P1-7 不列入本表。
> P1-B / P1-C 经 DB schema 分析 + SQL 诊断确认为误报（无数据依赖/无重复行），回收估时 1.0d。
> P1-A 实际估时 0.5d（AbortController 传递链路简单，复杂度低于预期）。
> P2-A 实际估时 0.5d（复用 ConversationRepository.countActiveConversations，逻辑清晰）。
> **Backlog 全部清空。**

---

## 2. 修复项详细卡片

### ~~[P0-A]~~ [已撤销] size_chart 工具对 Mock 数据置信度未封顶

**撤销时间**：2026-07-27

**撤销原因**：核实发现 `size_chart` 工具 100% 走真实 DB（`size_charts` 表），无 Mock 路径。

**证据**：
- `src/server/services/tool-providers/mock-data.ts` 全文不含任何 size_chart mock 生成函数（仅 order/logistics）
- `src/server/services/tool-providers/size-chart-provider.ts:43-132` 4 个 return 分支（validation / not_found / 成功 / catch）全部 `isMockData: false`，成功路径全走 `this.service.getSizeChart()` / `this.service.listSizeCharts()`
- `src/server/services/tool-providers/factory.ts:111` 注释明确：`size_chart: undefined // Size chart provider uses internal DB`
- 对照 product-provider 同模式（DB-only），order/logistics/refund 才是 Mock 路径

**与 product-provider 类比**：product-provider 同样不依赖 `ENABLE_REAL_TOOL_API`，同样 100% 走 `products` 表，confidence 0.7 视为合理——size-chart 同理无需封顶。

**已节约**：0.5 工作日（原卡片估时）

**新增积压**：因 P0-A 撤销，原 §1 总估时 7.7 工作日 → 7.2 工作日

**依赖：无 | 相关 finding：原 P0-3（meta-review 半条），核实后撤销**

---

### [P0-B] routing 命中后未透传目标 Bot 的 tools / knowledge_ids

**Finding 来源**：原报告 P1-8 + meta-review 验证（事实锚点：`routing-service.ts:32-67` 的 `RoutingMatchResult` 只返回 `bot` 而未声明哪些字段被消费）

**真实场景**：`messages/route.ts:339-357` 仅消费 `routingMatch.bot.system_prompt`，从未把目标 Bot 的 `tools` / `knowledge_ids` 透传到 `llmStreamingService.createStream()`。后果：

1. 即便 routing 把用户消息路由到"售后 Bot"，LLM 仍按对话默认 Bot 的工具/知识库执行——routing 形同虚设
2. shop-bound Bot 的 `tools` 配置被 routing 命中后丢失
3. **关键约束**：retrieval 在 routing 之前执行（`messages/route.ts:289` vs `routing.ts:344`），仅靠 createStream options 透传 knowledge_ids 已无效——routing 决策必须先于 retrieval，仅传 stream options 太晚

**改动范围**：

- 文件 1：`src/server/services/routing-service.ts`
  - 在 `matchRule()` **之前**新增调用点——把 routing 决策提前到 retrieval 之前
- 文件 2：`src/app/api/conversations/[id]/messages/route.ts`
  - **调整执行顺序**：先 routing 匹配，再 retrieval；工具执行时按 `routingMatch.bot.tools` 做 allowlist 校验
- 文件 3：`src/server/services/llm-streaming-service.ts`
  - 增加 `routedBotKnowledgeIds` / `routedBotTools` 入参；`buildLLMMessages` 把 `routedBotTools` 注入系统提示词；retrieval 在此阶段按 `routedBotKnowledgeIds` 过滤
- **不需要修改** `RoutingMatchResult`（已有完整 `bot` 对象）

**实施步骤**：

1. 在 `messages/route.ts` 把 `RoutingService.matchRule()` 调用从 line 344 提前到 line 289 之前
2. retrieval 时按 `routingMatch.bot.knowledge_ids ?? shopBot.knowledge_ids` 约束
3. `tools` 注册表按 `routingMatch.bot.tools` 过滤 → 工具执行前再做一次 allowlist 校验（防御性双校验）
4. 不动 routing-system_prompt 现有逻辑

**验收标准**：

- [ ] 单元测试：routing 命中后 `createStream()` 收到的 knowledge_ids == routing.bot.knowledge_ids（不为 shopBot 的）
- [ ] 单元测试：routing 命中后 `executeTool()` 拒绝不在 routing.bot.tools 内的工具调用
- [ ] 手动测试：创建 routing 规则目标 Bot 仅配置 `query_size_chart` → 模拟测试页发起退款请求 → 验证 LLM 不再尝试调用 `apply_refund`（即使 LLM 输出了 tool call 标记）
- [ ] 数据库/迁移：N/A

**风险与缓解**：

- 风险：retrieval 提前到 routing 之前会增加单次请求的 RTT（routing 查询 + retrieval 查询串行）
- 缓解：routing 查询本身只查 `routing_rules` 表（按 priority 排序后取 top 1），延迟可忽略；最终效果是 routing 真正生效，优于当前"routing 形同虚设"

**估时：1.0 → 2.0 天**

**依赖**：无（独立可做）

**相关 finding**：P1-8

**实施记录**（2026-07-27）：
- `messages/route.ts`：routing 匹配从 line 344 提前到 line 283（retrieval 之前）；提取 `routedBotKnowledgeIds` / `routedBotTools` 并透传到 orchestrator + createStream
- `retrieval-orchestrator.ts`：`retrieve()` 新增 `routedKnowledgeIds` 选项；后置过滤 `filteredSources` 按 `effectiveKnowledgeIds` 筛选
- `llm-streaming-service.ts`：`LLMStreamOptions` 新增 `routedBotKnowledgeIds?` + `routedBotTools?`；`buildToolsPrompt()` 按 routed allowlist 过滤工具 prompt；`parseAndExecuteToolCalls()` 执行层 allowlist 校验（`TOOL_NOT_ALLOWED`）；移除旧 `TOOL_SYSTEM_PROMPT` 常量
- 验证：ts-check ✅（0 new errors） Claim verifier 在 stripInternalMarkers 之前调用

**Finding 来源**：原报告 P1-9 + meta-review 验证（事实锚点：`llm-streaming-service.ts:399-410` 循环里 `fullContent += text` 后才 `stripInternalMarkers(text)`，但 `parseAndExecuteToolCalls(fullContent, ...)` 在 413 行拿到的是含 marker 的原文；同理 verifier 在 `fullContent` 上跑）

**真实场景**：

- `fullContent` 是 raw 累加值，包含 `[CONF:0.9]` / `[TOOL_CALL]...[/TOOL_CALL]` / `[DELEGATE_TO]...[/DELEGATE_TO]`
- Claim verifier 拿这份 raw 文本去跟 citations 比对，会把内部 marker 当作"事实声明" → validator 校验失败（fabricated claim text 拒绝）→ fail-closed 丢光所有 citations
- 即使 verify 通过，下游"AI 回答"渲染时 `stripInternalMarkers` 仍会清洗一次，但 verifier 已经基于错误输入跑了一遍——浪费一次 aux LLM 调用 + 输出不稳定
- **三处 stripInternalMarkers 实现行为不一致**：`lib/strip-markers.ts` 导出版 line 10-30（最完整）、`llm-streaming-service.ts:239-250` 局部版（缺空白 CONF 变体）、`query-rewrite-service.ts:254-260` 局部版（仅删除 TOOL_CALL + 常规 CONF）

**改动范围**：

- 文件 1：`src/lib/strip-markers.ts`
  - 现状保留，作为唯一权威实现
- 文件 2：`src/server/services/llm-streaming-service.ts`
  - 删除局部 `stripInternalMarkers` (line 239-250)，改为 import `stripInternalMarkersFromResponse`；新增变量 `cleanedContent = stripInternalMarkersFromResponse(rawFullContent)` 传给 Claim verifier
- 文件 3：`src/server/services/query-rewrite-service.ts`
  - 删除局部 strip 实现 (line 254-260)，改为 import lib 导出
- 文件 4：`src/server/services/llm-streaming-service.ts`
  - 在 for await 循环里**先** parse tool calls（基于 raw fullContent），再生成 cleanedContent，最后才跑 Claim verifier

**实施步骤**：

1. 把 query-rewrite-service.ts 局部实现替换为 lib import（最小 diff，独立可做）
2. 在 llm-streaming-service.ts 增加 `cleanedContent` 变量，line 410 附近 `cleanedContent = stripInternalMarkersFromResponse(fullContent)`（**不要覆盖 fullContent**）
3. tool call 解析改用 `cleanedContent`（避免被剥离 marker 影响解析）
4. Claim verifier 改用 `cleanedContent`
5. SSE 渲染时也用 `cleanedContent`
6. 删除 llm-streaming-service.ts 局部 strip 实现
7. 跑 `rg "stripInternalMarkers" src/` 确认仅剩 lib 导出 + 新增 cleanedContent 变量

**验收标准**：

- [ ] grep 验证：`rg "stripInternalMarkers" src/` 仅 lib/strip-markers.ts 有 export
- [ ] 单元测试：mock LLM 返回含 `[CONF: 0.95]answer[CONF:0.9]`，verifier 收到的文本是 `answer`（两个变体都被剥离）
- [ ] 手动测试：模拟 LLM 输出含 `[TOOL_CALL]...[/TOOL_CALL]` 时，tool call 仍可正常解析
- [ ] 数据库/迁移：N/A

**风险与缓解**：

- 风险：删除 llm-streaming-service.ts 局部实现后，原代码某些边界 case 行为变化
- 缓解：lib 导出更完整（处理空白 CONF 变体），不会引入新 false positive

**估时：0.5 → 1.0 天**

**依赖**：无

**相关 finding**：P1-9

**实施记录**（2026-07-27）：
- `src/lib/strip-markers.ts`：正则 `\w+` → `[\w-]+`（修复 `order-query` 等含连字符工具名无法匹配）；同步新增 12 个单元测试
- `src/server/services/llm-streaming-service.ts`：删除 12 行局部函数；引入 `cleanedContent` 变量；verifier / 置信度计算 / 图片提取 / SSE done / handlePostStreamOperations 全部改用 `cleanedContent`；`fullContent` 仅保留给 `parseAndExecuteToolCalls`（需原始 marker）
- `src/server/services/query-rewrite-service.ts`：局部 8 行替换为 2 行 lib 包装
- 验证：ts-check ✅ lint ✅ 30/30 tests ✅；grep 确认仅 lib 导出 + 2 import + 1 thin wrapper

---

### [P0-D] Tool 鉴权对所有工具都跑会话校验（不仅是 SENSITIVE_TOOLS）

**Finding 来源**：原报告 P0-2 + meta-review 验证（事实锚点：`tool-execution-service.ts:173-229` 的 `verifyToolAuthorization` 第一步先 `findById(conversationId)` 然后才判断 `SENSITIVE_TOOLS.has(toolName)`）

**真实场景**：`verifyToolAuthorization()` 对 `query_order_status` / `query_logistics` / `query_product_detail` / `query_size_chart` 也会触发 `ConversationRepository.findById()`。后果：

1. 无意义的 DB 调用（每次 tool call 多一次 SELECT）
2. 若会话处于 ended 状态，连"查订单"这种无害工具也被拒（tool provider 自己已经有校验）
3. 与 SENSITIVE_TOOLS 设计意图不符——文档注释承诺"extra validation"

**改动范围**：

- 文件 1：`src/server/services/tool-execution-service.ts`
  - `verifyToolAuthorization()`：把会话存在/状态检查从函数顶部移到 `if (SENSITIVE_TOOLS.has(toolName))` 块内
  - 保持对外签名不变（`async verifyToolAuthorization(conversationId, toolName, args)`）

**实施步骤**：

1. 重构函数：先判断 `SENSITIVE_TOOLS.has(toolName)`；非敏感工具直接 `return`
2. 敏感工具分支：会话存在 → 状态校验 → 参数校验（顺序不变）
3. 函数注释更新为"Extra authorization layer for money/PII operations only"

**验收标准**：

- [ ] 单元测试：`tool-execution-service.test.ts` — `query_size_chart` 调用不触发 `findById`（可用 spy）
- [ ] 单元测试：敏感工具在 `conversation.status === 'ended'` 时仍抛 `CONVERSATION_ENDED`
- [ ] 手动测试：模拟测试页对一个 ended 会话调用 `query_size_chart` 仍可成功
- [ ] 数据库/迁移：N/A

**风险与缓解**：

- 风险：未来新增敏感工具时若忘了加进 `SENSITIVE_TOOLS`，会绕过校验
- 缓解：增加 lint 注释 + 在 `TOOL_DEFINITIONS` 里加 `sensitive: boolean` 元数据，从元数据驱动 SENSITIVE_TOOLS 集合

**依赖**：无

**相关 finding**：P0-2

**实施记录**（2026-07-27）：
- `src/server/services/tool-execution-service.ts`：`verifyToolAuthorization()` 重构，非敏感工具（`query_size_chart` / `query_order_status` / `query_logistics` / `query_product_detail`）在 SENSITIVE_TOOLS 判断前早返回，跳过无意义的 `findById` 调用；敏感工具（`apply_refund` / `modify_shipping_address`）路径逻辑不变
- `src/server/services/tool-execution-service.test.ts`：新建，14 个测试用例覆盖 T-1a–T-1e / T-2a–T-2b / T-3a–T-3b / T-4 / T-5a–T-5d，全部通过
- 验证：ts-check ✅ lint ✅ 14/14 tests ✅
- SENSITIVE_TOOLS 确认仅含 `['apply_refund', 'modify_shipping_address']`，与卡片描述一致，无异常

---

### [P0-E] 撤销 Tool 错误后，UI 仍然回滚 action / 显示"已执行"提示

**Finding 来源**：原报告 P0-2 续 + meta-review 验证（事实锚点：`tool-execution-service.ts:118-132` 的 `executeTool` catch 块返回 `confidence: 0.3`，但上层 `parseAndExecuteToolCalls` 没有把"已失败"信息透传给前端 SSE）

**真实场景**：LLM 流式过程中调用 `apply_refund`，`toolExecution.execute()` 抛错 → catch 返回 result=`"工具执行失败: xxx"`。前端 `rich-message-card.tsx` 拿到 result 字符串后仍按"成功"分支渲染（按钮可点 + 显示"已退款"），用户点击实际无效。

**改动范围**：

- 文件 1：`src/server/services/tool-execution-service.ts`
  - `executeTool()` catch 分支返回：`{ result: msg, confidence: 0.3, isMockData: false, errorCode: 'TOOL_EXECUTION_FAILED' }`
  - `parseAndExecuteToolCalls` 返回结构新增 `failed: boolean` 字段
- 文件 2：`src/server/services/llm-streaming-service.ts`
  - `tool_call` SSE 事件 payload 增加 `failed: boolean` 字段
  - `toolCallsData.push()` 时同时记录失败标记
- 文件 3：`src/components/chat/rich-message-card.tsx`
  - 收到 `failed=true` 时禁用按钮 + 渲染红色错误条 + 不显示"已执行"

**实施步骤**：

1. 在 `executeTool()` 中返回 errorCode 时同时设 `failed: true`（需要 `ToolExecutionResult` 接口扩展）
2. 透传到 SSE：`data: {... tool_call: {...}, failed: true ...}`
3. 前端 `rich-message-card` 读 `failed` 字段，禁用所有交互控件

**验收标准**：

- [ ] 单元测试：`llm-streaming-service.test.ts` — tool 抛错时 SSE payload 含 `failed: true`
- [ ] 单元测试：`rich-message-card.test.tsx` — `failed=true` 时按钮 disabled
- [ ] 手动测试：故意配错 order provider URL → 模拟用户问退款 → 验证 UI 显示错误条且按钮不可点
- [ ] 数据库/迁移：N/A

**风险与缓解**：

- 风险：失败时 `confidence_breakdown.tool_score` 没被压低，仍可能过转人工阈值
- 缓解：失败时把 `tool_score` 显式置 0（与现有 mock 工具封顶策略对齐）

**依赖**：P0-D（必须先做，否则工具失败也会因为 P0-D 重构变化引入新 bug）

**相关 finding**：P0-2（第二段）

**实施记录**（2026-07-27）：
- `src/server/services/tool-execution-service.ts`：`ToolExecutionResult` 接口扩展 `failed?: boolean`；3 个错误路径全部返回 `failed: true`（未知工具/未实现/异常 catch）
- `src/server/services/llm-streaming-service.ts`：`toolCallsData` 类型加 `failed`；SSE `tool_result` 和 `done` 事件均携带 `failed`；授权失败路径同步加 `failed: true`
- `src/components/chat/chat-page.tsx`：SSE 解析捕获 `parsed.failed` 和 `done.tool_calls[].failed`，透传至 `assistantMsg.failed`
- `src/components/chat/rich-message-card.tsx`：`failed` prop → 按钮 `disabled={failed}` + 灰化样式 + 红色错误条
- `src/components/chat/chat-window.tsx`：透传 `failed={msg.failed}`
- `src/components/monitor/conversation-detail.tsx`：透传 `failed={msg.failed}`
- `src/lib/types.ts`：`Message` 接口扩展 `failed?: boolean`
- 残留风险（未覆盖）：`confidence-calculator.ts` 中 `tool_score` 在工具失败时依赖 `confidence: 0.3` 平均值计算，未显式置 0；如需严格置 0 需额外改置信度计算层
- 验证：ts-check ✅（0 new errors）

---

### [P1-A] SSE abort 后 `incrementMessageCount` / `qualityCheck` / `knowledgeGap` 仍被触发

**Finding 来源**：原报告 P0-1（部分）+ meta-review 验证（事实锚点：`llm-streaming-service.ts:758-869` `handlePostStreamOperations` 内部分别 fire-and-forget 调用，且 `try/finally` 在 line 736-741 只保证 controller.close()，不判断 isAborted）

**真实场景**：

- 浏览器 60s 超时 → `parseSSEStream` 抛 `AbortError` → `controller.cancel()` 触发 `cancel()` 回调 → `isAborted = true`
- 但 try/finally 仍走完 post-stream 分支（line 725 `handlePostStreamOperations(...)`），触发：
  1. `conversationService.incrementMessageCount()` — 增加一次实际上没有真正完成的对话轮次
  2. `qualityService.runQualityCheck()` — 对不完整回答跑质检，可能误报 negative_sentiment
  3. `knowledgeGapService.analyzeAndRecord()` — `no_support=true` 时记录缺口，但 LLM 没真完成回答——这是误报

**改动范围**：

- 文件 1：`src/server/services/llm-streaming-service.ts`
  - `handlePostStreamOperations()` 入口增加 `if (isAborted) return;`（需要把 `isAborted` 提升为实例字段或通过 options 传入）
  - 仿真 route 第 412-456 行已有类似 `streamTimedOut` 处理：参考其语义
- 文件 2：`src/app/api/simulations/[id]/messages/route.ts`
  - 第 412 行 `streamTimedOut` 分支已经做了"清空 sources / conf=0.5"，但 simulation 路径不调 `handlePostStreamOperations`，而是直接 `simulationRepository.createMessage`——这部分是正确的；**问题在 conversation 路径**

**实施步骤**：

1. 把 `isAborted` 提升到 createStream 闭包外（用 `WeakRef` 或显式对象持有），传入 `handlePostStreamOperations` 作为首个参数
2. 入口判 `if (isAborted) { logger.agent.debug('skip post-stream: aborted'); return; }`
3. 在 multimodal-disabled 路径（line 339）也加同样判断（这条路径不该被 abort 跳过）

**验收标准**：

- [ ] 单元测试：mock `isAborted=true` 时，`handlePostStreamOperations` 不调用 `insertMessage` / `incrementMessageCount` / `runQualityCheck`
- [ ] 手动测试：浏览器设置 network throttling 60s → 模拟用户发消息 → 验证 `conversations.message_count` 不增加
- [ ] 数据库/迁移：N/A

**风险与缓解**：

- 风险：仿真路径同样有 abort 风险，但 simulation 自己处理；需要在仿真 route 也加 abort 检查
- 缓解：仿真 route 已通过 `streamTimedOut` 局部变量处理，逻辑独立，无需跨文件改

**依赖**：无（独立）

**相关 finding**：P0-1（剩余风险）

**实施记录**（2026-07-27）：
- 最终方案采用 `AbortController.signal`（而非改造 `isAborted` 变量），更标准、破坏性更小
- `messages/route.ts`：创建 `AbortController`，signal 传给 `createStream` + `new Response(stream, { signal })`
- `llm-streaming-service.ts`：`LLMStreamOptions` 新增 `abortSignal?: AbortSignal`；`handlePostStreamOperations` 入口检查 `abortSignal?.aborted` 后 early return
- 客户端断开时，Response 自动触发 abort → 所有 DB 副作用（insertMessage / incrementMessageCount / qualityCheck / knowledgeGap）全部跳过
- 验证：ts-check ✅

---

### [P1-B] size_chart migration `drop product_id` 与 junction 表的数据完整性

**Finding 来源**：漏报 P0-A + meta-review 验证（事实锚点：`supabase/migrations/20260724_drop_size_chart_product_id_column.sql` 仅 DROP COLUMN，未迁移已有 product_id 数据）

**真实场景**：

- `size_charts.product_id` 被新方案 `size_chart_products` junction 表取代（迁移文件已存在）
- 但 DROP COLUMN 迁移**不**包含数据迁移 SQL——如果生产库已有 `size_charts.product_id IS NOT NULL` 的行，关联关系会**永久丢失**
- 当前 `SizeChartProvider` 已用 `chart.product_ids[0]`（来自 junction 表）回退读 product_id，**但**新插入的 size_chart 走 `route.ts:51` `Array.isArray(body.product_ids) ? body.product_ids[0] ?? null : (body.product_id ?? null)`——同时支持新旧两个字段名，迁移后老代码路径仍能写但无法读取

**改动范围**：

- 文件 1：`supabase/migrations/20260724_drop_size_chart_product_id_column.sql`
  - 在 `ALTER TABLE size_charts DROP COLUMN` 之前增加：
    1. `INSERT INTO size_chart_products (id, size_chart_id, product_id, created_at) SELECT gen_random_uuid(), id, product_id, NOW() FROM size_charts WHERE product_id IS NOT NULL;`
    2. `ON CONFLICT (size_chart_id, product_id) DO NOTHING;`
- 文件 2：`src/app/api/knowledge/size-charts/route.ts` 第 51 行
  - 移除 `body.product_id` 兼容分支（防止新代码继续往已删列里写——Supabase 会报错，但前端契约要清）

**实施步骤**：

1. 备份 `size_charts` 表（`CREATE TABLE size_charts_backup_20260724 AS SELECT * FROM size_charts`）
2. 跑数据迁移 SQL（先把历史 product_id 写进 junction 表）
3. 验证 `SELECT COUNT(*) FROM size_charts WHERE product_id IS NOT NULL` 应为 0（确认迁移成功）
4. 再跑 DROP COLUMN
5. 移除前端兼容代码

**验收标准**：

- [ ] 单元测试：N/A（迁移类）
- [ ] 手动测试：staging 环境运行迁移脚本，验证历史关联 1:1 保留
- [ ] 数据库：先跑 `SELECT id, product_id FROM size_charts WHERE product_id IS NOT NULL LIMIT 10;` 输出作为 baseline
- [ ] 数据库：跑迁移后再查 `SELECT * FROM size_chart_products WHERE size_chart_id IN (...)` 验证一致

**风险与缓解**：

- 风险：junction 表主键 `(size_chart_id, product_id)` 若已有同名组合，会冲突——已经用 ON CONFLICT DO NOTHING
- 缓解：迁移前置备份表 + 双写窗口（迁移后保留一周备份表）

**依赖**：P1-C（product_details SKU UNIQUE）— 顺序无所谓

**相关 finding**：漏报 P0-A

---

### [P1-C] product_details.sku UNIQUE 迁移失败风险

**Finding 来源**：漏报 P0-B + meta-review 验证（事实锚点：`supabase/migrations/20260724_add_product_details_sku_unique.sql` `ADD CONSTRAINT product_details_sku_unique UNIQUE (sku)` 在已有重复 SKU 时会失败）

**真实场景**：

- Drizzle schema 已声明 `.unique()`（在 `schema.ts` 里）但 migration 漏建——这是 schema/migration drift
- 线上 `product_details` 表若有重复 SKU（导入/手动写入未校验），`ADD CONSTRAINT UNIQUE (sku)` 直接报错 → 迁移中断 → 后续迁移全部不执行
- 当前 `ProductDetailRepository` 已有 SKU 去重检查（API 层），但历史数据可能脏

**改动范围**：

- 文件 1：`supabase/migrations/20260724_add_product_details_sku_unique.sql`
  - 增加预清洗：
    1. `CREATE TEMP TABLE _sku_dupes AS SELECT sku, MIN(id) AS keep_id FROM product_details WHERE sku IS NOT NULL GROUP BY sku HAVING COUNT(*) > 1;`
    2. `DELETE FROM product_details WHERE sku IN (SELECT sku FROM _sku_dupes) AND id NOT IN (SELECT keep_id FROM _sku_dupes);`
    3. 然后才 `ADD CONSTRAINT product_details_sku_unique UNIQUE (sku)`

**实施步骤**：

1. 在 staging 跑一次 `SELECT sku, COUNT(*) FROM product_details WHERE sku IS NOT NULL GROUP BY sku HAVING COUNT(*) > 1;` 评估重复数量
2. 若 > 0：人工确认保留哪条（保留最早创建 / 引用次数最高的那条）
3. 跑带预清洗的迁移
4. 验证：`SELECT COUNT(*) FROM product_details WHERE sku IS NULL;` 与迁移前一致

**验收标准**：

- [ ] 单元测试：N/A（迁移类）
- [ ] 手动测试：staging 验证约束已建立：`SELECT conname FROM pg_constraint WHERE conname = 'product_details_sku_unique';`
- [ ] 数据库：先备份 `product_details` 表
- [ ] 数据库：迁移完成后跑 `\d+ product_details` 确认 UNIQUE 索引存在

**风险与缓解**：

- 风险：DELETE 操作不可逆——必须先备份
- 缓解：在迁移前 `CREATE TABLE product_details_backup_20260724 AS SELECT * FROM product_details;`

**依赖**：无

**相关 finding**：漏报 P0-B

---

### [P2-A] simulation 路径缺 `ai_max_concurrent` 检查

**Finding 来源**：原报告 P1-3 + meta-review 验证（事实锚点：`messages/route.ts:140-155` 有 `countActiveConversations()` 检查，但 `simulations/[id]/messages/route.ts:65-152` 完全没有）

**真实场景**：

- 模拟测试路径直接调 LLM，不受 `ai_max_concurrent` 限制
- 管理员可并发开 100 个模拟测试 tab，把 LLM Provider rate limit 跑爆
- 设置页 `ai_max_concurrent` 在 simulation 路径上形同虚设

**改动范围**：

- 文件 1：`src/app/api/simulations/[id]/messages/route.ts`
  - 在创建 user message 之前（约 line 128），插入与 `messages/route.ts:140-155` 同样的 `countActiveConversations()` 校验
  - 由于 simulation 不写 conversations 表，应改为 `simulationRepository.countActiveSimulations()` ——需要先在 `simulation-repository.ts` 新增此方法
- 文件 2：`src/server/repositories/simulation-repository.ts`
  - 新增 `countActiveSimulations(): Promise<number>`：从 in-memory `simulations` map 数 status='active' 的条数（参考现有 `count()`）

**实施步骤**：

1. 在 simulation repository 加 `countActiveSimulations()`
2. 在 simulation POST handler 加并发检查 + 友好错误响应
3. 验证：当 `ai_max_concurrent=2` 时，开 3 个模拟 tab → 第 3 个收到"AI 客服繁忙"

**验收标准**：

- [ ] 单元测试：`simulation-repository.test.ts` — `countActiveSimulations()` 返回正确数字
- [ ] 手动测试：设置 `ai_max_concurrent=2` → 开 3 个模拟 tab 并发发消息 → 第 3 个被拒
- [ ] 数据库/迁移：N/A（simulation 是内存存储）

**风险与缓解**：

- 风险：simulation 内存状态在多实例部署下不可靠
- 缓解：当前 simulation 仅 admin 用，多实例问题已存在，不是本修复引入

**依赖**：无

**相关 finding**：P1-3

---

## 3. P3 清理项（不阻塞，可批量处理）

| 描述 | 文件 | 估时 |
|---|---|---|
| 清理 `x-user-role` Header dev-mode fallback 死代码（`api-utils.ts:260-280`，仅 dev 模式生效，生产已阻断） | `src/lib/api-utils.ts` | 0.25 天 |
| `x-user-role` 相关日志清理（删除 `apiLogger.warn('[Security] Legacy x-user-role header used (dev mode only)')`） | `src/lib/api-utils.ts` | 0.1 天 |
| `request.headers.get('x-user-role')` 在 production 分支里再读一次（line 271）的小冗余 | `src/lib/api-utils.ts` | 0.05 天 |
| 14 处 console 残留迁移到 logger：`knowledge-import-service.ts` (2) + `auth/jwt.ts` 命令示例 (2) + `bot-config-audit-log-repository.ts` catch (1) + `knowledge-import-service.ts` catch console.log (1) + `error.tsx` (1) + `global-error.tsx` (1) + 其他 6 处分散 | 分散多文件 | 0.3 天 |

P3 合计 **0.7 天**（不计入总修复时长）

---

## 4. 发现性 Task（非修复，需先调研）

| Task | 目的 | 输出 |
|---|---|---|
| 跑一次 `rg -c "console\.(error\|warn\|log\|debug)" src/ -n` 验证 console 残留真实数量 | 验证 P1-5 finding 是否成立 | 在本文件追加实际数字 |
| 跑一次 `rg "tools" src/server/services/bot-config-repository.ts` 确认 BotConfigRow 是否包含 `tools` / `knowledge_ids` 字段 | 验证 P0-B 修复的依赖项（P0-B 假设这两个字段已在 schema） | 确认 schema 含这两个字段，否则要先补 migration |
| 跑一次 `rg "stripInternalMarkers" src/` 验证 `llm-streaming-service.ts` 的局部函数与 `lib/strip-markers.ts` 是否同源 | 验证 P0-C 修复可行性 | 若不同源，需先对齐 |

---

## 5. 实施顺序建议（按依赖关系）

1. **先做 schema 一致性（P1-B + P1-C）**：避免后续修复踩数据完整性问题
2. **再做 routing 透传（P0-B）**：影响下游工具/知识库切换 + retrieval 流水线重构（routing 决策必须先于 retrieval），影响范围最大，是其他修复的前置
3. **Tool 鉴权统一（P0-D）**：依赖 P0-B 的 tools 注册表收敛
4. **Tool 错误撤销 UI（P0-E）**：依赖 P0-D
5. **Claim verifier strip 顺序（P0-C）**：独立，可并行
6. **SSE abort 副作用（P1-A）**：独立，可并行
7. **simulation 并发限制（P2-A）**：独立，可并行

---

## 6. 验证矩阵（每个修复项完成后跑）

| 测试类型 | 范围 | 命令 |
|---|---|---|
| 类型检查 | 全项目 | `pnpm ts-check` |
| Lint | 全项目 | `pnpm lint --quiet` |
| 单元测试 | claim-support-verifier + llm-streaming + tool-execution + simulation-repository | `pnpm test:run` |
| 数据库迁移预演 | 在 staging Supabase 项目跑 supabase db reset + 重放迁移 | `supabase db reset` |
| E2E（手动） | simulation 路径 max_concurrent | 启动 dev server + 模拟测试页 |
| E2E（手动） | routing 工具透传 | 配置 routing 规则 + 模拟测试页 |

---

## 7. 元审查 summary（提醒未来 reviewer）

本次重排基于以下 meta-review 结论，避免再次落入同样的误报陷阱：

- ❌ 不要把"JS String.includes"误判为"SQL LIKE"（`escapeLikePattern` 不适用）——事实锚点：`routing-service.ts:48` 用 `userMessage.includes(kw)`
- ❌ 不要把"已加守卫的 dev-only fallback"标为 P0 漏洞——事实锚点：`api-utils.ts:260-280` 的 `if (process.env.NODE_ENV !== 'production')` 守卫
- ❌ 在评估 RPC 改动前，先 grep `rpc('increment_')` 等 RPC 关键字——事实锚点：`conversation-repository.ts` 中已有 `increment_message_count_by` RPC
- ❌ 在评估 verifier 校验时，先看 `validateLlmOutput` 是否真的有范围校验——事实锚点：`claim-support-verifier.ts:361` 是 confidence 越界校验
- ✅ 标记"已封顶"的修复时，先读 `getBaseConfidence()` / `isRealApiEnabled()` 的实际分支
- ✅ 标记 schema drift 时，必须配合 migration 状态判断，不能只看 Drizzle schema
- ✅ 标记 SSE abort 副作用时，先看 `cancel()` 回调与 `try/finally` 的覆盖关系

**事实锚点清单**（reviewer 必查）：

| 锚点 | 文件:行 | 用途 |
|---|---|---|
| confidence 范围校验 | `src/server/services/claim-support-verifier.ts:361` | 验证 P1-4 类误报 |
| RPC 改用 | `src/server/repositories/conversation-repository.ts` | 验证 P1-6 类误报 |
| dev-mode header fallback | `src/lib/api-utils.ts:260-280` | 验证 P0-4 类误报 |
| tool 鉴权结构 | `src/server/services/tool-execution-service.ts:173-229` | 验证 P0-2 是否真实 |
| SSE abort cancel | `src/server/services/llm-streaming-service.ts:743-746` | 验证 P0-1 剩余风险 |
| strip 函数复用 | `src/lib/strip-markers.ts` + `llm-streaming-service.ts` 局部实现 | 验证 P1-9 修复可行性 |
| mock provider 检测 | `src/server/services/tool-providers/factory.ts` | 验证 P0-3 封顶修复路径 |
| migration 文件存在 | `supabase/migrations/20260724_*.sql` | 验证 P0-A / P0-B 数据迁移 |

---

## 8. 发现性 Task 调研结果（2026-07-27 跑）

### 8.1 console 残留真实数量

- 原始文本命中总数：19（包含 `src/lib/logger.ts` 自身 2 处）
- 总数：17（不含 `src/lib/logger.ts`，按指定 `rg` 正则的文本命中数）
- 补充校正：其中 `src/lib/auth/jwt.ts` 2 处、`src/lib/crypto.ts` 1 处只是错误提示字符串里的 `node -e "console.log(...)"` 示例，不是运行时调用；实际可执行的 `console.*` 调用为 14 处
- top 5 残留文件（按指定 `rg` 文本命中数）：
  1. `src/server/services/llm-streaming-service.delegation.test.ts` — 7 处
  2. `src/lib/auth/jwt.ts` — 2 处（均为命令示例字符串，不是调用）
  3. `src/server/services/knowledge-import-service.ts` — 2 处
  4. `src/app/error.tsx` — 1 处
  5. `src/app/global-error.tsx` — 1 处
- 按目录聚合（指定命令统计的是命中文件数）：`src/app` 2 个、`src/lib` 2 个、`src/server/services` 2 个、`src/components/common` 1 个、`src/lib/auth` 1 个、`src/server/repositories` 1 个
- catch 块中的 console 数：2（`bot-config-audit-log-repository.ts` 的 `console.warn` 1 处，`knowledge-import-service.ts` 的 `console.log` 1 处）。题目给出的 `-B 2` + `error|warn` 启发式命令返回 0：前者距 `catch` 超过 2 行，后者又是 `console.log`，因此需要源码复核
- 结论：原报告「剩余 214 处」高估；按指定文本扫描仅 17 处，按真实可执行调用仅 14 处

### 8.2 stripInternalMarkers 同源验证

- `src/lib/strip-markers.ts`：存在，导出 `stripInternalMarkersFromResponse`（line 10-30）
- `src/server/services/llm-streaming-service.ts` 局部实现：line 239-250，未导出
- 同源：❌
- 差异：导出的 `stripInternalMarkersFromResponse` 额外删除带空白的方括号置信度标记（如 `[CONF: 0.95]`，line 17-18）；流式服务的局部实现不处理该变体。两者都会删除 `[TOOL_CALL]...[/TOOL_CALL]`、常规/全角/括号式 CONF、`[DELEGATE_TO]...[/DELEGATE_TO]`、`[PENDING_CHOICE:...]`，都会保留 `[IMG:url](alt)` 并压缩多余空行。另有 `query-rewrite-service.ts:254-260` 的第三个局部实现，仅删除 TOOL_CALL 与常规 CONF，能力更窄
- P0-C 实现提示：需要调整原方案。先在 raw `fullContent` 上解析 tool call / delegation，再用统一导出的 helper 生成单独的 cleaned 内容传给 Claim verifier；不要在 tool call 解析前覆盖 `fullContent`，也不要在 `buildConfidenceFromContent` 提取 `[CONF]` 前丢失 raw 内容

### 8.3 BotConfigRow 字段验证

- `bot_configs` 表字段：`tools jsonb NOT NULL DEFAULT '[]'` ✅，`knowledge_ids jsonb NOT NULL DEFAULT '[]'` ✅（Drizzle schema line 117-118、完整 migration 与当前 Supabase 实表一致）
- `BotConfigRow` interface 字段：`id`、`name`、`description`、`system_prompt`、`tools: unknown[]` ✅、`knowledge_ids: string[]` ✅、`skill_group_id`、`is_default`、`parent_bot_id`、`delegation_prompt`、`collaboration_config`、`is_sub_agent`、`status`、`platform_connection_id`、`created_at`、`updated_at?`
- `routing-service.ts:32-67` 消费的 `bot` 字段：服务本身通过 `findById(rule.target_bot_id)` 取得完整 `BotConfigRow`，只做存在性判断并原样返回；调用方 `messages/route.ts:346-352` 当前只读取 `system_prompt`、`is_sub_agent`、`id`
- `routingMatch.bot.tools` / `routingMatch.bot.knowledge_ids`：类型与运行时查询（`.select('*')`）均可正确取出，不需要在 `RoutingMatchResult` 中重复复制字段
- 结论：P0-B 修复不需要新 migration
- P0-B 实现提示：需要调整原方案。当前 retrieval 在 routing 匹配之前执行（`messages/route.ts:289` 对比 routing 的 line 344），所以只把 `knowledge_ids` 传给 `createStream()` 已经太晚；应先确定 routing Bot，再让 retrieval 按其 `knowledge_ids` 约束检索。`tools` 也应成为提示词与工具执行两层的 allowlist，而不只是附加到 stream options

---

## 附录：未列入 backlog 的项（meta-review 已排除）

| 原 finding | 排除原因 |
|---|---|
| P0-4 `x-user-role` Header fallback | 生产已受守卫保护，仅 dev-mode dead-code，已降级为 P3 |
| P0-5 SQL LIKE 转义 | 实际是 JS `String.includes`，不走 SQL LIKE 算子 |
| P1-4 Claim verifier confidence 越界校验 | `claim-support-verifier.ts:361` 已有校验 |
| P1-6 incrementMessageCount read-then-write | 已改 RPC `increment_message_count_by` |
| P0-3 product provider 封顶描述 | product provider 已走 `getBaseConfidence()` 封顶 |
| P1-2 Confidence Breakdown 字段命名 | 体验改进型，非阻塞 |
| P1-5 console 残留 | 需先 ripgrep 验证真实数量（已转为发现性 task） |
| P1-7 routing Intent 字段与 priority 排序 | 维护性，非阻塞 |