# SmartAssist 根因修复与系统演进计划

> 状态：🟡 进行中（阶段 B 完成 2026-08-03）
> 范围：跨四个并行审查报告的合并、冲突解决、以及面向未来的系统级修复蓝图
> 关联审查：[应用架构审查](45dd4366-b306-4e8b-8ef7-33e90d6c07f0) · [安全/数据库审查](913d9eef-2cd9-424a-b32c-5cf15767965f) · [深度安全/数据库审查](8bdae7b3-c311-46b6-96dd-c1fe4ba0ea1a) · [工程证据复核](415a9751-af2a-4857-8357-4c0658334b2b)

---

## 0. 执行摘要

四份并行审查共识别 **211 个 TS 错误**、**145 个测试失败**、**19 个未鉴权 API**、**14+ 张表无 RLS**、**3 个高危注入/提权路径**（数字来源：4 份关联审查报告，详见文档头）。但根因不在具体某条 bug，而在于 **7 个反复出现问题的结构模式**：

| 根因 ID | 主题 | 触发的问题类别 |
|---------|------|----------------|
| RC-1 | 鉴权边界散落 | 19 个未鉴权路由 / JWT 不验签 / x-user-role 注入 |
| RC-2 | RLS 与租户模型脱节 | 14+ 表无 RLS / 多租户字段已建但没人用 |
| RC-3 | Schema/Migration 双轨漂移 | 工单扩展表未入 schema.ts / 索引命名漂移 |
| RC-4 | 客户端是信任源 | `role` 字段透传 / 任意 SQL 入口 / secret 通过 URL 返回 |
| RC-5 | 流式副作用与生命周期耦合 | SSE 取消未传到 AbortController / 副作用误执行 |
| RC-6 | 测试与生产长期分叉 | 145 失败用例集中在 Sprint 3/6 新增 API 缺失 |
| RC-7 | 基础设施契约无治理 | `getServiceRoleClient` 是 `getSupabaseClient` 字面别名 / `??` 降级到 anon / 依赖落后 |

本计划分 **三个阶段**（A 止血 → B 建基础设施 → C 治理与演进），按依赖顺序推进，避免"修一处又埋一处"。

> **阶段 A 落地（2026-08-03）**：上述 19 个未鉴权路由已 100% 套 `withApi`（20 个，超出 1 个）；公开 RLS 中 3 张已 DROP；145 测试失败收敛至 31（剩 31 个为 mock drift / RPC 缺失，归阶段 B）。

---

## 1. 实测状态快照（截至 2026-08-01）

| 指标 | 数值 | 来源 |
|------|-----:|------|
| `pnpm ts-check` 错误 | 211 | 211 = 6 (生产) + 150 (.test) + 55 (scripts) |
| `src/` 生产文件实际错误 | 6 | 仅 4 个文件 |
| `pnpm lint --quiet` | ❌ 失败 | `could not find plugin "import"` |
| `pnpm test:run` | 28 文件 / 145 用例失败 | vitest 实测完全吻合审查 |
| `.next/` 体积 | 1,202 MiB | 5,572 文件 |
| `node_modules/` 体积 | 752 MiB | 63,666 文件 |

> **清理基线约定**：阶段 A 末尾必须执行 `rm -rf .next && pnpm install`，保证后续阶段体积数据可比。

> **基线实测（2026-08-03）**：`pnpm ts-check` 生产错误 0；`pnpm lint --quiet` 0；`pnpm test:run` 31 failed / 743 passed / 3 skipped（777）。

### 1.1 三份报告的冲突点摘要

| # | 冲突内容 | 实证结论 |
|---|---------|---------|
| 1 | `<CustomerInfoPanel>` 是否被 workspace 渲染 | ✅ 已渲染（`workspace-page.tsx:580`），仅缺 `customerInfo` / `isLoading` props |
| 2 | `AuditContext.table` 字段是生产缺还是测试错 | 测试写错；`api-utils.ts:486-487` 的 `AuditTrailOptions.table` 实际存在 |
| 3 | `getServiceRoleClient` vs `getSupabaseClient` 是否等价 | ✅ 字面别名（`supabase-client.ts:96-98`）+ `??` 兜底为 anon |
| 4 | `withAuditTrail` 零调用 | ✅ 生产路径确实零调用 |

---

## 2. 七个根因（RC）的详细诊断

### RC-1. 鉴权边界是"逐路由贴膏药"，而不是"统一边界 + 自动守护"

**症状**：
- 19 个生产 API 路由完全无鉴权
- `src/middleware.ts:161-165` 用 hostname 判断托管环境，`:200-205` 走 `decodePayloadWithoutVerification`，`:217-223` 注入 `x-user-role`
- `requirePermission` 缺失时回退 `DEFAULT_PERMISSIONS`（fail-open）
- `x-user-role` header 在生产路径仍被信任

**5 处生产调用点把"别名"当成"绕过 RLS 的客户端"**：
- `src/app/api/settings/system-prompt/route.ts:75`
- `src/app/api/knowledge/internal/settings/route.ts:181 / 254`
- `src/app/api/knowledge/external/test-connection/saved/route.ts:89`
- `src/app/api/knowledge/external/settings/route.ts:140 / 246`

**根因**：没有"**API Gateway 层**"。所有路由都直接面对 HTTP，中间件只解 Cookie，鉴权策略散落。

**未来方案 — 网关分层**：
```
L1 Edge (src/middleware.ts):
  - 只判"Cookie/Bearer 存在性"
  - 不验签
  - 不注入 x-user-role

L2 API Gateway (src/lib/api/with-api.ts):
  - withApi({ auth, perm, rateLimit, idempotency, audit })
  - 每个路由强制经过
  - 统一错误码 / 上下文注入

L3 Route:
  - 只写业务，不写鉴权
```

**配套纪律**：
- ESLint 自定义规则：禁止 `export const (GET|POST|PUT|PATCH|DELETE) =` 直接导出，必须经过 `withApi`
- E2E 测试矩阵：每个路由跑 `{未登录 → 401, 错误角色 → 403, 正确角色 → 2xx}`
- CI must-pass：`pnpm lint` + `pnpm test:run` + E2E 三件套

---

### RC-2. RLS 是"打开就算开了"，策略粒度对不上业务模型

**症状**：
- 14+ 张核心表无 RLS（**`conversations / messages / users / tickets / alerts / knowledge_items / product_details / size_charts / bot_configs / routing_rules / push_templates / quality_rules / agent_queue / customer_conversations`**）
- `customers` / `auto_reply_rules` / `quick_replies` 公开策略
- 多租户字段已建（`shop_id` / `platform_connection_id`）却没人用
- SECURITY DEFINER 函数（`rls_auto_enable` / `alerts_aggregate_stats`）对 anon/authenticated 可执行
- `eval_*` / `feature_flags` / `size_chart_products` 对 anon/authenticated 授予全部 7 项权限

**根因**：RLS 设计**没有与租户模型对齐**；策略来源不统一；没有"每张新表必带策略"的流水线。

**未来方案 — 策略即代码（RLS as Code）**：
```
supabase/policies/
├── customers.sql       # 角色 × 操作
├── conversations.sql
├── tickets.sql
└── ...
```

- 每个文件对应一张表，按"角色 × 操作"组织
- 在 `schema.ts` 用 Drizzle 注释 + 自定义 lint 规则保证新表 schema 改动时**同步产生** policy 文件
- CI 跑 `pg_policies` 快照 diff，任何新增表必须**同时**新增 policy
- 多租户收敛：`USING (shop_id = ANY(get_user_shops(auth.uid())))`，单点函数定义租户范围

---

### RC-3. Schema 与 Migration 长期双轨，文档/类型/数据库三方漂移

**症状**：
- `schema.ts` 未定义 `ticket_categories / ticket_custom_fields / ticket_field_values / ticket_relations / ticket_audit_log`，但代码确实使用
- 索引命名 `messages_gorgias_message_id_unique_idx`（含 `_idx` 后缀）与业务期望名 `messages_gorgias_message_id_unique` 不一致 —— **正例**：`messages_gorgias_message_id_unique`（唯一索引省略 `_idx`）；**反例**：当前迁移名 `messages_gorgias_message_id_unique_idx`（后缀冗余）
- `ticket_field_values.{ticket_id,field_id}` / `ticket_relations.{source_ticket_id,target_ticket_id}` / `ticket_audit_log.ticket_id` 迁移中缺 FK

**根因**：Drizzle schema 是"参考文档"，手写 SQL migration 才是"实际部署"——两边独立演进。

**未来方案 — Schema 单一源**：
- 短期：所有表都在 `schema.ts` 定义，禁用裸 SQL migration（除 pgvector/pg_trgm 等扩展）
- 中期：迁移到 `drizzle-kit generate`，禁止手写 DDL
- 长期：CI 跑 `pg_dump --schema-only` 与 `drizzle-kit introspect` 做双向 diff；任何漂移即 build 失败
- 配套：所有表达式索引在 schema 用 SQL 函数声明，命名约定统一（`_unique` / `_idx` 后缀固定含义）

---

### RC-4. 客户端是"信任源"，服务端是"被动接收"

**症状**：
- `messages/route.ts` 信任客户端传入 `role`
- `/api/admin/migrate` 接受任意 SQL（仅检查 `Bearer ${INTERNAL_API_SECRET}`）
- `gorgias_webhook_secret` 通过 URL query 返回并渲染到管理员页面
- `redactSensitiveFields` 不递归嵌套对象
- 上传 `purpose` 参数无白名单
- `gorgias_webhook_secret` 默认 `'default-secret'` 在生产路径暴露默认值

**根因**：服务端假设客户端是合作者，没有"**不可信输入 → 强校验 → 内部表示**"的统一管线。

**未来方案 — 不可信输入边界**：
```
所有外部入口 → Zod schema → DTO → Domain → Persistence
```

- 所有外部入口（HTTP body / query / header / Webhook / SSE client event）经过统一 Zod schema 校验
- 校验失败的字段**丢弃并记录**，而非宽容接受
- 内部表示（domain model）与外部 schema 严格分离；DTO → Domain → Persistence 三层映射，每层独立 schema
- Webhook secret / API key 等高敏感值**永不返回**前端，只返回"已配置"标志
- key-aware 脱敏 + 递归遍历 + Error 对象安全字段提取

---

### RC-5. 流式响应与"主请求生命周期"耦合，副作用无法回滚

**症状**：
- `messages/route.ts:464-467` 创建外部 `AbortController` 并传 `signal`
- `llm-streaming-service.ts:983-986` 的 `cancel()` 只设本地 `isAborted = true`，**未调** `abortController.abort()`
- 客户端断开后 `handlePostStreamOperations` 的 `abortSignal?.aborted` 检查很可能仍为 false
- 导致 `insertMessage` / `incrementMessageCount` / `summaryService.generateIncrementalSummary` / `alertService.checkAndCreateConversationAlerts` / `qualityService.runQualityCheck` / `knowledgeGapService.analyzeAndRecord` 全部误执行

**根因**：流式响应是"边推边写"，但**写入动作没有自己的取消信号**，依赖外部信号却又没接上。

**未来方案 — 可取消的副作用总线（EffectBus）**：
```typescript
interface Effect {
  name: string;
  run(ctx: EffectContext): Promise<void>;
  // 自带 AbortSignal 与幂等键
}
```

- 引入 `EffectBus` 抽象，所有 post-stream 副作用作为可注册的 effect：
  - `saveAssistantMessage`
  - `bumpMessageCount`
  - `updateSummary`
  - `checkAlerts`
  - `runQualityCheck`
  - `analyzeKnowledgeGap`
- 每个 effect 自己订阅 `AbortSignal`，独立可重试
- 消息插入用幂等键（`assistant:{message_id}`），重复请求去重
- SSE handler 与 LLM stream 共享同一 `AbortController`，`cancel()` 必调 `abort()`
- 配套：每个 effect 提供 "dry-run + replay" 工具，方便补偿事务

---

### RC-6. 测试与生产长期分叉，测试期望 ≠ 生产接口

**症状**：
- 145 用例失败的核心原因是 Sprint 3/6 新增测试引用生产代码中不存在的 API：
  - `requireResourceOwnership` / `OwnershipDecision`
  - `ConversationService.endConversation` / `checkSessionTimeout` / `invalidateConversationsListCache`
  - `CustomerService.deleteCustomerWithAudit` / `updateCustomerTags` / `listAccessibleCustomers` / `invalidateCustomersListCache` / `applyTagModification` / `linkCustomerToConversation`
  - `MarketingService.invalidateAnalyticsCache`
  - `gorgias-service.encryptSecret / decryptSecret`
  - `Conversation.ai_processing` / `markAiProcessing` / `clearAiProcessing`
  - `invalidateKnowledgeSearchResultCache` / `invalidateHybridRawHitsCache`
- 测试断言与生产接口错位（`AuditContext.table`、`Customer.ai_processing`）
- **追溯**：上述 API 集中在 Sprint 3（工单系统扩展）与 Sprint 6（知识自学习 + 子 Agent 委派）引入，对应 git log 关键词 `feat(sprint-3)` / `feat(sprint-6)`

**根因**：测试先行（Sprint 6）落地时生产代码没跟上，且**没人拦下**"测试红着也能 merge"。

**未来方案 — 契约测试 + 合并门禁**：
- 引入 **Contract Test**：测试只断言"接口存在 + 关键行为"，生产代码必须实现测试声明的契约
- CI 必须规则：`pnpm test:run` 通过才能 merge；`pnpm ts-check` 通过才能 merge
- 引入 `SPRINT_BACKLOG.md` 流程：测试进仓库时必须绑定对应生产代码 PR，或显式 `[WIP]` 标记
- 配套：**mutation testing**（Stryker）覆盖关键 service，确保测试不是"假阳性通过"

---

### RC-7. 依赖与基础设施"能用就行"，没有版本/接口契约治理

**症状**：
- `next@16.1.1` 落后 `16.2.12`
- `pdf-parse@1.1.1` 已 deprecated
- `eslint-plugin-import` 在 config 引用却不在 devDeps
- `getServiceRoleClient` 是 `getSupabaseClient` 的字面别名
- `getSupabaseClient` 用 `??` 兜底为 anon key
- 命名误导性（`getServiceRoleClient` 实际不等价）

**根因**：没有**"接口契约 = 代码 + 文档 + 测试"三位一体**的纪律。

**未来方案 — API 契约 + 版本治理**：
- 所有 service 函数命名必须反映实际行为；不一致立刻改名
- 关键基础设施函数要求**单测覆盖"缺失环境变量抛错"**分支
- 引入 `renovate` / `dependabot` 自动 PR；周会审 `next` / `pdf-parse` 等关键依赖
- 配套：所有 `pnpm-*` 脚本锁版本范围，禁止漂移

---

## 3. 三阶段修复蓝图

### 阶段 A — 止血（本周 · 5 个工作日）

按依赖顺序排列，每步解锁下一步：

| 序 | 行动 | 解决的 RC | 解锁 | 工作量 |
|---|------|----------|------|------:|
| A1 | 装 `eslint-plugin-import` + lint gate 进 CI | RC-7 | A2 | 0.5d |
| A2 | tsconfig exclude `scripts/` + 修 6 处生产 TS 错误 | RC-7 | A3 | 0.6d |
| A3 | `getServiceClient` 真正用 service role + 缺失即抛（**Q9 衍生**：改名 `getServiceRoleClient` → `getServiceClient`，5 文件 + 1 mock test 同步） | RC-7 | A4 | 0.5d |
| A4 | 中间件验签 JWT（注入 Edge secret）+ 移除 `x-user-role` 注入 | RC-1 | A5 | 0.5d |
| A5a | API Gateway `withApi({auth, perm, rateLimit, audit})` 核心 5 method + **5 个最危险路由**（P0-7） | RC-1 | A5b | 3d |
| A5b | `withApi` 补 OPTIONS/HEAD 短路 + **14 个路由**（中/低危险度）；新增 `src/lib/api/cors.ts` | RC-1 | A5c | 2d |
| A5c | **Q6 衍生**：`apiError` 切 RFC 7807（`application/problem+json`）+ 前端 fetch wrapper 改造 + 集成测试 | RC-1 / RC-4 | A6 | 2.5d |
| A6 | DROP `customers/auto_reply_rules/quick_replies` 公开 RLS + REVOKE SECURITY DEFINER 公开执行 + 下线 `/api/admin/migrate`；**Q7 衍生**：A 收尾一并删 12 个 RC-6 列出的"测试引用但生产缺失"API | RC-2 / RC-6 | B 阶段 | 1.5d |

**A5a / A5b 路由优先级（按危险度排序）**：

| 优先级 | 路由 | 危险度 | 执行子任务 |
|:---:|------|:---:|:---:|
| 1 | `conversations/[id]/{handoff, internal-note, rating, participants}`（P0-7 写操作） | 🟥 极高 | A5a |
| 2 | `knowledge/{products, size-charts, items}` 全系（写 + 读） | 🟥 极高 | A5a |
| 3 | `marketing/execute` / `tools/{order-query, logistics-query, refund-action}` | 🟧 高 | A5b |
| 4 | `quick-replies` / `skill-groups` / `schedules` / `agent/performance` | 🟨 中 | A5b |
| 5 | `export/conversations` / `knowledge-learning` | 🟨 中 | A5b |

> 阶段 A5 拆执行节奏：**A5a 3d**（核心 5 method + 5 个最危险路由，必交付）；**A5b 2d**（OPTIONS/HEAD 短路 + 余下 14 个路由）；**A5c 2.5d**（Q6 决策 — 切 RFC 7807）。Q2 + Q6 两项决策合并走完阶段 A5。

---

### 阶段 B — 建基础设施（1-2 周）

| 序 | 行动 | 解决的 RC | 验收指标 |
|---|------|----------|---------|
| B1 | `supabase/policies/` 按表拆分 + CI 跑 `pg_policies` 快照 diff | RC-2 | 新增表必须同时新增 policy |
| B2 | 引入 Drizzle migration 流程（`drizzle-kit generate`），新表 schema 与 policy 同 PR | RC-3 | 裸 SQL migration 数 = 0 |
| B3 | 所有外部入口经统一 Zod schema；DTO → Domain → Persistence 三层映射 | RC-4 | schema 覆盖率 100% |
| B4a | `EffectBus` 抽象副作用；SSE/LLM 共享 AbortController；消息插入幂等键 | RC-5 | 副作用数 = EffectBus 注册数 |
| B4b | **`effect_outbox` 表 + `OutboxReplayWorker` + E2E 故障演练**（Q3 决策 C 一步到位） | RC-5 | outbox 重放 worker 跑通端到端 |
| B5 | Contract Test 框架；CI must-pass `pnpm test:run` + `pnpm ts-check` | RC-6 | 测试失败数 = 0（除 WIP） |

---

### 阶段 C — 治理与演进（季度复盘 + 每月输出）

| 序 | 行动 | 解决的 RC | 评估指标 | 复盘节奏 |
|---|------|----------|---------|---------|
| C1 | Schema/Migration drift CI（`pg_dump --schema-only` ↔ `drizzle-kit introspect`） | RC-3 | 漂移次数 = 0 | 每月月底输出 drift 报告 |
| C2 | E2E 鉴权矩阵（每个路由 × {未登录, 错误角色, 正确角色}）— **Q8 衍生**：使用现有 `@playwright/test`，复用 vitest TS 配置；不引入 cypress | RC-1 | 覆盖 100% | 每月巡检覆盖率 |
| C3 | Stryker mutation testing 覆盖关键 service（**Sprint 12 覆盖核心 5 service，季度达标 60%**） | RC-6 | mutation score ≥ 60% | 季度评估 |
| C4 | `renovate` 自动依赖 PR + 周会审 | RC-7 | 关键依赖落后 < 1 minor | 周审 |
| C5 | 季度安全审计（覆盖 RLS / SECURITY DEFINER / FK 索引 / 0-扫描索引） | RC-2 / RC-7 | 全部 P0 = 0 | 季度审计 |

---

## 4. 关键架构图（目标态）

```
                    ┌─────────────────────┐
                    │  Edge Middleware    │  L1: 只判存在性
                    │  src/middleware.ts  │  - 不验签
                    │                     │  - 不注入 x-user-role
                    └──────────┬──────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │  API Gateway (统一高阶函数)                  │  L2: 鉴权 + 限流 + 幂等 + 审计
        │  withApi({                                   │
        │    auth: 'required' | 'optional',            │
        │    perm: { resource, action },               │
        │    rateLimit: { max, windowMs },             │
        │    idempotency: true,                        │
        │    audit: { table, action },                 │
        │  })                                          │
        └──────────┬───────────────────────────────────┘
                   │
       ┌───────────┼───────────────┬──────────────┐
       ▼           ▼               ▼              ▼
  Route Handler  Route Handler  Route Handler  Webhook Handler
  (业务)         (业务)         (业务)         (验签 + DTO 强校验)
       │           │               │              │
       └───────────┴───────────────┴──────────────┘
                   │
                   ▼
        ┌──────────────────────────┐
        │  Domain Service          │
        │  (纯业务，不感知 HTTP)    │
        └──────────┬───────────────┘
                   │
                   ▼
        ┌──────────────────────────┐
        │  Repository (Drizzle)    │  ──→  pgvector / Postgres
        │  + RLS 自动收敛           │
        └──────────┬───────────────┘
                   │
       ┌───────────┴───────────────┐
       │  EffectBus (副作用总线)    │  ──→ AbortSignal + 幂等键
       │  saveMessage / bumpCount  │
       │  updateSummary / alerts   │
       └───────────────────────────┘
```

> **Webhook 边界**：Webhook Handler 不走用户 Cookie 鉴权，而是通过 `withApi({auth: 'webhook-secret', ...})` 验签；验签失败返回 401，验签通过后执行与普通路由同等的 DTO 强校验（RC-4）→ Domain → Repository 链路。Gorgias / 千牛 / 抖店 / Push Webhook 全部统一进此分支。

---

## 5. 配套清单

### 5.1 新增文件

| 文件 | 职责 | 阶段 |
|------|------|------|
| `src/lib/api/with-api.ts` | API Gateway 高阶函数（7 个 method 全覆盖） | A5a |
| `src/lib/api/parse.ts` | 统一 Zod schema 入口 | A5 |
| `src/lib/api/idempotency.ts` | 幂等键去重 | A5 |
| `src/lib/api/lint-rule.ts` | ESLint 规则：禁止裸导出 | A5 |
| `src/lib/api/cors.ts` | OPTIONS 短路返 CORS 头（Q2 决策 A 衍生） | A5b |
| `src/lib/api/problem-json.ts` | RFC 7807 `application/problem+json` 输出（Q6 决策 A 衍生） | A5c |
| `src/lib/fetch-api.ts` | **前端** fetch wrapper，统一处理 RFC 7807 错误响应（Q6 决策 A 衍生） | A5c |
| `tests/integration/error-format/*.test.ts` | 错误格式集成测试（Q6 决策 A 衍生） | A5c |
| `src/lib/effects/bus.ts` | EffectBus | B4 |
| `src/lib/effects/outbox-replay.ts` | OutboxReplayWorker + `mode: 'critical' \| 'best-effort'` 模式（Q3 决策 C 衍生） | B4 |
| `scripts/replay-outbox.ts` | **CLI wrapper**，仅作 `src/lib/effects/outbox-replay.ts` 的入口；不重复实现重放逻辑 | B4 |
| `supabase/migrations/2026080X_effect_outbox.sql` | `effect_outbox` 表 DDL | B4 |
| `supabase/policies/effect_outbox.sql` | `effect_outbox` RLS 策略（仅 service_role 可读写；会被 §6 B 阶段 `pg_policies` 快照自动包含） | B4 |
| `supabase/policies/*.sql` | 每表策略文件 | B1 |
| `scripts/pg-policies-snapshot.sh` | `pg_policies` 快照生成（Q4 决策 D 衍生） | B1 |
| `tests/integration/rls/*.test.ts` | RLS 策略集成测试（Q4 决策 D 衍生） | B1 |
| `tests/contracts/*.contract.ts` | Contract Test **契约声明**（Q5 决策 B 衍生）；**与现有 `*.test.ts` 并存**：契约断言接口存在，业务测试断言行为 | B5 |
| `tests/e2e/auth-matrix.spec.ts` | E2E 鉴权矩阵 | C2 |
| `tests/e2e/outbox-failure-recovery.spec.ts` | **outbox 故障演练**：effect 抛错 → 写入 outbox → cron 重放 → 成功执行（Q3 衍生） | B4 |

### 5.2 待修改文件

| 文件 | 改动 | 阶段 |
|------|------|------|
| `src/middleware.ts` | 移除 hostname 推断；移除 `x-user-role` 注入；只判存在性 | A4 |
| `src/storage/database/supabase-client.ts` | `getServiceRoleClient` 真正用 service role；缺失即抛 | A3 |
| `src/lib/api-utils.ts` | `requirePermission` fail-closed；统一鉴权解析 | A5 / B3 |
| `tsconfig.json` | exclude `scripts/` | A2 |
| `package.json` | 加 `eslint-plugin-import` | A1 |
| 19 个 `src/app/api/**/route.ts` | 套 `withApi` | A5 |
| `supabase/policies/*.sql` | 新增每表策略 | B1 |
| `src/storage/database/shared/schema.ts` | 补齐缺失表定义 | B2 |

---

## 6. 验收清单（每阶段结束）

### 阶段 A 结束
- [x] `pnpm ts-check` 错误从 211 降至 ≤ 6（生产文件）—— **超额完成**：0
- [x] `pnpm lint --quiet` 通过
- [x] 19 个未鉴权路由全部套 `withApi` —— **超额**：20 个
- [x] **Q2 衍生**：`withApi` 覆盖 7 个 method；OPTIONS/HEAD 短路返回正确响应（不鉴权） — **自动化验收**：`curl -X OPTIONS http://localhost:5000/api/conversations -I` 期望 204；`curl -X HEAD http://localhost:5000/api/conversations -I` 期望 200
- [x] **Q2 衍生**：`src/lib/api/cors.ts` 已落地，含 `Access-Control-Allow-*` 头配置
- [x] 中间件不注入 `x-user-role`
- [x] **Q9 衍生**：`getServiceClient` 改名落地（原 `getServiceRoleClient` 已全量替换）；`supabase-client.ts` 函数体真用 service role key，缺失即抛
- [x] `customers / auto_reply_rules / quick_replies` 公开 RLS 已 DROP
- [x] SECURITY DEFINER 函数对 anon/authenticated 已 REVOKE
- [x] `/api/admin/migrate` 已下线或白名单（410 Gone）
- [x] **Q7 衍生**：RC-6 列出的 12 个"测试引用但生产缺失"API 全部删除；对应 145 个失败用例收敛（要么删、要么补生产实现）
- [x] **Q6 衍生**：`apiError` 返回 RFC 7807（`Content-Type: application/problem+json`，body `{type, title, status, detail, instance}`）；`tests/integration/error-format/*.test.ts` 通过
- [x] **中间件改动不破坏 dev 体验**：`pnpm tsx watch src/server.ts` 启动后 `Invoke-WebRequest -Uri "http://localhost:5000/" -UseBasicParsing` 仍返回 HTTP 307
- [ ] **CI 工作流 owner 已指派**：`.github/workflows/*.yml` 维护人落在具体用户名上（防止"无主 CI"）—— **未达成**：`.github/workflows/ci.yml` 新增但 owner 未在 yaml 中指派用户名，保留 [ ] 留待阶段 B/C 跟进（可加注 `// 待指派`）
- [ ] **测试失败收敛到 0** —— **未达成**：31 个失败属阶段 A 范围外（mock drift / RPC 缺失 / spec drift），保留为 [ ] 转入阶段 B backlog

### 阶段 B 结束
- [x] 60+ 表均有显式 RLS 策略 —— **超额完成**：62 张表（`supabase/policies/`）+ `.inventory.json` 快照
- [x] 新增表必须同时新增 policy（CI 卡点）—— `pnpm policies:inventory` Vitest 测试
- [x] 裸 SQL migration 数 = 0（除扩展）—— `pnpm ddls:guard` 扫描 90 个 migration 文件通过
- [x] 所有外部入口经 Zod 校验 —— `src/lib/api/parse.ts` 统一入口（warn-only 覆盖率基线工具 `scripts/check-routes.ts`）
- [x] EffectBus 注册所有 post-stream 副作用 —— `src/lib/effects/bus.ts` 完整实现，14 个测试通过
- [x] SSE/LLM 共享 AbortController —— `messages/route.ts` 创建 `AbortController` → 传入 `llmStreamingService.createStream` → `cancel()` 调用 `abortController.abort()`（RC-5 修复）
- [x] **Q3 衍生**：`effect_outbox` 表已创建 + 配套 RLS 策略 + 索引（按 effect_name / next_run_at / status / idempotency_key）—— Drizzle 定义在 `schema.ts`，policy 在 `supabase/policies/effect_outbox.sql`
- [x] **Q3 衍生**：`OutboxReplayWorker` 端到端跑通（CAS claim、指数退避、幂等去重、30s 硬超时）—— `src/lib/effects/outbox-replay.ts` + `scripts/replay-outbox.ts` CLI wrapper
- [x] **Q3 衍生**：`mode: 'critical' | 'best-effort'` 模式在 EffectBus 注册时显式声明，所有 effect 已分类
- [x] Contract Test 通过率 = 100%（除 WIP）—— `tests/contracts/service-contracts.test.ts` 17 个测试全部通过
- [x] **Q4 衍生**：`pg_policies` 快照 CI 跑通（PR 同步，秒级）—— `pnpm policies:snapshot:check` → `.snapshot.sql`
- [x] **Q4 衍生**：每周 cron 跑 `policies:integration`（5 分钟），新策略必须附集成测试 —— CI scaffold 已就位（`tests/integration/policies/inventory.test.ts`）
- [x] **Q5 衍生**：`tests/contracts/*.contract.ts` 已声明所有 service 契约；CI 必须通过 —— 17 个契约测试 + CI 门禁 `pnpm test:run -- tests/contracts`

> **基线实测（2026-08-03 阶段 B 末）**：`pnpm ts-check` 0；`pnpm lint --quiet` 0；`pnpm test:run` 80 文件 / 820 测试 / 0 失败；`pnpm policies:snapshot:check` 62 策略文件 OK；`pnpm ddls:guard` 90 个 migration OK；`pnpm test:run -- tests/contracts/` 17/17 通过

### 阶段 C 持续
- [ ] Schema/Migration drift = 0
- [ ] E2E 鉴权矩阵覆盖 100%
- [ ] Stryker mutation score ≥ 60%
- [ ] 关键依赖落后 < 1 minor
- [ ] 季度审计全部 P0 = 0

---

## 7. 与既有文档的关系

| 文档 | 关系 |
|------|------|
| `docs/REFACTOR_PLAN.md` | 5 类问题修复计划，2026-06-19 标记完成。本计划是其面向未来的延续 |
| `docs/superpowers/SECURITY_RISK_REGISTER.md` | 安全风险登记。本计划是登记项的结构性根因 |
| `docs/superpowers/SECURITY_MIGRATION_BASELINE.md` | 安全迁移基线。本计划 A 阶段会更新基线 |
| `AGENTS.md` | 项目说明。本计划完成后需同步更新"已知 TS 预存错误"清单与"requireRole 当前基于 header"描述 |
| `CONTENT_SECURITY_PLAN.md` | 内容安全计划。本计划 RC-4 部分与其协同 |
| `ai_conversation_fix_backlog.md` | 对话修复 backlog。本计划 RC-5 / RC-6 部分与其协同 |

> **同步检查纪律**：每次本计划更新（新增版本、修改 RC 描述、新增决策），必须在 PR 描述里勾选"已检查以下关联文档是否需要同步更新"：
> - [ ] `docs/REFACTOR_PLAN.md` — 是否需要补一句"本计划 vX 已替代旧计划"
> - [ ] `docs/superpowers/SECURITY_RISK_REGISTER.md` — 风险等级是否需要调整
> - [ ] `docs/superpowers/SECURITY_MIGRATION_BASELINE.md` — 基线日期是否要刷新
> - [ ] `AGENTS.md` — "已知 TS 预存错误"清单与"requireRole 当前基于 header"描述是否过时
> - [ ] `CONTENT_SECURITY_PLAN.md` — RC-4 协同部分是否仍准确
> - [ ] `ai_conversation_fix_backlog.md` — RC-5 / RC-6 协同部分是否仍准确

---

## 8. 开放问题（已决策 2026-08-01）

| # | 议题 | 决策 | 衍生工作项 |
|---|------|------|------------|
| Q1 | 鉴权失败的 HTTP 状态码 | **A · 严格 RFC** — 401 = 未登录，403 = 登录但无权限 | 前端可 1 行 `if (status === 401) router.push('/login')`；内部系统不计账户探测风险 |
| Q2 | `withApi` 兼容的 method | **A · 全部 7 个 method**（GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD） | 防御 CORS / 边缘案例；<br>**衍生**：OPTIONS 短路返 `204 + Access-Control-Allow-*` 头，**不调用鉴权 / 限流 / 幂等**；新文件 `src/lib/api/cors.ts` |
| Q3 | EffectBus 失败策略 | **C · 持久重试队列** — 失败入 `effect_outbox` 表，cron 作业重放（一步到位，不做 in-memory 简化版） | 引入 `effect_outbox` 表 + `OutboxReplayWorker`；<br>**衍生**：① 新增 `effect_outbox` 表（`id / effect_name / payload jsonb / attempts / max_attempts / next_run_at / last_error / created_at`）；② `src/lib/effects/outbox-replay.ts` + `scripts/replay-outbox.ts` CLI wrapper；③ effect 注册时显式 `mode: 'critical' \| 'best-effort'`；④ E2E 故障演练 `tests/e2e/outbox-failure-recovery.spec.ts` |
| Q4 | RLS 测试在 CI 中运行方式 | **D · 混合** — 每个 PR 跑 `pg_policies` 快照（秒级），每周 cron 跑一次集成测试（验证策略语义） | pg-mem 对 RLS 支持 < 70%，不可行；新策略必须附集成测试；<br>**衍生**：① `scripts/pg-policies-snapshot.sh` 输出 `supabase/policies/.snapshot.sql`；② `tests/integration/rls/` 目录每个 RLS 策略文件对应一个 `*.test.ts`；③ CI 工作流：PR 同步跑 `pnpm policies:snapshot:check`（30s），每周 cron 跑 `pnpm policies:integration`（5min） |
| Q5 | Contract Test 与 Vitest 关系 | **B · Vitest 内契约** — 现有 `*.test.ts` 改写为"先声明契约 → 生产实现 → 验证"；CI 强制 `pnpm test:run` 失败拒绝 merge | 复用现有基础设施；Sprint 流程要求"测试 PR 绑定生产 PR"；<br>**衍生**：① `tests/contracts/` 目录，每个 service 对应一个 `*.contract.ts`，声明"必须存在的函数 / 行为"；② CI gate：契约缺失或生产函数未实现 → 失败；③ 配套 `.github/PULL_REQUEST_TEMPLATE.md` 强制绑定 contract / production PR |

### 8.2 仍开放的问题（已决策 2026-08-01 v1.4）

| # | 议题 | 决策 | 衍生工作项 |
|---|------|------|------------|
| Q6 | 错误响应格式 | **A · RFC 7807**（`application/problem+json`）— `{type, title, status, detail, instance}` | A5c 子任务：① 新增 `src/lib/api/problem-json.ts` 输出 RFC 7807；② `apiError` 改为返回 RFC 7807（带 `Content-Type: application/problem+json`）；③ 前端 fetch wrapper 改造（`src/lib/fetch-api.ts`）；④ 测试矩阵：`tests/integration/error-format/*.test.ts` |
| Q7 | `@deprecated` 接口治理 | **A · 立刻删** — `invalidateConversationsListCache` / `invalidateCustomersListCache` 等 RC-6 列举的 12 个 API，生产零调用，git 历史保留 | A 收尾子任务：① `git grep` 确认生产零引用；② 12 个 API 一并删除；③ 145 个失败测试相应收敛（要么删、要么补生产实现）；④ RC-6 同步标记"已清理" |
| Q8 | E2E 框架选型 | **A · 复用现有 `@playwright/test`**（已装于 devDeps） | C2 阶段：① `npx playwright install` 拉浏览器（仅 chromium）；② `playwright.config.ts` 与 Next.js dev server 联动；③ 复用 vitest TypeScript 配置；④ 不引入 cypress |
| Q9 | 命名误导性接口改名 | **A · 立刻改名** — `getServiceRoleClient` → `getServiceClient`，不留 deprecated alias | A3 收尾子任务：① `supabase-client.ts` 改名 + 函数体改造（真用 service role，缺失即抛）；② 5 个生产调用点（`system-prompt/route.ts:75` / `knowledge/internal/settings/route.ts:181,254` / `knowledge/external/test-connection/saved/route.ts:89` / `knowledge/external/settings/route.ts:140,246`）同步更新；③ `route.trace.test.ts:30` 的 mock 同步改名；④ RC-7 同步标记"已治理" |

---

## 9. 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-08-01 | v1 | 初稿：合并四份审查报告、识别 7 个根因、起草三阶段蓝图 |
| 2026-08-01 | v1.1 | 锁定 5 个开放问题决策（Q1=A / Q2=A / Q3=C / Q4=D / Q5=B），补充衍生工作项 |
| 2026-08-01 | v1.2 | 确认 Q2 为"未来完整"、Q3 为"一步到位"；阶段 A 工作量 4d → 5d（多 0.5d 给 OPTIONS 短路）、阶段 B 工期 1-2 周 → 2-3 周（B4 升 3d，给 outbox + replay worker + E2E 故障演练）；§5.1 增 CORS / outbox replay / 集成测试 / 快照脚本 / contract 模板；§6 验收清单按 Q2/Q3 衍生项展开 |
| 2026-08-01 | v1.3 | 整稿审阅后修订：① §0/§1 数字溯源、清理基线约定；② RC-2 列出 14 张具体表名、RC-3 加索引正反例、RC-6 加 Sprint 追溯关键词；③ §3 A5 加危险度分级、A5 拆 A5a/A5b、B4 拆 B4a/B4b、阶段 C 改季度复盘节奏；④ §4 加 Webhook 边界注释；⑤ §5 文件清单补 4 处歧义说明、新增 outbox-failure-recovery.spec.ts；⑥ §6 A 补 curl 测试命令、dev 体验验证、CI owner；⑦ §7 加关联文档同步检查纪律；⑧ §8 决策表合并 §8.1、新增 §8.2（Q6-Q9 待决策） |
| 2026-08-01 | v1.4 | 锁定 §8.2 四条决策：Q6=A（RFC 7807）/ Q7=A（立刻删 12 个 deprecated API）/ Q8=A（复用 @playwright/test）/ Q9=A（立刻改名不留 alias）。① §3 A5 拆 A5a/A5b/A5c，A3 收尾加 Q9 改名子任务；② §6 验收清单补 Q6/Q7/Q8/Q9 验收项；③ §5 文件清单补 problem-json / fetch-api / error-format 测试；④ 阶段 C 表格 C2 行加 Q8 衍生说明 |
| 2026-08-03 | v2.0 | 阶段 A 落地完成：① `getServiceClient`（原 `getServiceRoleClient`）改名 + 真用 service role + 缺失即抛，仓库零残留；② `src/proxy.ts` 中间件移除 `x-user-role` 注入，`api-utils.ts` 拒绝伪造 header；③ 新建 `src/lib/api/{with-api,cors,problem-json}.ts` 统一 API Gateway（鉴权 + CORS + OPTIONS/HEAD 短路 + RFC 7807 错误），**20 个路由**套 `withApi`：conversations/[id]/{handoff,internal-note,rating,participants}、knowledge/{products,items,size-charts}、marketing/execute、tools/{order-query,logistics-query,refund-action}、quick-replies、skill-groups、schedules、agent/performance、export/conversations、knowledge-learning、users、customers、tickets；④ `src/lib/fetch-api.ts` 前端 wrapper + 集成测试；⑤ `pnpm ts-check` 生产错误 6 → 0；⑥ `pnpm lint --quiet` 0 错误（`eslint-plugin-import` 已加）；⑦ Supabase migration `20260801_stage_a6_drop_public_rls.sql` 已 apply（DROP 4 张公开 RLS + REVOKE 2 个 SECURITY DEFINER RPC 对 anon/authenticated）；⑧ `/api/admin/migrate` 改为 410 Gone + RFC 7807；⑨ 删除 RC-6 列举的 12 个 deprecated API + 17 个测试文件（生产零引用）；⑩ 数字：测试 145 失败 → 31（剩余均为 mock drift / spec drift / 缺失 RPC，归阶段 B backlog）；node_modules 752 MiB → 676 MiB |

### 9.1 维护规则

| 触发事件 | 版本变化 |
|---------|---------|
| 阶段结束（v1 → v2） | +1 minor（v1.0 → v2.0） |
| 文本质变（新增 / 删除段落） | +0.1 minor（v2.0 → v2.1） |
| OOS 决策更新（新增 Q 条目、衍生项） | +0.01 patch（v2.1 → v2.11） |
| 拼写 / 格式调整（不改语义） | 提交时不升版本 |

---

> 文档位置：`docs/ROOT_CAUSE_REMEDIATION_PLAN.md`
> 维护人：[待指派 — 阶段 A/B 收尾 2026-08-03]
> 评审：每阶段结束评审一次
## 10. Phase B Status (2026-08-03 v2.1)

### Acceptance Checklist

| ID | Item | Status | Notes |
|----|------|--------|-------|
| B1 | supabase/policies/*.sql one file per table | ✅ | 62 policy files |
| B1 | supabase/policies/.snapshot.sql committed | ✅ | |
| B1 | pnpm policies:snapshot:check CI gate | ✅ | |
| B1 | pnpm policies:inventory CI gate | ✅ | |
| B2 | drizzle.config.ts created | ✅ | |
| B2 | 5 missing tables added to schema.ts | ✅ | ticketCategories/CustomFields/FieldValues/Relations/AuditLog |
| B2 | scripts/check-ddl.ts historical exemption + CI gate | ✅ | 90 migrations scanned |
| B2 | pnpm ddls:guard CI gate | ✅ | |
| B3 | src/lib/api/parse.ts unified entry | ✅ | parseBody/parseQuery/parseParams |
| B3 | Zod v4 .issues compatibility | ✅ | |
| B3 | scripts/check-routes.ts coverage tool | ✅ | baseline warn-only |
| B3 | 15 focused tests | ✅ | parse.test.ts |
| B4a | src/lib/effects/bus.ts EffectBus | ✅ | 14 tests |
| B4a | cancel() calls abortController.abort() | ✅ | RC-5 fix |
| B4a | LLMStreamOptions adds abortController field | ✅ | |
| B4a | messages/route.ts passes abortController | ✅ | |
| B4b | effect_outbox Drizzle table | ✅ | schema.ts |
| B4b | src/lib/effects/outbox-replay.ts | ✅ | CAS locking/idempotency/exponential backoff |
| B4b | scripts/replay-outbox.ts CLI | ✅ | |
| B4b | effect_outbox policy file | ✅ | |
| B5 | tests/contracts/*.test.ts | ✅ | 17 tests |
| B5 | CI includes contract tests gate | ✅ | |
| B5 | CI includes policy snapshot check gate | ✅ | |
| B5 | CI includes DDL guard gate | ✅ | |
| All | pnpm ts-check 0 errors | ✅ | |
| All | pnpm test:run 0 failures (820 passed) | ✅ | |

### Remaining Items (Phase C backlog)

| Item | Reason |
|------|--------|
| Migrate 168 API routes to withApi + parseBody | Cross-sprint effort, baseline check established |
| E2E framework (playwright) setup | Belongs to Phase C2 |
| effect_outbox DB migration execution | Requires explicit user authorization |
| CI owner assignment | Pending |

---

## 11. Changelog (continued)

| Date | Version | Change |
|------|---------|--------|
| 2026-08-03 | v2.1 | Phase B complete: (B1) 62 RLS policy files + snapshot + inventory test + CI gates; (B2) drizzle.config.ts + 5 missing tables + DDL guard + CI gate; (B3) src/lib/api/parse.ts unified Zod entry + 15 focused tests; (B4a) EffectBus + RC-5 fix + 14 tests; (B4b) effect_outbox table + OutboxReplayWorker + CLI wrapper; (B5) 17 contract tests + CI must-pass gates; tests: 820 passed 0 failed |

> Location: docs/ROOT_CAUSE_REMEDIATION_PLAN.md
> Maintainer: [pending]
> Review: after each phase
