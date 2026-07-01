# SmartAssist 智能客服 Agent

## 项目概览

企业级智能客服系统，支持自然语言对话、知识库检索、多轮对话上下文理解、自动回复规则配置、满意度评价等功能。

### 技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **Database**: Supabase (PostgreSQL)
- **AI**: coze-coding-dev-sdk (LLM + Knowledge)

### 核心架构

基于文章《基于Agent的智能客服项目》的设计理念：
- **Agent流水线**: 预处理 → 自动回复匹配 → 知识库检索(含相关性阈值过滤) → Function Call工具调用 → LLM生成 → 置信度评分 → 异常告警检测
- **多轮对话状态机**: GREETING → INFO_GATHERING → PROCESSING → HANDOFF → COMPLETED
- **混合检索**: 向量语义搜索(min_score≥0.75过滤) + 自动回复关键词匹配
- **工具调用(Function Calling)**: 查订单状态、查物流、申请退款、修改地址等电商操作型工具
- **置信度评分与人工接管**: AI回复附带置信度（多源加权融合：知识库40%+工具30%+LLM自评30%），无知识库/工具支撑时LLM自评权重提升至50%、默认基础置信度降至0.3，低于阈值(0.4)时自动触发转人工。置信度支持分解展示（知识库/工具/LLM自评/子Agent贡献+转人工意图检测+无支撑标记）
- **会话摘要自动生成**: 每轮AI回复后增量维护对话摘要(存于conversations.summary)，人工接管时直接展示摘要，无需阅读全部历史
- **异常告警**: 低置信度、高轮次、负面情绪等场景自动产生告警，Dashboard实时展示。告警阈值支持在系统设置中动态调整（低置信度Warning/Critical阈值、高轮次Warning/Critical阈值、自动转人工轮次）
- **协同对话**: 多坐席协作处理同一对话，支持内部备注(@提及)、参与者管理
- **满意度趋势**: 按日/周维度统计满意度评分趋势，Dashboard可视化展示
- **知识库版本管理**: 每次编辑知识条目自动创建版本快照，支持回滚到历史版本
- **流式输出**: SSE协议，前端打字机式渲染
- **自定义子Agent**: 主Bot下创建多个专项子Bot(层级架构)，支持意图识别自动委派、子Agent间协作通信、动态创建/编辑/启停
- **多模态图片理解**: 用户发图 → S3存储 → 视觉LLM识别问题类型 → 路由到对应处理策略(退货/补发/赔付)
- **知识库图片回复**: AI回复时自动引用知识库中带image_url的条目，LLM通过[IMG:url](alt)协议输出图片引用，后端提取后作为独立图片消息渲染
- **AI引用溯源面板**: 聊天页右侧可展开引用溯源面板，展示AI回复引用的知识库原文片段、相关度分数、条目名称/分类，支持置信度分解展示；点击AI消息气泡自动切换到该消息的引用
- **主动消息推送**: Webhook监听订单状态变更 → 匹配推送模板 → 自动发送模板消息，减少可预知咨询

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── conversations/          # 对话管理 API
│   │   │   ├── route.ts            # GET列表, POST创建
│   │   │   └── [id]/
│   │   │       ├── route.ts        # GET详情, DELETE删除, PATCH更新状态
│   │   │       ├── messages/route.ts  # POST发送消息(流式+Function Calling+置信度评分)
│   │   │       ├── rating/route.ts    # POST评价
│   │   │       ├── handoff/route.ts   # POST转人工接管
│   │   │       ├── internal-note/route.ts # POST内部备注(@提及)
│   │   │       └── participants/route.ts  # POST添加/移除参与者
│   │   ├── simulations/            # 模拟测试 API
│   │   │   ├── store.ts           # 内存存储
│   │   │   ├── route.ts           # GET列表, POST创建
│   │   │   └── [id]/
│   │   │       ├── route.ts       # GET详情, DELETE删除
│   │   │       └── messages/route.ts  # POST发送消息(流式)
│   │   ├── analytics/route.ts     # GET数据分析(含告警统计)
│   │   ├── alerts/route.ts        # 告警 CRUD (GET列表, POST创建, PATCH标记已处理)
│   │   ├── auto-reply/route.ts     # 自动回复规则 CRUD
│   │   ├── knowledge/              # 知识库
│   │   │   ├── route.ts            # GET搜索
│   │   │   ├── import/route.ts     # POST导入(快速模式)
│   │   │   ├── import-jobs/        # 导入任务管理(增强模式)
│   │   │   │   ├── route.ts        # POST创建任务, GET列表
│   │   │   │   └── [id]/route.ts   # GET任务状态, DELETE删除
│   │   │   ├── items/route.ts      # GET条目列表, PUT编辑, DELETE删除
│   │   │   └── versions/route.ts   # GET版本历史, POST回滚
│   │   ├── shops/                  # 店铺管理
│   │   │   ├── route.ts            # GET列表(含统计), POST创建
│   │   │   └── [id]/route.ts       # GET详情, PATCH更新, DELETE删除
│   │   ├── users/route.ts          # 用户 CRUD (GET列表, POST创建, PATCH更新, DELETE删除)
│   │   ├── permissions/route.ts    # 权限配置 (GET列表, PUT更新)
│   │   ├── customers/              # 客户管理
│   │   │   ├── route.ts            # GET列表(筛选), POST创建
│   │   │   └── [id]/route.ts       # GET详情(含对话), PATCH更新(标签/备注)
│   │   ├── customer-tags/route.ts  # 标签 CRUD (GET列表, POST创建, DELETE删除)
│   │   ├── agent/                  # 坐席工作台
│   │   │   ├── status/route.ts     # PATCH切换在线状态
│   │   │   ├── queue/route.ts      # GET排队列表, POST接单, PATCH更新状态
│   │   │   └── performance/route.ts # GET绩效统计
│   │   ├── skill-groups/route.ts   # 技能组 CRUD
│   │   ├── schedules/route.ts      # 排班 CRUD
│   │   ├── quick-replies/route.ts  # 话术库 CRUD (GET列表, POST创建, PUT编辑, DELETE删除)
│   │   ├── quick-replies/export/route.ts  # 话术库导出 (Excel/CSV)
│   │   └── quick-replies/import/route.ts  # 话术库导入 (Excel/CSV 批量)
│   │   ├── conversation-tags/route.ts # 对话标签 CRUD (GET列表, POST创建, DELETE删除, POST打标)
│   │   ├── quality-checks/route.ts # 质检 (GET规则列表, POST创建规则, PATCH更新规则, GET质检记录)
│   │   ├── export/                 # 导出
│   │   │   ├── conversations/route.ts # GET对话记录导出(CSV)
│   │   │   └── analytics/route.ts     # GET统计报表导出(CSV)
│   │   ├── tools/                  # 富消息工具
│   │   │   ├── order-query/route.ts    # POST查订单→订单卡片
│   │   │   ├── logistics-query/route.ts # POST查物流→物流进度
│   │   │   └── refund-action/route.ts  # POST退款→确认按钮
│   │   ├── bot-configs/route.ts   # Bot配置 CRUD
│   │   ├── sub-agents/            # 子Agent管理
│   │   │   ├── route.ts           # GET列表, POST创建, PUT编辑, DELETE删除
│   │   │   ├── delegate/route.ts  # POST委派任务给子Agent
│   │   │   ├── collaborate/route.ts # POST子Agent间协作通信
│   │   │   └── delegations/route.ts # GET委派历史
│   │   ├── routing-rules/route.ts # 路由规则 CRUD
│   │   ├── marketing/route.ts     # 营销活动 CRUD + 效果统计
│   │   ├── tickets/                # 工单管理
│   │   │   ├── route.ts            # GET列表(筛选), POST创建
│   │   │   ├── [id]/
│   │   │   │   ├── route.ts        # GET详情(含评论+状态日志), PATCH更新(状态流转), DELETE删除
│   │   │   │   └── comments/route.ts # POST添加评论
│   │   │   └── from-conversation/route.ts # POST从对话创建工单
│   │   ├── settings/route.ts       # GET/PUT设置
│   │   ├── upload/route.ts         # POST图片上传(多模态支持)
│   │   └── push/                   # 主动推送管理
│   │       ├── templates/route.ts  # GET列表, POST创建, PUT更新, DELETE删除
│   │       ├── records/route.ts    # GET推送记录
│   │       ├── webhook/route.ts    # POST Webhook事件接收
│   │       └── events/route.ts     # GET事件日志, PATCH处理事件
│   ├── page.tsx                    # 首页 - 对话监控
│   ├── simulation/page.tsx         # 模拟测试
│   ├── dashboard/page.tsx          # 数据看板
│   ├── history/page.tsx            # 对话历史
│   ├── faq/page.tsx               # 知识库浏览(含知识自学习Tab)
│   ├── team/page.tsx               # 团队管理(成员+权限)
│   ├── customers/page.tsx          # 客户管理(画像+标签)
│   ├── workspace/page.tsx          # 坐席工作台(排队+对话+客户信息+话术库)
│   ├── quality/page.tsx            # 质检管理(对话标签+质检规则+质检记录)
│   ├── marketing/page.tsx          # 营销管理(活动+效果分析)
│   ├── tickets/page.tsx            # 工单管理(列表+详情+状态流转)
│   ├── settings/page.tsx           # 系统设置（含主动推送配置+Bot与子Agent管理）
│   └── layout.tsx                  # 根布局
├── components/
│   ├── app-layout.tsx              # 侧边栏导航布局
│   ├── monitor/                    # 对话监控组件(首页)
│   │   ├── monitor-page.tsx        # 监控主页(统计栏+列表+详情+告警)
│   │   ├── stats-bar.tsx           # 顶部统计栏(进行中/待接管/AI处理中/异常)
│   │   ├── conversation-monitor-list.tsx # 左侧对话列表(筛选+搜索+平台来源)
│   │   ├── conversation-detail.tsx # 右侧对话详情(只读+接管模式+消息发送+内部备注)
│   │   └── alert-bar.tsx           # 底部告警条
│   ├── quick-replies/
│   │   └── quick-replies-panel.tsx  # 话术库面板组件(可复用)
│   ├── chat/                       # 聊天组件(模拟测试复用)
│   │   ├── chat-page.tsx           # 主聊天逻辑
│   │   ├── chat-window.tsx         # 消息窗口(Markdown渲染+富消息卡片+时间戳+结束对话+转人工+转工单)
│   │   ├── rich-message-card.tsx   # 富消息卡片(订单/物流/操作按钮)
│   │   ├── markdown-renderer.tsx   # Markdown渲染组件
│   │   ├── conversation-list.tsx   # 对话列表(含待接管筛选)
│   │   ├── rating-card.tsx         # 评价卡片
│   │   └── welcome-screen.tsx      # 欢迎页
│   │   └── source-panel.tsx        # AI引用溯源面板(右侧)
│   ├── simulation/
│   │   └── simulation-page.tsx     # 模拟测试页(场景选择+对话+自动播放)
│   ├── dashboard/
│   │   └── dashboard-page.tsx      # 数据看板页(指标卡片+趋势图+满意度趋势+推送记录+事件日志+异常告警)
│   ├── history/
│   │   └── history-page.tsx        # 历史记录页(筛选+批量操作+导出)
│   ├── team/
│   │   └── team-page.tsx           # 团队管理页(成员列表+权限矩阵)
│   ├── customers/
│   │   └── customers-page.tsx      # 客户管理页(客户列表+详情抽屉+标签管理)
│   ├── workspace/
│   │   └── workspace-page.tsx      # 坐席工作台(排队+协同对话+内部备注+客户信息+话术库+快捷操作)
│   ├── quality/
│   │   └── quality-page.tsx        # 质检管理页(对话标签+质检规则+质检记录)
│   ├── faq/
│   │   ├── faq-page.tsx            # 知识库管理页(含Tab：知识库+商品详情+知识自学习)
│   │   └── product-form-modal.tsx  # 商品详情表单(创建/编辑)
│   ├── marketing/
│   │   └── marketing-page.tsx      # 营销管理页(活动列表+效果分析)
│   ├── tickets/
│   │   └── tickets-page.tsx        # 工单管理页(列表+详情+评论+状态流转)
│   └── settings/
│       └── settings-page.tsx       # 设置页(10分区：自动回复/对话/AI/外观/店铺管理/主动推送/Bot与子Agent/路由规则)
├── settings/
│   ├── settings-page.tsx           # 设置页(含三步店铺创建向导)
│   └── shop-create-wizard.tsx      # 店铺创建向导(知识选择→基础配置→客服信息)
└── lib/
└── storage/database/
    ├── shared/schema.ts            # 数据库表定义
    └── supabase-client.ts          # Supabase客户端
└── lib/
    └── types.ts                    # 全局类型定义
```

## 构建与测试

```bash
pnpm install          # 安装依赖
pnpm run dev          # 开发环境 (端口5000)
pnpm run build        # 构建
pnpm run start        # 生产环境
pnpm ts-check         # TypeScript检查
pnpm lint --quiet     # 代码风格检查
```

## 数据库架构与连接配置（2026-07-08）

### 连接配置

#### Supabase REST API（应用层使用）

| 变量 | 值 |
|------|-----|
| `COZE_SUPABASE_URL` | `https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com` |
| `COZE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...`（JWT，role=anon） |
| `COZE_SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIs...`（JWT，role=service_role） |

#### Custom API Gateway

```
https://br-alive-kea-4152cf8a.ap-w5.volcengineapi.com
```

#### PostgreSQL 直连（用于迁移/运维）

| 参数 | 值 |
|------|-----|
| 主机 | `cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com` |
| 端口 | `5432` |
| 数据库 | `postgres` |
| 用户名 | `postgres` |
| 密码 | `$POSTGRES_PASSWORD`（环境变量，见 `.env.local`） |
| 连接字符串 | `postgresql://postgres:$POSTGRES_PASSWORD@cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require` |

#### Connection Pooling（连接池）

| 参数 | 值 |
|------|-----|
| Pooled Host | `br-alive-kea-4152cf8a.pooler.aidap-global.cn-beijing.volces.com` |
| Pooled Port | `5432` |
| Auto-generated | true |

> 连接池适用于高并发场景，可有效减少数据库连接开销。

### 数据库管理命令

```bash
# 查看数据库状态
node scripts/db-admin.js status

# 执行数据库迁移（添加缺失的表）
node scripts/db-migrate.js

# 初始化默认数据
node scripts/db-admin.js init
```

### 数据库表分类总览

数据库包含 60+ 个表，完整定义见 `supabase/migrations/20260627_complete_schema_all.sql`。

#### 核心业务表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `users` | 用户账户 | id, email, name, role(admin/agent/observer), status, password_hash, last_active_at |
| `conversations` | 对话记录 | id, title, status, rating, handoff_reason, summary, participant_ids, message_count, metadata(jsonb) |
| `messages` | 消息记录 | id, conversation_id, role, content, source, confidence, tool_calls, mentions |
| `auto_reply_rules` | 自动回复规则 | id, keywords, reply_content, priority |
| `settings` | 系统配置 | key, value（键值对存储） |
| `shops` | 店铺管理 | id, name, platform, knowledge_ids(jsonb), config(jsonb), agent_quota, contact_info, status |
| `shop_agent_accounts` | 客服托管账号 | id, shop_id, account_name, encrypted_password, platform, status |

#### 知识库表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `knowledge_items` | 知识库条目 | id, title, name, type(text/url/file/image), category, parent_category, content_hash, doc_ids, chunk_count, hit_count, last_hit_at, image_url |
| `knowledge_chunks` | 文本分片 | id, knowledge_item_id, chunk_index, content, content_hash, doc_id, version_added, version_removed |
| `knowledge_versions` | 版本历史 | id, knowledge_item_id, version_number, content, chunk_diff(jsonb), chunk_count |
| `knowledge_import_jobs` | 导入任务 | id, status, progress, chunks_preview, doc_ids |
| `knowledge_learning_queue` | 知识自学习 | id, question, answer, confidence, source_conversation_id, category, status |

#### 客户与营销表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `customers` | 客户画像 | id, name, phone, email, platform, tags, notes, conversation_count |
| `customer_tags` | 客户标签 | id, name, color, category(auto/manual), customer_count |
| `customer_conversations` | 客户-对话关联 | customer_id, conversation_id |
| `marketing_campaigns` | 营销活动 | id, name, type, target_segment(jsonb), bot_id, status, ab_variant(jsonb), message_template, trigger_type, scheduled_at, trigger_config(jsonb) |
| `marketing_logs` | 营销日志 | id, campaign_id, customer_id, conversation_id, variant, delivered, replied, converted |

#### 坐席与队列表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `agent_sessions` | 坐席会话 | id, user_id, status, current_conversation_id, last_active_at |
| `agent_queue` | 人工排队 | id, conversation_id, customer_name, priority, skill_group, assigned_agent_id, status, summary |
| `skill_groups` | 技能组 | id, name, description, member_ids, is_default |
| `schedules` | 排班 | id, user_id, skill_group_id, date, shift, status |
| `quick_replies` | 话术库 | id, title, content, category, variables, scope, usage_count |

#### 质检与标签表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `conversation_tags_def` | 对话标签定义 | id, name, color, category(question_type/sentiment/business_line), conversation_count |
| `conversation_tag_records` | 对话标签记录 | conversation_id, tag_id, tagged_by |
| `quality_rules` | 质检规则 | id, name, type, config(jsonb), enabled |
| `quality_checks` | 质检记录 | id, conversation_id, rule_id, result, details |

#### Bot 与路由表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `bot_configs` | Bot配置 | id, name, description, system_prompt, tools, knowledge_ids, skill_group_id, parent_bot_id, delegate_prompt, collaboration_config(jsonb), is_sub_agent, status |
| `routing_rules` | 路由规则 | id, condition_type, condition_config, target_bot_id, priority, enabled |
| `agent_delegations` | 子Agent委派记录 | id, conversation_id, parent_bot_id, sub_bot_id, trigger_intent, input_message, result_content, confidence, status, error_message |
| `agent_collaborations` | 子Agent协作通信 | id, conversation_id, delegation_id, sender_bot_id, receiver_bot_id, message_type, content, context, status |

#### 工单系统表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `tickets` | 工单 | id, ticket_number, title, description, category, priority, status, assignee_id, creator_id, conversation_id, parent_ticket_id, custom_fields(jsonb) |
| `ticket_comments` | 工单评论 | id, ticket_id, author_id, content, is_internal |
| `ticket_status_log` | 状态变更日志 | id, ticket_id, from_status, to_status, operator_id |
| `ticket_categories` | 工单分类 | id, name, parent_id, config(jsonb) |
| `ticket_custom_fields` | 自定义字段定义 | id, name, field_type, required, options(jsonb) |
| `ticket_field_values` | 自定义字段值 | id, ticket_id, field_id, value |
| `ticket_relations` | 工单关联 | id, ticket_id, related_ticket_id, relation_type(blocks/related/duplicates) |
| `ticket_audit_log` | 操作审计日志 | id, ticket_id, operation, operator_id, details(jsonb) |

#### 推送与告警表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `alerts` | 异常告警 | id, type, severity, message, is_resolved, conversation_id |
| `push_templates` | 推送模板 | id, name, trigger_event, content_template, channel, enabled |
| `push_records` | 推送记录 | id, template_id, recipient, content, trigger_event, channel, status |
| `push_event_log` | 推送事件日志 | id, event_type, event_data(jsonb), processed_at |

#### 商品与尺码表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `product_details` | 商品详情 | id, name, sku, category, brand, price, specifications(jsonb), features, description, image_urls, status, doc_ids, content_hash, hit_count, platform_connection_id |
| `size_charts` | 尺码配置 | id, name, category, chart_type, product_id, size_columns(jsonb), size_rows(jsonb), recommend_params(jsonb), image_url, doc_ids, status, hit_count |
| `size_chart_versions` | 尺码表版本 | id, size_chart_id, version_number, content_snapshot(jsonb), description |

#### Gorgias 集成表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `webhook_event_processed` | Webhook幂等记录 | id, event_id, event_type, processed_at（防止重复处理） |

### 迁移脚本位置

| 脚本 | 说明 |
|------|------|
| `supabase/migrations/20260627_complete_schema_all.sql` | 完整数据库结构（54 表） |
| `supabase/migrations/20260627_migrate_coze_supabase.sql` | 补充表迁移（6 表） |
| `supabase/migrations/20260710_gorgias_message_dedup.sql` | Gorgias 消息去重索引 |
| `supabase/migrations/20260624_gorgias_metadata.sql` | Gorgias 元数据字段 |

---

## 数据库表

| 表名 | 用途 |
|------|------|
| conversations | 对话记录（标题、状态、评分、转人工原因、摘要、参与者IDs、是否协同） |
| messages | 消息记录（角色、内容、来源、置信度、工具调用、@提及） |
| auto_reply_rules | 自动回复规则 |
| settings | 系统配置键值对 |
| shops | 店铺管理（名称、平台、知识库关联、业务配置jsonb、账号配额、联系信息、状态） |
| shop_agent_accounts | 店铺客服账号（店铺ID、账号名、AES加密密码、平台、状态，级联删除） |
| knowledge_items | 知识库条目追踪（标题、名称、类型text/url/file、分类、父分类、content_hash去重、doc_ids、chunk_count、hit_count引用次数、last_hit_at、image_url） |
| alerts | 异常对话告警（类型、严重度、消息、是否已处理） |
| knowledge_learning_queue | 知识自学习候选队列（问题、答案、置信度、来源对话、分类、审核状态） |
| push_templates | 推送模板（名称、触发事件、内容模板、渠道、启用状态） |
| push_records | 推送记录（模板ID、接收人、内容、触发事件、渠道、状态） |
| push_event_log | 推送事件日志（事件类型、事件数据、处理状态） |
| users | 用户表（邮箱、姓名、角色admin/agent/observer、状态、最后活跃时间、password_hash） |
| role_permissions | 权限配置（角色+资源+操作→是否允许） |
| customers | 客户画像（姓名、手机、邮箱、来源平台、标签、备注、对话数） |
| customer_tags | 客户标签（名称、颜色、分类auto/manual、关联客户数） |
| customer_conversations | 客户-对话关联表（客户ID+对话ID） |
| agent_sessions | 坐席会话（用户ID、在线状态、当前对话、最后活跃时间） |
| agent_queue | 人工排队（对话ID、客户名、优先级、技能组、分配坐席、状态、摘要） |
| skill_groups | 技能组（名称、描述、成员IDs、是否默认） |
| schedules | 排班（用户ID、技能组ID、日期、班次、状态） |
| quick_replies | 话术库（标题、内容、分类、变量、范围、使用次数） |
| conversation_tags_def | 对话标签定义（名称、颜色、分类question_type/sentiment/business_line、关联对话数） |
| conversation_tag_records | 对话标签记录（对话ID+标签ID+打标人） |
| quality_rules | 质检规则（名称、类型、配置JSON、是否启用） |
| quality_checks | 质检记录（对话ID、规则ID、结果pass/fail、详情） |
| bot_configs | Bot配置（名称、描述、系统提示词、工具、知识库、技能组、父Bot ID、委派提示词、协作配置、是否子Agent、状态） |
| routing_rules | 路由规则（条件类型、条件配置、目标Bot、优先级、启用状态） |
| marketing_campaigns | 营销活动（名称、类型、目标客群、Bot、状态、A/B变体、定时投放配置、消息模板） |
| marketing_logs | 营销日志（活动ID、客户ID、对话ID、变体、触达/回复/转化） |
| tickets | 工单（工单号、标题、描述、分类、优先级、状态、指派人、创建人、关联对话） |
| ticket_comments | 工单评论（工单ID、作者、内容、是否内部评论） |
| ticket_status_log | 工单状态变更日志（工单ID、原状态、新状态、操作人） |
| knowledge_versions | 知识库版本历史（条目ID、版本号、标题、内容、变更摘要、创建人） |
| agent_delegations | 子Agent委派记录（对话ID、父/子Bot ID、触发意图、输入消息、结果内容、置信度、状态、错误信息） |
| agent_collaborations | 子Agent协作通信（对话ID、委派ID、发送/接收Bot ID、消息类型、内容、上下文、状态） |
| product_details | 商品详情（名称/SKU/分类/品牌/价格/规格/卖点/描述/图片，含向量文档ID、引用计数） |
| size_charts | 尺码配置（名称/类型/分类/关联商品/尺码列定义/尺码数据行/推荐参数/描述，含向量文档ID、引用计数） |
| size_chart_versions | 尺码表版本历史（尺码表ID、版本号、内容快照、变更描述、创建时间） |
| knowledge_import_jobs | 知识库导入任务（进度追踪、多阶段状态、chunks预览） |

## Gorgias 集成（2026-07-03）

### 概述

Gorgias 是一个多渠道客户服务平台，本模块将其 API 接入 SmartAssist，实现会话同步、聊天记录同步、客户管理和坐席数据查看。

### API 认证

Gorgias 使用 HTTP Basic Authentication：
- **Username**: 您的 Gorgias 账户邮箱
- **Password**: REST API Key（在 Gorgias 设置 → REST API 中获取）
- **Base URL**: `https://{domain}.gorgias.com/api/`

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/gorgias-client.ts` | Gorgias API HTTP 客户端（认证、超时、重试、日志） |
| `src/server/repositories/gorgias-repository.ts` | 数据访问层（Conversations、Tickets、Messages、Customers、Users、Tags） |
| `src/server/services/gorgias-service.ts` | 业务逻辑层（数据转换、过滤、聚合） |
| `src/app/api/gorgias/route.ts` | 主入口（连接测试、数据同步状态） |
| `src/app/api/gorgias/tickets/route.ts` | 工单列表与统计 |
| `src/app/api/gorgias/tickets/[id]/route.ts` | 工单详情（包含对话消息） |
| `src/app/api/gorgias/messages/route.ts` | 消息列表（按工单筛选） |
| `src/app/api/gorgias/customers/route.ts` | 客户列表与统计 |
| `src/app/api/gorgias/users/route.ts` | 坐席/用户列表与统计 |
| `src/app/api/gorgias/tags/route.ts` | 标签列表 |
| `src/app/api/gorgias/settings/route.ts` | 配置保存与验证（GET/PUT，仅 admin） |
| `src/components/settings/gorgias-settings.tsx` | 设置页面配置 UI |

### 配置项（存储于 settings 表）

| Key | 说明 | 默认值 |
|-----|------|--------|
| `gorgias_domain` | Gorgias 子域名 | - |
| `gorgias_email` | API 用户邮箱 | - |
| `gorgias_api_key` | API Key | - |
| `gorgias_enabled` | 是否启用 | false |
| `gorgias_sync_enabled` | 是否自动同步 | false |
| `gorgias_sync_interval_minutes` | 同步间隔（分钟） | 30 |

### Gorgias API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/gorgias | 连接测试 + 同步状态 |
| POST | /api/gorgias/sync | 触发手动同步 |
| GET | /api/gorgias/settings | 获取 Gorgias 配置（仅 admin） |
| PUT | /api/gorgias/settings | 更新 Gorgias 配置（仅 admin） |
| GET | /api/gorgias/tickets | 获取工单列表（支持筛选、分页） |
| GET | /api/gorgias/tickets/[id] | 获取工单详情（含消息） |
| GET | /api/gorgias/messages | 获取消息列表（支持 ticket_id 筛选） |
| GET | /api/gorgias/customers | 获取客户列表（支持搜索、分页） |
| GET | /api/gorgias/users | 获取坐席/用户列表（含在线状态） |
| GET | /api/gorgias/tags | 获取标签列表 |

### 前端设置 UI

在设置页面「Gorgias 集成」分区提供：
- **连接配置**: 子域名、邮箱、API Key 输入框
- **功能开关**: 启用同步、选择同步范围
- **测试连接**: 验证凭证有效性，显示账户信息
- **同步控制**: 手动触发同步、查看最后同步时间
- **状态指示**: 连接状态徽章（未配置/已连接/同步中/错误）

### Gorgias Webhook 实时同步（2026-06-24）

#### 概述

当 Gorgias 收到客户消息时，通过 Webhook 主动推送到 SmartAssist，实时显示在对话监控页面。

#### 架构

```
[Gorgias] → ticket-message-created / ticket-created / ticket-updated
    │ POST JSON (完整工单+消息)
    ▼
[SmartAssist /api/gorgias/webhook]
    │
    ├─ 1. Secret 验证
    ├─ 2. 事件分发 (ticket-message-created / ticket-created / ticket-updated / ticket-handed-over)
    ├─ 3. 数据转换 (Gorgias Ticket → SmartAssist Conversation + Messages)
    ├─ 4. 幂等处理 (基于 event_id 去重)
    ├─ 5. 写入数据库
    └─ 6. 返回 200
         │
         ▼
[对话监控页面] ← 实时显示新消息
```

#### 支持的事件

| 事件 | 说明 |
|------|------|
| `ticket-created` | 新工单创建 → 创建对话 |
| `ticket-message-created` | 新消息到达 → 追加消息（核心） |
| `ticket-updated` | 工单状态变更 → 更新对话状态 |
| `ticket-handed-over` | 转人工 → 触发转人工告警 |

#### 关键文件

| 文件 | 职责 |
|------|------|
| `src/app/api/gorgias/webhook/route.ts` | Webhook 接收端点（Secret 验证、事件分发、幂等处理） |
| `src/server/services/gorgias-sync-service.ts` | 数据转换与同步逻辑 |
| `src/server/repositories/gorgias-repository.ts` | 新增 Webhook Integration CRUD |
| `src/app/api/gorgias/sync/route.ts` | 手动触发全量同步 |
| `supabase/migrations/20260624_gorgias_metadata.sql` | 数据库变更（conversations/messages metadata 字段） |

#### Webhook 配置流程

1. 在 SmartAssist 设置页填写 Gorgias 凭证
2. 保存时自动调用 Gorgias API 创建 HTTP Integration
3. 获取 SmartAssist 的 Webhook URL 和 Secret
4. 将 Webhook URL 配置到 Gorgias Integration（或自行在 Gorgias 后台配置）
5. 在 Gorgias 开启事件触发器（ticket-created、ticket-message-created、ticket-updated、ticket-handed-over）

#### 数据映射

| Gorgias Ticket | SmartAssist Conversation |
|----------------|-------------------------|
| `id` | `metadata.gorgias_ticket_id` |
| `subject` | `title` |
| `status` | `status` (open→active, closed→completed) |
| `channel` | `source` |
| `customer.email` | `customer_id`（匹配或创建） |
| `tags` | `metadata.gorgias_tags` |

#### API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/gorgias/webhook | 接收 Gorgias Webhook 事件 |
| POST | /api/gorgias/sync | 触发全量同步 |
| GET | /api/gorgias/sync | 获取同步状态 |

#### 已修复问题（2026-06-25）- Webhook 消息接收失败

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| Gorgias 发送空 body | Webhook 处理器支持从 query params 获取 ticket_id，再从 Gorgias API 拉取完整 ticket 数据 | `webhook/route.ts`, `gorgias-sync-service.ts` |
| Webhook URL 缺少 ticket_id 模板变量 | URL 添加 `&ticket_id={{ticket.id}}`，Gorgias 发送时会自动替换 | `gorgias-service.ts` |
| 更新 Integration 时 `http.name` 不被接受 | 移除 `http.name` 字段，只保留顶层 `name` | `gorgias-repository.ts` |
| Integration 查找逻辑宽泛 | 改为同时按名称和 URL 精确匹配 | `gorgias-repository.ts`, `gorgias-service.ts` |
| 列表 API 未过滤 type=http | 添加 `type=http` 查询参数 + cursor 分页遍历 | `gorgias-repository.ts` |
| 客户端缓存未刷新 | 新增 `resetClient()` 方法，保存设置后重置 | `gorgias-repository.ts`, `settings/route.ts` |
| Webhook 注册失败静默吞掉 | 返回注册结果给前端，显示不同 toast 提示 | `settings/route.ts`, `gorgias-settings.tsx` |
| 诊断 API 查询不存在列 | `created_at` → `processed_at` | `gorgias/route.ts` |
| Babel 编译错误 "Unexpected token" | 文件末尾中文注释可能导致编码问题，改为纯 ASCII 注释 | `gorgias-service.ts` |

## API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/auth/login | 用户登录（邮箱+密码，返回 JWT Cookie） |
| POST | /api/auth/logout | 用户登出（清除 Cookie） |
| GET | /api/auth/me | 获取当前登录用户信息 |
| POST | /api/auth/password | 管理员设置用户密码 |
| GET | /api/auth/login-events | 获取登录日志（admin） |
| GET | /api/conversations | 获取对话列表 |
| POST | /api/conversations | 创建新对话 |
| GET | /api/conversations/[id] | 获取对话详情+消息 |
| DELETE | /api/conversations/[id] | 删除对话 |
| PATCH | /api/conversations/[id] | 更新对话状态(结束/重开) |
| POST | /api/conversations/[id]/messages | 发送消息(流式SSE) |
| POST | /api/conversations/[id]/rating | 提交满意度评价 |
| POST | /api/conversations/[id]/handoff | 转人工接管（返回对话摘要） |
| POST | /api/conversations/[id]/internal-note | 添加内部备注(@提及) |
| POST | /api/conversations/[id]/participants | 添加/移除协同参与者 |
| GET | /api/simulations | 获取模拟测试列表 |
| POST | /api/simulations | 创建模拟测试会话 |
| GET | /api/simulations/[id] | 获取模拟会话详情+消息 |
| DELETE | /api/simulations/[id] | 删除模拟会话 |
| POST | /api/simulations/[id]/messages | 发送消息(流式SSE) |
| GET | /api/analytics | 获取数据分析(指标+趋势+满意度趋势+分布+告警统计) |
| GET | /api/auto-reply | 获取自动回复规则 |
| POST | /api/auto-reply | 新增规则 |
| DELETE | /api/auto-reply?id=xxx | 删除规则 |
| GET | /api/alerts | 获取告警列表 |
| POST | /api/alerts | 创建告警 |
| PATCH | /api/alerts?id=xxx | 标记告警已处理 |
| GET | /api/knowledge?query=xxx | 知识库搜索(带相关性阈值过滤) |
| POST | /api/knowledge/import | 导入知识库资料（文本/URL/文件上传，文件支持 .xlsx/.xls/.csv/.pdf/.docx/.doc/.md/.txt，含SHA-256去重检测） |
| POST | /api/knowledge/import-jobs | 创建导入任务(增强模式，带进度追踪) |
| GET | /api/knowledge/import-jobs | 获取用户进行中的导入任务列表 |
| GET | /api/knowledge/import-jobs/[id] | 获取导入任务状态 + chunks预览 |
| DELETE | /api/knowledge/import-jobs/[id] | 删除已完成/失败的导入任务 |
| GET | /api/knowledge/items | 获取知识库条目列表 |
| PUT | /api/knowledge/items | 编辑知识库条目(含增量向量更新) |
| DELETE | /api/knowledge/items?id=xxx | 删除知识库条目 |
| GET | /api/knowledge/versions?item_id=xxx | 获取知识条目版本历史 |
| POST | /api/knowledge/versions | 回滚到指定版本 |
| GET | /api/knowledge/products | 获取商品列表(支持category/status/search筛选) |
| POST | /api/knowledge/products | 创建商品(含向量化) |
| PUT | /api/knowledge/products | 更新商品(含增量向量化) |
| DELETE | /api/knowledge/products?id=xxx | 删除商品(含向量文档清理) |
| GET | /api/knowledge/products/[id] | 获取商品详情 |
| PATCH | /api/knowledge/products/batch | 批量操作商品(修改状态/分类) |
| GET | /api/knowledge/size-charts | 获取尺码表列表(支持category/chart_type/status/search筛选) |
| POST | /api/knowledge/size-charts | 创建尺码表(含向量化) |
| PUT | /api/knowledge/size-charts | 更新尺码表(含增量向量化) |
| DELETE | /api/knowledge/size-charts?id=xxx | 删除尺码表(含向量文档清理) |
| GET | /api/knowledge/size-charts/[id] | 尺码表详情 |
| GET | /api/knowledge/size-charts/versions?chart_id=xxx | 获取尺码表版本历史 |
| POST | /api/knowledge/size-charts/versions | 回滚到指定版本 |
| POST | /api/knowledge/size-charts/import | 批量导入尺码表(Excel/CSV) |
| GET | /api/knowledge/size-charts/export?format=csv | 导出尺码表(CSV) |
| GET | /api/settings | 获取设置 |
| PUT | /api/settings | 更新设置 |
| GET | /api/shops?stats=true | 获取店铺列表(含统计) |
| POST | /api/shops | 创建店铺(含知识库关联+业务配置+客服账号) |
| GET | /api/shops/[id] | 获取店铺详情 |
| PATCH | /api/shops/[id] | 更新店铺 |
| DELETE | /api/shops/[id] | 删除店铺(级联删除客服账号) |
| GET/POST/DELETE | /api/shops/[id]/agent-accounts | 客服账号 CRUD (密码AES-256加密) |
| POST | /api/knowledge-learning | 扫描对话提取候选QA |
| PATCH | /api/knowledge-learning | 审核操作(通过/拒绝/批量) |
| PUT | /api/knowledge-learning | 编辑候选QA内容 |
| POST | /api/upload | 上传图片(多模态图片理解) |
| GET | /api/push/templates | 获取推送模板列表 |
| POST | /api/push/templates | 创建推送模板 |
| PUT | /api/push/templates | 更新推送模板 |
| DELETE | /api/push/templates?id=xxx | 删除推送模板 |
| GET | /api/push/records | 获取推送记录 |
| POST | /api/push/webhook | 接收Webhook事件(自动匹配模板并发送推送) |
| GET | /api/push/events | 获取事件日志(含webhook密钥) |
| PATCH | /api/push/events | 标记事件已处理 |
| GET | /api/users | 获取用户列表(支持角色/状态/搜索筛选) |
| POST | /api/users | 创建用户 |
| PATCH | /api/users | 更新用户(角色/状态) |
| DELETE | /api/users?id=xxx | 删除用户 |
| GET | /api/permissions | 获取权限配置列表 |
| PUT | /api/permissions | 更新权限配置(批量) |
| GET | /api/customers | 获取客户列表(支持平台/标签/搜索筛选) |
| POST | /api/customers | 创建客户 |
| GET | /api/customers/[id] | 获取客户详情(含关联对话) |
| PATCH | /api/customers/[id] | 更新客户(标签/备注) |
| GET | /api/customer-tags | 获取标签列表 |
| POST | /api/customer-tags | 创建标签 |
| DELETE | /api/customer-tags?id=xxx | 删除标签 |
| GET | /api/agent/queue | 获取排队列表(支持状态筛选) |
| POST | /api/agent/queue | 坐席接单(queue_id+agent_id) |
| PATCH | /api/agent/queue | 更新排队状态(resolve/transfer) |
| PATCH | /api/agent/status | 切换坐席在线状态(online/away/offline) |
| GET | /api/agent/performance | 获取坐席绩效统计 |
| GET | /api/skill-groups | 获取技能组列表 |
| POST | /api/skill-groups | 创建技能组 |
| PUT | /api/skill-groups | 更新技能组 |
| DELETE | /api/skill-groups?id=xxx | 删除技能组 |
| GET | /api/schedules | 获取排班列表 |
| POST | /api/schedules | 创建排班 |
| PUT | /api/schedules | 更新排班 |
| DELETE | /api/schedules?id=xxx | 删除排班 |
| GET | /api/quick-replies | 获取话术库列表(分类+搜索) |
| POST | /api/quick-replies | 创建话术 |
| PUT | /api/quick-replies | 编辑话术 |
| DELETE | /api/quick-replies?id=xxx | 删除话术 |
| GET | /api/quick-replies/export?format=xlsx/csv | 导出话术库(Excel/CSV) |
| POST | /api/quick-replies/import | 批量导入话术(Excel/CSV) |
| GET | /api/conversation-tags | 获取对话标签列表 |
| POST | /api/conversation-tags | 创建对话标签 |
| DELETE | /api/conversation-tags?id=xxx | 删除对话标签 |
| POST | /api/conversation-tags/tag | 为对话打标签 |
| DELETE | /api/conversation-tags/untag | 取消对话标签 |
| GET | /api/quality-checks | 获取质检规则+记录 |
| POST | /api/quality-checks | 创建质检规则 |
| PUT | /api/quality-checks | 更新质检规则 |
| DELETE | /api/quality-checks?id=xxx | 删除质检规则 |
| GET | /api/export/conversations | 导出对话记录(CSV) |
| GET | /api/export/analytics | 导出统计报表(CSV) |
| GET | /api/bot-configs | 获取Bot配置列表 |
| POST | /api/bot-configs | 创建Bot配置 |
| PUT | /api/bot-configs | 更新Bot配置 |
| DELETE | /api/bot-configs?id=xxx | 删除Bot配置 |
| GET | /api/routing-rules | 获取路由规则列表 |
| POST | /api/routing-rules | 创建路由规则 |
| PUT | /api/routing-rules | 更新路由规则 |
| DELETE | /api/routing-rules?id=xxx | 删除路由规则 |
| GET | /api/marketing | 获取营销活动列表(含统计) |
| POST | /api/marketing | 创建营销活动 |
| PATCH | /api/marketing | 更新营销活动(状态/内容) |
| GET | /api/marketing/analytics | 获取营销效果分析 |
| POST | /api/marketing/preview-segment | 预览目标客群人数 |
| POST | /api/marketing/ab-winner | A/B获胜判定与推广 |
| POST | /api/tools/order-query | 查询订单(返回订单卡片富消息) |
| POST | /api/tools/logistics-query | 查询物流(返回物流进度富消息) |
| POST | /api/tools/refund-action | 退款操作(返回操作确认富消息) |
| GET | /api/tickets | 获取工单列表(支持状态/优先级/分类/搜索筛选) |
| POST | /api/tickets | 创建工单 |
| GET | /api/tickets/[id] | 获取工单详情(含评论+状态变更日志) |
| PATCH | /api/tickets/[id] | 更新工单(状态流转/指派/优先级) |
| DELETE | /api/tickets/[id] | 删除工单 |
| POST | /api/tickets/[id]/comments | 添加工单评论 |
| POST | /api/tickets/from-conversation | 从对话创建工单 |
| GET | /api/sub-agents?parent_bot_id=xxx | 获取子Agent列表 |
| GET | /api/sub-agents?bot_tree=xxx | 获取Bot树(父+子) |
| GET | /api/sub-agents?main_bots=true | 获取主Bot列表(含子Agent统计) |
| POST | /api/sub-agents | 创建子Agent |
| PUT | /api/sub-agents | 更新子Agent |
| DELETE | /api/sub-agents?id=xxx | 删除子Agent |
| POST | /api/sub-agents/delegate | 委派任务给子Agent |
| POST | /api/sub-agents/collaborate | 子Agent间发送协作消息 |
| GET | /api/sub-agents/delegations?conversation_id=xxx | 获取委派历史 |

## 设计规范

见 DESIGN.md — 企业风：安静、可信、低噪音、高信息密度、专业克制。

## 安全与基础设施

### 认证与登录

| 功能 | 说明 |
|------|------|
| 登录页面 | `/login` - 邮箱+密码表单 |
| JWT 认证 | `POST /api/auth/login` 验证后签发 8 小时有效期 Token |
| Token 存储 | HTTP-only Cookie，防 XSS 攻击 |
| 密码加密 | bcrypt 12 轮哈希 |
| 登录限流 | 同一 IP 5 分钟内最多 5 次尝试 |
| **账户锁定** | 连续失败 5 次后锁定 15 分钟（防暴力破解） |
| **登录日志** | 记录所有登录事件（成功/失败、IP、时间） |
| **JWT Secret 检查** | 启动时检测弱密钥并输出警告 |
| 默认账户 | admin@smartassist.com / Admin123456 |

**安全机制详情：**
- 登录失败计数：同一邮箱连续失败 5 次 → 锁定 15 分钟
- 锁定提示：返回剩余等待时间，不暴露精确锁定时间
- IP 匿名化：日志中自动脱敏处理
- Cookie 安全配置：httpOnly + Secure(生产) + SameSite=lax

**关键文件：**
- `src/app/login/page.tsx` — 登录页 UI
- `src/app/api/auth/login/route.ts` — 登录 API（含限流+锁定）
- `src/app/api/auth/logout/route.ts` — 登出 API
- `src/app/api/auth/me/route.ts` — 当前用户 API
- `src/app/api/auth/password/route.ts` — 管理员设置密码 API
- `src/app/api/auth/login-events/route.ts` — 登录日志查询 API (admin)
- `src/lib/auth/jwt.ts` — JWT 工具函数（含 Secret 强度检查）
- `src/lib/auth/password.ts` — 密码哈希工具（含强度校验）
- `src/lib/auth/login-security.ts` — 登录安全服务（限流+锁定+日志）
- `src/lib/auth/ip-utils.ts` — IP 提取与匿名化工具
- `src/lib/auth.tsx` — AuthContext 认证状态管理
- `src/middleware.ts` — 路由保护中间件

**路由保护策略：**
| 路由 | 保护规则 |
|------|----------|
| `/login` | 已登录 → 重定向到 `/` |
| 其他页面 | 未登录 → 重定向到 `/login` |

### API 权限校验
- 敏感 API（users、settings、permissions）已添加 `requireRole` 中间件，仅 admin 角色可操作
- `requireRole` 从 JWT Cookie 读取用户角色（替代旧的 `x-user-role` header）
- 权限校验实现在 `src/lib/api-utils.ts` 的 `requireRole()` 函数
- 新增 `getAuthenticatedUserId()` 函数获取当前登录用户 ID

### 工具执行鉴权
- `ToolExecutionService.verifyToolAuthorization()` 已实现真实的会话归属校验
- LLM 流式处理流程中，`parseAndExecuteToolCalls` 改为异步，先鉴权再执行工具

### 速率限制
- 高频 API 已添加基于 IP 的滑动窗口限流：消息发送 20/min、知识导入 10/min、文件上传 30/min
- 实现在 `src/lib/api-utils.ts` 的 `checkRateLimit()` 函数

### 数据安全
- SQL LIKE/ILIKE 查询统一使用 `escapeLikePattern()` 转义，防止通配符注入
- 错误日志自动脱敏：邮箱、手机号、API Key、Token、长十六进制串均会被 `[REDACTED]` 替换

### Demo 模式内存管理
- 所有 Demo 模式的内存数组（conversations、auto-reply、tags、campaigns、templates、quality rules）添加 `trimDemoArray()` 上限保护（最大 200 条）

### 流式响应健壮性
- SSE 流创建失败时返回错误事件（而非 500 崩溃）
- 前端添加 60 秒流超时机制，超时后保留已有内容并提示不完整

### 前端动态配置
- 聊天窗口的快捷回复、转接部门、转接坐席改为从 API 动态加载（fallback 到硬编码默认值）

---

## 工单系统完善（2026-06-17）

### 概述

工单系统从 MVP 级别升级为企业级，新增 10 个 Phase 的功能模块。

### Phase 1: 通知机制

| 能力 | 说明 |
|------|------|
| 指派通知 | 工单指派坐席时，向 alerts 表插入 `ticket_assigned` 告警 |
| 状态变更通知 | 工单状态变更时，通知创建人和指派人（`ticket_status_changed`） |
| 评论 @提及 | 评论中 `@坐席名` 时，被提及者收到通知（`ticket_mention`） |
| 未指派提醒 | 新工单 15 分钟无指派人，自动产生 `ticket_unassigned` 告警 |
| 设置项 | `ticket_notify_enabled` 控制通知开关 |

### Phase 2: 智能指派

| 能力 | 说明 |
|------|------|
| 自动指派 API | `PATCH /api/tickets/{id}` action=auto_assign，按规则自动选坐席 |
| 负载感知 | 查询坐席当前 open + in_progress 工单数，优先分配给负载最低的 |
| 技能组匹配 | 工单分类 → 技能组（如 refund → 售后组）→ 从组内选人 |
| 排班感知 | 排除离线/休息坐席 |
| 设置项 | `ticket_auto_assign` 控制创建时自动指派 |

### Phase 3: SLA 超时机制

| 能力 | 说明 |
|------|------|
| SLA 定义 | 每个优先级对应响应时限和处理时限（如 urgent: 15min/2h） |
| 超时检测 | 查询时计算 is_overdue 和 sla_remaining_minutes |
| 超时告警 | 超过响应时限 → warning，超过处理时限 → critical |
| 超时升级 | 超时后自动提升优先级，触发重新指派 |
| 设置项 | `ticket_sla_enabled`、`ticket_sla_response_minutes`、`ticket_sla_resolve_minutes` |
| 前端 | 列表超时行标红，详情页显示剩余时间倒计时 |

### Phase 4: 批量操作

| 能力 | 说明 |
|------|------|
| 批量 API | `PATCH /api/tickets/batch`，支持 close/resolve/priority/category |
| 前端多选 | 列表行 checkbox，底部浮动操作栏，确认对话框 |

### Phase 5: 自定义字段与分类扩展

| 能力 | 说明 |
|------|------|
| 自定义字段 | `ticket_custom_fields` + `ticket_field_values` 表 |
| 工单分类可配置 | `ticket_categories` 表替代硬编码 enum |
| CRUD API | `/api/tickets/custom-fields`、`/api/tickets/categories` |
| 前端动态表单 | 创建工单时根据自定义字段定义动态渲染表单 |

### Phase 6: 工单关联与子工单

| 能力 | 说明 |
|------|------|
| 子工单 | tickets 表新增 `parent_ticket_id`，支持从父工单创建子工单 |
| 关联工单 | `ticket_relations` 表（blocks/related/duplicates） |
| 进度汇总 | 父工单展示子工单进度 |
| API | `/api/tickets/{id}/sub-tickets`、`/api/tickets/{id}/relations` |

### Phase 7: 报表与统计

| 能力 | 说明 |
|------|------|
| 处理时长统计 | 平均首次响应时间、平均处理时间 |
| 坐席效率 | 每坐席工单完成数、平均处理时间、超时率 |
| Dashboard | 新增工单统计区域 |
| 导出 | `/api/export/tickets` CSV 导出 |

### Phase 8: 客户侧可见性

| 能力 | 说明 |
|------|------|
| 客户查询接口 | `GET /api/tickets/customer?external_id=xxx` |
| 聊天窗口 | 对话窗口展示关联工单状态卡片 |

### Phase 9: 权限控制与审计

| 能力 | 说明 |
|------|------|
| 角色权限 | tickets 资源 view/create/assign/close/delete 权限，DELETE 需 admin |
| 操作审计 | `ticket_audit_log` 表，记录所有写操作 |
| 审计日志 API | `GET /api/tickets/{id}/audit-log` |

### Phase 10: 前端体验优化

| 能力 | 说明 |
|------|------|
| 指派人下拉 | 创建工单时从用户列表选择指派人 |
| 排序 | 支持按创建时间/更新时间/优先级排序 |
| 分页 | 列表分页（每页 20 条） |
| 分类筛选 | 动态加载分类列表 |
| 工单号复制 | 点击工单编号复制到剪贴板 |
| 空状态引导 | 无工单时显示创建引导 |

### 新增数据库表

| 表名 | 用途 |
|------|------|
| ticket_categories | 工单分类配置 |
| ticket_custom_fields | 自定义字段定义 |
| ticket_field_values | 自定义字段值 |
| ticket_relations | 工单关联 |
| ticket_audit_log | 操作审计日志 |

### 新增 tickets 表字段

| 字段 | 类型 | 用途 |
|------|------|------|
| parent_ticket_id | UUID | 父工单 ID |

### 新增 API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET/POST/PUT/DELETE | /api/tickets/categories | 分类 CRUD |
| GET/POST/PUT/DELETE | /api/tickets/custom-fields | 自定义字段 CRUD |
| GET/POST | /api/tickets/{id}/sub-tickets | 子工单 |
| GET/POST/DELETE | /api/tickets/{id}/relations | 关联工单 |
| PATCH | /api/tickets/batch | 批量操作 |
| GET | /api/tickets/customer | 客户查询 |
| GET | /api/tickets/{id}/audit-log | 审计日志 |
| GET | /api/export/tickets | CSV 导出 |

---

## 知识库导入增强（2026-06-23）

### 概述

参考影刀AI Power知识库，实现导入后多阶段进度追踪 + 切分预览功能。

### 功能特性

| 能力 | 说明 |
|------|------|
| 多阶段进度条 | 上传(0-20%) → 解析(20-40%) → 切分(40-60%) → 向量化(60-90%) → 完成(100%) |
| 切分预览 | 导入前展示本地切分结果（前5个chunks预览），用户可确认切分效果 |
| 异步处理 | 后台异步执行，不阻塞前端；支持轮询查询状态 |
| SHA-256 去重 | 导入前检测相同内容，已存在则返回409冲突 |

### 架构设计

```
POST /api/knowledge/import-jobs
   ↓
创建任务记录 (status: pending)
   ↓
触发异步处理 (setImmediate)
   ↓
[Stage 1] 上传S3 (0-20%)
   ↓
[Stage 2] 文档解析/文本提取 (20-40%)
   ↓
[Stage 3] 本地文本切分 (40-60%) → 保存 chunks_preview
   ↓
[Stage 4] Coze向量化 (60-90%)
   ↓
[Stage 5] 保存知识条目 (90-100%)
```

### 新增数据库表

| 表名 | 用途 |
|------|------|
| knowledge_import_jobs | 导入任务记录（进度、chunks预览、doc_ids） |

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/server/repositories/knowledge-import-job-repository.ts` | 导入任务 CRUD |
| `src/server/services/knowledge-import-service.ts` | 异步处理流水线 |
| `src/server/services/text-extractor.ts` | 多格式文本提取（xlsx/pdf/docx/txt等） |
| `src/app/api/knowledge/import-jobs/route.ts` | POST创建/GET列表 |
| `src/app/api/knowledge/import-jobs/[id]/route.ts` | GET状态/DELETE |
| `src/components/faq/import-progress.tsx` | 前端进度条 + chunks预览组件 |
| `src/components/faq/product-form-modal.tsx` | 商品创建/编辑表单 |
| `src/components/faq/size-chart-form-modal.tsx` | 尺码表创建/编辑表单（含预览态） |

### 前端交互

- FAQ 页面导入按钮弹出模式选择（快速导入 / 增强导入）
- 增强导入显示实时进度条 + 阶段状态
- 切分预览展示前5个chunks，支持"查看全部"展开
- 完成后显示知识条目ID，点击跳转知识库

### 依赖

- `xlsx` - Excel文件解析
- `mammoth` - DOCX文件解析
- `pdf-parse` - PDF文件解析

---

## 知识库图片上传支持（2026-07-02）

### 概述

知识库相关的所有导入/添加场景支持直接上传图片文件（不仅限于 URL），包括知识库条目导入、商品详情图片、尺码表示意图。

### 功能特性

| 能力 | 说明 |
|------|------|
| ImageUploadInput 组件 | 公共组件，支持 URL 输入 + 本地文件上传，上传后自动填入 URL |
| 知识库图片导入 | 导入类型新增"图片"选项卡，支持上传图片 + 可选描述文字 |
| 文件导入支持图片格式 | ALLOWED_EXTENSIONS 新增 .jpg/.jpeg/.png/.gif/.webp |
| 图片文件简化流水线 | 图片文件跳过解析/切分/向量化，仅存储 image_url + 可选描述 |
| 商品图片上传 | 商品详情表单中的图片输入从纯 URL 改为 ImageUploadInput |
| 尺码表示意图上传 | 尺码表表单中的图片输入从假上传按钮改为 ImageUploadInput |
| 上传 URL 有效期区分 | `/api/upload` 新增 purpose 参数：knowledge(365天) / chat(30天) |

### 图片导入处理策略

- **有描述文字**：描述走正常向量化，图片 URL 关联到 `image_url`
- **无描述文字**：仅存储 `image_url`，`content` 存资料名称（保证条目可被搜索）
- **去重**：image 类型使用 `image_url` 做内容哈希去重
- **type 标记**：新增 `'image'` 类型值（`knowledge_items.type`）

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/components/common/image-upload-input.tsx` | 公共图片上传组件（URL输入 + 本地上传 + 预览） |
| `src/app/api/upload/route.ts` | 新增 purpose 参数，知识库用途 URL 有效期 365 天 |
| `src/app/api/knowledge/import/route.ts` | 新增 image 类型处理 + 图片格式支持 + 去重 |
| `src/app/api/knowledge/import-jobs/route.ts` | 传递 description 字段 |
| `src/server/services/knowledge-import-service.ts` | 图片文件简化流水线（跳过解析/切分/向量化） |
| `src/server/services/text-extractor.ts` | 新增 image 类型识别 |
| `src/server/repositories/knowledge-import-job-repository.ts` | 新增 description 字段 |
| `src/components/faq/faq-page.tsx` | 导入弹窗新增"图片"选项卡 + ImageUploadInput 替换 |
| `src/components/faq/product-form-modal.tsx` | 商品图片输入替换为 ImageUploadInput |
| `src/components/faq/size-chart-form-modal.tsx` | 尺码表图片输入替换为 ImageUploadInput（带预览） |

---

## 常见问题和预防

- **TS 预存错误**: 仓库层（conversation-repository, auto-reply-repository, quality-repository, analytics-repository）存在已知类型不匹配，属于 Demo 数据与正式类型定义的差异，不影响运行时
- **requireRole 当前基于 header**: 生产环境需替换为 JWT/Session 解析，当前 `x-user-role` 仅用于开发阶段

### 已修复问题（2026-06-19）

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| 核心工具 Mock 数据 | 实现 Provider 工厂模式，支持 Mock/Real API 切换 | `src/server/services/tool-providers/` |
| 富消息按钮无交互 | 添加 CardAction 回调，连接退款确认等操作 | `rich-message-card.tsx`, `chat-window.tsx` |
| 硬编码坐席 ID | 改用 useAuth().user.id 动态获取 | `conversation-detail.tsx`, `workspace-page.tsx` |
| JWT Secret 弱校验 | 生产环境强制要求配置，不允许默认密钥 | `src/lib/auth/jwt.ts` |
| 预览环境登录失效 | Middleware 在 Edge Runtime 无法访问运行时 env vars，改为 payload 解码 + API 层完整验证；Cookie secure 属性根据 COZE_PROJECT_ENV 调整 | `src/middleware.ts`, `src/lib/auth/jwt.ts` |

### 已修复问题（2026-06-24）- 数据分析页面

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| computeSatisfactionBySource null 值累加 | 只在 rating 非 null 时累加，避免 null 被当作 0 稀释平均值 | `analytics-service.ts` |
| Demo 模式假数据泄漏 | Demo 模式统一返回零值/空数组，不再返回硬编码假数据 | `analytics-repository.ts` |
| API 并行请求 fail-fast | Promise.all → Promise.allSettled，失败时优雅降级 | `dashboard-page.tsx` |
| getTicketStats N+1 查询 | 并行查询 tickets + status_log，使用 Map 消除 O(n²) 查找 | `analytics-repository.ts` |
| 状态映射硬编码 | 提取 TICKET_STATUS_LABELS / TICKET_STATUS_COLORS 常量 | `dashboard-page.tsx` |
| 日期匹配 startsWith 不可靠 | 改用范围比较 `>= dayStart && <= dayEnd` | `analytics-repository.ts` |
| 手动类型断言 | 添加 ConversationSource / TicketRow / TicketStatusLogRow 类型定义 | `analytics-repository.ts` |

### 已修复问题（2026-07-05）- Gorgias 集成代码审查

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| P0-1: Webhook Secret 校验缺陷 | 改为安全默认：必须配置 secret 且必须匹配 | `webhook/route.ts` |
| P0-2: 内存 Set 缓存多实例问题 | 新增 `webhook_event_processed` 表，持久化幂等检查 | `schema.ts`, `gorgias-sync-service.ts` |
| P0-3: ticket.messages 数组未检查 | 所有位置添加 `Array.isArray()` 检查 | `gorgias-sync-service.ts` |
| P1-4: 类型断言 `as any` | 补充 `via`/`from_agent` 字段定义，消除断言 | `gorgias-client.ts` |
| P1-5: N+1 查询问题 | 新增 `checkMessagesExist()` 批量 IN 查询 | `gorgias-sync-service.ts` |
| P1-6: Webhook 输入校验缺失 | 添加事件类型白名单、object_id 格式校验 | `webhook/route.ts` |
| P2-9: 重复 Supabase 动态导入 | 统一改为文件顶部静态导入 | `gorgias-sync-service.ts` |

### 已修复问题（2026-07-06）- Gorgias Webhook 消息接收失败

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| Integration 列表 API 未传 `type=http` 过滤 | 添加 `type=http` 查询参数，避免返回大量非 HTTP 集成 | `gorgias-repository.ts` |
| Integration 列表 API 不支持 cursor 分页 | 改为循环遍历所有页面，使用 `meta.next_cursor` 翻页 | `gorgias-repository.ts` |
| 查找逻辑宽泛匹配 `i.type === 'http'` | 精确匹配 `i.name === 'SmartAssist Webhook'` | `gorgias-repository.ts` |
| 创建 Integration 请求体含 Gorgias 不支持的字段 | 移除 `method/headers/request_content_type/response_content_type/oauth2`，`name` 放入 `http` 对象内 | `gorgias-repository.ts` |
| 更新 Integration 请求体同样含不支持字段 | 对齐创建请求体格式，移除不支持字段 | `gorgias-repository.ts` |
| Webhook 注册失败被静默吞掉 | `handleWebhookRegistration` 返回 `{ success, error }`，PUT API 返回 `webhook` 字段 | `gorgias/settings/route.ts` |
| 前端保存配置后无法感知注册失败 | 读取 `data.webhook.success` 显示不同 toast 提示 | `gorgias-settings.tsx` |
| 缺少 Webhook 诊断能力 | `GET /api/gorgias` 新增 `webhook` 字段：检查 Integration 注册状态、触发器、Secret/公网地址配置、最近处理事件 | `gorgias/route.ts` |
| 前端缺少 Webhook 诊断 UI | 新增「Webhook 诊断」面板：Integration 状态、触发器开关、事件记录、配置检查 | `gorgias-settings.tsx` |
| 诊断 API 查询 webhook_event_processed 用了不存在的 created_at 列 | 改为使用 processed_at 列 | `gorgias/route.ts` |
| 保存 Gorgias 设置后客户端缓存未刷新 | 新增 `resetClient()` 方法，保存设置后重置客户端 | `gorgias-repository.ts`, `gorgias/settings/route.ts` |
| 诊断 API 按名称查找 Integration，无法识别用户手动创建的不同名称 Integration | 改为同时支持 name 和 URL 匹配 | `gorgias-repository.ts`, `gorgias-service.ts` |

### 已修复问题（2026-07-07）- 对话监控有会话但无消息

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| `findByGorgiasTicketId` 使用 `.maybeSingle()` 多行时报错返回 null，导致 Webhook 反复创建重复对话 | 改为 `.limit(1)` + 取第一条，避免 PostgREST 多行报错 | `conversation-repository.ts` |
| `syncMessages` 批量插入 N 条消息但只调用 `increment_message_count` 一次（+1），导致 `message_count` 不准确 | 改为调用新 RPC `increment_message_count_by(conv_id, delta)`，按实际新增条数增加 | `gorgias-sync-service.ts` |
| LLM 流式回复插入 assistant 消息后未更新 `message_count`，导致每轮对话只 +1（user 消息）而非 +2 | 在 `saveAssistantMessage` 后 fire-and-forget 调用 `incrementMessageCount` | `llm-streaming-service.ts`, `conversation-service.ts` |
| 自动回复匹配插入 assistant 消息后未更新 `message_count` | 自动回复路径添加 `incrementMessageCount` 调用 | `messages/route.ts` |
| 子 Agent 委派回复插入 assistant 消息后未更新 `message_count` | 子 Agent 回复路径添加 `incrementMessageCount` 调用 | `messages/route.ts` |
| 重复 Gorgias 对话数据（同一 ticket_id 创建多个空对话） | 数据库清理：保留消息最多的对话，删除其余重复项 | SQL |
| `message_count` 不一致的历史数据 | SQL 一次性修正所有 `message_count` 与实际消息数不匹配的记录 | SQL |

### 已修复问题（2026-07-10）- Gorgias Webhook 消息重复接收

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| Gorgias 空 body 时 `event.id = Date.now()` 伪值，全局幂等被跳过，导致同一工单被多次处理 | 空 body 时改用 `ticket_{id}_{event_type}` 组合作为幂等键，确保同一工单同一事件类型不会重复处理 | `webhook/route.ts` |
| `syncMessages` 批量 insert 存在 TOCTOU 竞态：多个并发 Webhook 同时通过 `checkMessagesExist` 后各自插入重复消息 | 改为逐条插入 + 后置去重检查（`dedupGorgiasMessages`）；添加 per-ticket 互斥锁（`processingTickets` Map）防止同一工单并发处理 | `gorgias-sync-service.ts` |
| 同一工单的 `ticket-created`、`ticket-message-created`、`ticket-updated` 三个事件各自触发 `triggerAIReply`，产生 3 条重复 AI 回复 | 添加 per-conversation AI 回复去重窗口（30秒）；`ticket-created` 事件不再触发 AI 回复（由后续 `ticket-message-created` 触发）；`ticket-updated` 触发的 AI 回复受去重窗口保护 | `gorgias-sync-service.ts` |
| 数据库缺少 `gorgias_message_id` 唯一索引，无法在数据库层面防止重复 | 新增 migration `20260710_gorgias_message_dedup.sql`：表达式唯一索引 `messages_gorgias_message_id_unique` on `(conversation_id, (metadata->>'gorgias_message_id'))` | `supabase/migrations/20260710_gorgias_message_dedup.sql` |

### 已修复问题（2026-07-08）- Gorgias Webhook 并发竞态与空对话

| 问题 | 修复方案 | 相关文件 |
|------|---------|---------|
| 并发 Webhook 请求同时通过幂等检查，各自创建重复对话 | 幂等检查改为原子插入（`tryAcquireWebhookEvent`），利用数据库 UNIQUE 约束防止竞态 | `gorgias-sync-service.ts`, `webhook/route.ts` |
| `createConversationFromTicket` 并发插入导致重复对话 | 新增 `conversations_gorgias_ticket_id_unique` 唯一索引；插入冲突时回退查找已有对话 | `gorgias-sync-service.ts`, SQL |
| `handleTicketCreated` 在工单无消息时也创建空对话 | 改为 `deferred_no_messages`：无消息时不创建对话，等 `ticket-message-created` 事件时再创建 | `gorgias-sync-service.ts` |
| `handleTicketMessageCreated` 在工单无消息且无已有对话时创建空对话 | 改为 `skipped_no_messages`：无消息且无已有对话时跳过 | `gorgias-sync-service.ts` |
| `handleTicketUpdated` 在工单无消息时也创建空对话 | 同上，无消息时 defer | `gorgias-sync-service.ts` |
| `handleTicketMessageCreated` 只同步最后一条消息 | 改为 `syncMessages` 同步所有未同步消息 | `gorgias-sync-service.ts` |
| body 为空时幂等键用 `ticket_{id}_{type}`，导致同一工单不同消息事件被误拦截 | ~~已改为"不做全局幂等"~~，但此方案导致消息重复（2026-07-10 已修正：改用 `ticket_{id}_{type}` 组合键 + per-ticket 互斥锁 + 消息级去重） | `webhook/route.ts`, `gorgias-sync-service.ts` |
| `gorgias_ticket_id` 存储为 number 类型，大数字被 PostgreSQL 转为科学计数法（如 `6.8790392e+07`），导致唯一索引失效、查询不匹配 | `createConversationFromTicket` 中强制 `String(ticket.id)`；`findByGorgiasTicketId` 改用 `->>` + string 比较；`findByGorgiasMessageId` 同样修复；数据库修复现有 number 为 string | `gorgias-sync-service.ts`, `conversation-repository.ts`, SQL |
| 唯一索引在有重复数据时创建被标记 `indisvalid=false`，不生效 | 清理所有重复数据后重建唯一索引 | SQL |
| `gorgias_message_id` 同样存储为 number 类型，查询时 `->` vs `->>` 不一致 | 消息插入时强制 `String(msg.id)`；修复现有数据 | `gorgias-sync-service.ts`, SQL |

### 工具 API Provider 架构

```
src/server/services/tool-providers/
├── types.ts              # 接口定义 (BaseToolProvider, ToolResult, ToolProviderType)
├── mock-data.ts          # Mock 数据生成器 (50+ 订单/物流模板)
├── order-provider.ts     # 订单查询 Provider
├── logistics-provider.ts # 物流查询 Provider
├── refund-provider.ts   # 退款操作 Provider
├── product-provider.ts   # 商品详情 Provider
├── size-chart-provider.ts # 尺码表 Provider
├── factory.ts           # 工厂类 (executeTool, ToolProviderFactory)
└── index.ts             # 统一导出
```

**环境变量配置**：
- `.env` - 模板文件，提交到 git，含占位符值（复制为 `.env` 使用）
- `.env.local` - 本地覆盖，不提交到 git（包含敏感密钥如 `INTERNAL_API_SECRET`）
- `ENABLE_REAL_TOOL_API=true` - 启用真实 API
- `ORDER_API_URL`, `ORDER_API_KEY` - 订单 API
- `LOGISTICS_API_URL`, `LOGISTICS_API_KEY` - 物流 API
- `REFUND_API_URL`, `REFUND_API_KEY` - 退款 API

### UI 风格统一（2026-06-18）

| 页面 | 统一为 |
|------|--------|
| 团队管理 (`/team`) | 对话历史 (`/history`) 风格 |
| 质检管理 (`/quality`) | 对话历史 (`/history`) 风格 |
| 坐席工作台 (`/workspace`) | 对话历史 (`/history`) 风格（Header） |
| 模拟测试 (`/simulation`) | 对话历史 (`/history`) 风格 |

统一内容：Header 固定高度 + 边框分隔、Tab 紧凑胶囊式、筛选区半透明背景 + 边框、搜索框原生 input + focus ring、成员列表卡片化、按钮圆角统一

---

## 知识库架构改进（2026-06-11）

### 已完成

| 改进项 | 说明 |
|--------|------|
| 扩展文件格式 | 从 .xlsx/.xls/.csv 扩展到 +PDF/DOCX/DOC/MD/TXT/JPG/JPEG/PNG/GIF/WebP，最大 20MB |
| 导入去重 | SHA-256 content_hash，导入前查重，重复返回 409 DUPLICATE_CONTENT |
| 引用反馈追踪 | knowledge_items 新增 hit_count + last_hit_at，搜索命中时自动自增（fire-and-forget） |
| 层级分类 | knowledge_items 新增 parent_category，API 返回 categoryTree，前端树状筛选 |

### 新增数据库字段

- `knowledge_items.content_hash` varchar(64) — SHA-256，索引用于去重查询
- `knowledge_items.parent_category` varchar(100) — 父分类，支持层级
- `knowledge_items.hit_count` integer default 0 — 被引用次数
- `knowledge_items.last_hit_at` timestamptz — 最后被引用时间

---

## 知识库功能完善（2026-06-15）

### Item 4：检索权重动态配置

| 能力 | 说明 |
|------|------|
| 动态 min_score | 从 settings 表读取 `knowledge_min_score`，30s TTL 内存缓存 |
| 动态检索条数 | 从 settings 表读取 `knowledge_search_limit`（默认 5） |
| 图片检索限制 | 从 settings 表读取 `knowledge_image_search_limit`（默认 3） |
| 前端配置 UI | 设置页新增「知识检索」子分区，含 3 个滑块 |

**关键文件：**
- `src/server/services/knowledge-search-service.ts` — `getSearchSettings()` 替代硬编码常量
- `src/server/repositories/settings-repository.ts` — 新增 `get(key)` 方法
- `src/components/settings/settings-page.tsx` — 新增知识检索配置 UI

---

### Item 6：知识缺口分析

| 能力 | 说明 |
|------|------|
| 实时缺口检测 | LLM 回复后检测 `sources.length===0` 或 `max(sources[].score)<minScore` 或 `triggeredHandoff`，fire-and-forget |
| 频次聚合 | 同 SHA-256 问题哈希的缺口合并 frequency 字段 |
| 转入学习队列 | 缺口可一键转入 `knowledge_learning_queue`（来源标记 `from_gap`） |
| 忽略/解决 | 标记 dismissed 或 resolved，含操作日志 |
| 统计面板 | 缺口总数、open/in_progress/resolved/dismissed 分布 |

**关键文件：**
- `src/storage/database/shared/schema.ts` — `KnowledgeGapSignal` 类型
- `src/server/repositories/knowledge-gap-repository.ts` — CRUD + `upsertWithFrequencyIncrement`
- `src/server/services/knowledge-gap-service.ts` — `analyzeAndRecord()`、`aggregateGaps()`
- `src/app/api/knowledge/gaps/` — 整组路由（list/stats/scan/[id]/promote/resolve/dismiss）
- `src/server/services/llm-streaming-service.ts` — 流完成后 fire-and-forget 调用
- `src/components/knowledge-learning/knowledge-gap-tab.tsx` — 缺口管理 UI

**已知修复：**
- `knowledge_gap_signals.question_hash` 列宽为 varchar(100)（varchar(64) 无法容纳 `gap_sha256_` 前缀 + hash）

---

### Item 5：Chunk 级版本管理

| 能力 | 说明 |
|------|------|
| 文本切分 | 500 字符段落优先切分 + SHA-256 内容哈希 |
| Chunk Diff | LCS 集合差分，输出 added/modified/removed 三类变更 |
| 版本写入 | `POST /api/knowledge/versions` 时自动计算 diff 并写入 `knowledge_chunks` |
| 版本历史 | `GET /api/knowledge/versions?item_id=X` 返回含 `chunk_diff`（变更明细）和 `chunk_count`（当前 chunk 数） |
| 回滚恢复 | `PATCH /api/knowledge/versions` 回滚时自动重建 chunks（修改 = added + removed，content 恢复） |
| FAQ 页面集成 | 编辑保存时自动调用 `POST /api/knowledge/versions`，显示版本历史和回滚按钮 |

**关键文件：**
- `src/server/services/text-chunker.ts` — `chunkText()`、`diffChunks()`、`summarizeDiff()`
- `src/server/repositories/knowledge-chunk-repository.ts` — chunks CRUD（upsert/markRemoved/getActiveChunks）
- `src/server/repositories/knowledge-repository.ts` — 版本 CRUD，`createVersion` 含 chunk_diff/chunk_count
- `src/server/services/knowledge-service.ts` — `createVersion()`（切分+diff+写入+更新 knowledge_items）
- `src/app/api/knowledge/versions/route.ts` — GET/POST/PATCH 含 chunk_diff 和 chunk_count
- `src/components/faq/faq-page.tsx` — 编辑保存时调用版本 API，显示版本历史面板

**数据库表：**
- `knowledge_chunks(id, knowledge_item_id, chunk_index, content, content_hash, doc_id, version_added, version_removed, created_at)`
- `knowledge_versions` 新增 `chunk_diff jsonb`、`chunk_count integer`

**已知修复（2026-06-15）：**
- `knowledge_versions` 表**无** `category` 列（早期代码误加，已移除）
- `version_number`（非 `version`）是数据库列名，全链路统一
- `findVersionById` 返回类型不含 `category`（与 DB schema 对齐）
- FAQ 页面编辑时传 `item_id`（非 `knowledge_item_id`）

---

## 营销管理增强（2026-07-03）

### Phase 1: 客群定向增强

| 能力 | 说明 |
|------|------|
| 新增 5 个客群维度 | `inactive_days`（沉默天数）/`new_customer_days`（新客天数）/`min_conversations`/`max_conversations`/`exclude_anonymous`，均复用数据库现有字段，无需新建表 |
| 客群预览 API | `POST /api/marketing/preview-segment`，在创建活动前预览符合条件的客户数量 |
| 前端表单结构化 | 替换旧的 JSON 编辑器为分段表单控件（平台/标签/会员等级/沉默天数/新客天数/对话次数范围/排除匿名），所有字段独立输入 |

**关键文件：**
- `src/server/repositories/marketing-repository.ts` — `findCustomersBySegment()` 扩展支持 5 个新维度
- `src/app/api/marketing/preview-segment/route.ts` — 新建，POST 预览客群人数
- `src/components/marketing/marketing-page.tsx` — 表单重构，创建/编辑 Dialog 全部字段

**数据库变更：** `marketing_campaigns` 新增 `message_template`/`trigger_type`/`scheduled_at`/`trigger_config` 列。

### Phase 2: 活动编辑支持

| 能力 | 说明 |
|------|------|
| 完整字段编辑 | `update()` 方法支持更新全部字段（名称/类型/目标客群/Bot/状态/变体/消息模板/触发配置），不限于 status |
| 前端编辑按钮 | 每个 campaign 卡片增加"编辑"按钮，点击后弹窗填充现有数据，支持保存修改 |

**关键文件：**
- `src/server/repositories/marketing-repository.ts` — `UpdateCampaignInput` + `update()` 覆盖全部字段
- `src/server/services/marketing-service.ts` — `updateCampaign()` 允许任意字段更新
- `src/app/api/marketing/route.ts` — PATCH handler 接收所有字段

### Phase 3: 消息模板变量插值

| 能力 | 说明 |
|------|------|
| 模板引擎 | `MarketingService.renderTemplate()` 支持 `{{customer_name}}`/`{{campaign_name}}` 变量替换 |
| 6 种活动类型默认模板 | abandoned_cart/browsing_nurture/win_back/promotion/announcement/loyalty 各有默认消息文案 |
| 自定义模板 | 创建/编辑活动时可自定义 message_template，覆盖默认值 |

### Phase 4: 效果分析图表

| 能力 | 说明 |
|------|------|
| 统计方法 | `getDailyStats()`（日趋势）/`getVariantStats()`（A/B 变体对比）/`getStatsByType()`（类型分布）/`getTopCampaigns()`（TOP 排行） |
| Analytics API | `GET /api/marketing/analytics`，支持 `?days=7/30/90` 时间范围过滤，返回 overall + trend + by_type + variant_comparison + top_campaigns |
| 前端图表 | recharts 实现：核心指标卡 / 触达趋势折线图 / 类型分布柱状图 / 变体对比表格 / TOP 活动排行 |

**关键文件：**
- `src/server/repositories/marketing-repository.ts` — 4 个新统计方法
- `src/server/services/marketing-service.ts` — `getAnalytics()` 方法
- `src/app/api/marketing/analytics/route.ts` — 新建，GET handler

### Phase 5: A/B 测试自动化

| 能力 | 说明 |
|------|------|
| 获胜判定 | `determineABWinner()`，最小样本 30，显著性阈值 5%，返回 winner/confidence/reason |
| 推广获胜变体 | `promoteVariant()`，禁用 A/B，将获胜内容升级为 message_template |
| 前端入口 | campaign 卡片展示 winner 徽章，"推广获胜变体"按钮调用 `POST /api/marketing/ab-winner` |

**关键文件：**
- `src/server/services/marketing-service.ts` — `determineABWinner()` + `promoteVariant()`
- `src/app/api/marketing/ab-winner/route.ts` — 新建，POST determine/promote

### Phase 6: 定时投放

| 能力 | 说明 |
|------|------|
| 触发类型 | `trigger_type`：`manual`（立即）/`scheduled`（定时）/`event`（事件驱动） |
| 定时器 | `processScheduledCampaigns()` 查询 `status='scheduled' AND scheduled_at <= NOW()`，批量执行 |
| 前端配置 | 创建/编辑活动时可选触发类型（立即投放/定时投放），定时投放显示 datetime-local 输入框 |

**已知待接入：** `processScheduledCampaigns()` 的调用入口（启动时？定时任务？API 触发？）

✅ 已接入：可通过 `/api/admin/scheduler/run?tasks=scheduled_campaigns` 外部 Cron 触发。

---

### 后台调度服务（2026-06-30）

| 能力 | 说明 | 文件 |
|------|------|------|
| BackgroundSchedulerService | 封装 4 类后台任务的统一调度服务 | `src/server/services/background-scheduler-service.ts` |
| 定时 SLA 检查 | 每 5 分钟扫描超时应答/处理的工单并告警 | `/api/admin/scheduler/run?tasks=sla_check` |
| 未指派工单告警 | 扫描创建超过阈值未指派的工单 | `/api/admin/scheduler/run?tasks=unassigned_check` |
| 超时会话提醒 | 扫描最后一条消息来自用户且超时的活跃会话（1小时去重） | `/api/admin/scheduler/run?tasks=unhandled_check` |
| 定时营销投放 | 执行已到期的定时营销活动 | `/api/admin/scheduler/run?tasks=scheduled_campaigns` |
| 外部 Cron 触发 | 外部定时器（如 crontab / Coze 平台定时）调用 API 触发调度 | — |

---

---

## 未完成功能与待接入逻辑

本章节记录已开发但尚未完全接入业务逻辑的功能，供后续迭代参考。

### 系统设置（settings 表）

前端设置页提供了以下配置项，数据可正常保存到数据库，但部分项尚未被后端业务代码读取使用：

#### 1. 已接入后端（生效）

| 设置项 key | 用途 | 接入位置 |
|-----------|------|---------|
| `ai_model` | AI 对话模型 | `messages/route.ts` → `llmStreamingService.createStream` |
| `multimodal_model` | 多模态图片理解模型 | `messages/route.ts` → `llmStreamingService.createStream` |
| `multimodal_enabled` | 是否启用多模态 | `messages/route.ts` → `llmStreamingService.createStream` |
| `multimodal_disabled_action` | 多模态关闭时的处理策略（固定话术/转人工） | `messages/route.ts` → `llmStreamingService.createStream` |
| `multimodal_fixed_message` | 多模态关闭时的固定回复话术 | `messages/route.ts` → `llmStreamingService.createStream` |
| `system_prompt` | 自定义系统提示词 | `messages/route.ts` → `llmStreamingService.buildLLMMessages`（2026-06-10 修复） |
| `ai_temperature` | AI 温度参数 | `messages/route.ts` → `llmStreamingService`（2026-06-10 修复） |
| `ai_max_tokens` | AI 最大 Token 数 | `messages/route.ts` → `llmStreamingService`（2026-06-10 修复） |
| `ai_max_concurrent` | AI 最大并发对话数 | `messages/route.ts` → 检查 active 状态对话数，达上限后拒绝新对话（0=不限） |
| `alert_confidence_threshold` | 低置信度告警阈值 | `alert-service.ts` → `getAlertSettings()` 动态读取 |
| `alert_confidence_critical_threshold` | 低置信度严重告警阈值 | `alert-service.ts` → `getAlertSettings()` 动态读取 |
| `alert_high_rounds_threshold` | 高轮次告警阈值 | `alert-service.ts` → `getAlertSettings()` 动态读取 |
| `alert_high_rounds_critical_threshold` | 高轮次严重告警阈值 | `alert-service.ts` → `getAlertSettings()` 动态读取 |
| `alert_auto_handoff_rounds` | 自动转人工最小轮次 | `alert-service.ts` → `getAlertSettings()` 动态读取 |

#### 2. 前端 Only（无需后端读取）

| 设置项 key | 用途 | 说明 |
|-----------|------|------|
| `theme` | 界面主题（system/light/dark） | 前端 React Context / CSS 变量控制 |
| `font_size` | 字号大小 | 前端样式控制 |
| `show_timestamps` | 消息时间戳显示 | 前端组件控制 |
| `compact_mode` | 紧凑模式 | 前端组件控制 |

#### 3. 待接入业务逻辑

| 设置项 key | 预期行为 | 待实现位置 |
|-----------|---------|-----------|
| `welcome_message` | 新会话开场白 | 应在 `conversations/route.ts` 创建会话时读取并写入 messages |
| `session_timeout` | 会话超时时间（分钟） | 应在 `messages/route.ts` 检测用户最后活跃时间，超时则结束会话 |
| `max_turns` | 最大对话轮次 | 应在 `messages/route.ts` 检测 `message_count`，达到上限后拒绝继续 |
| `rating_enabled` | 允许用户评价 | 应在 `conversations/[id]/rating/route.ts` 读取设置后决定是否展示评价入口 |
| `new_conversation_notify` | 新对话时通知坐席 | 应在 `conversations/route.ts` 创建会话后调用通知服务 |
| `unhandled_remind` | 未处理会话超时提醒 | 应有定时任务扫描超长未回复会话并产生告警 |

### Demo 模式 vs 真实模式

项目通过 `isDemoMode()` 判断是否配置了 Supabase：

```typescript
// 判断逻辑（supabase-client.ts）
function isDemoMode(): boolean {
  return !process.env.COZE_SUPABASE_URL || !process.env.COZE_SUPABASE_ANON_KEY;
}
```

- **Demo 模式**：返回静态假数据，CRUD 操作不持久化（适合 UI 展示）
- **真实模式**：所有 CRUD 操作真实写入 Supabase 数据库

当前 Coze 平台已自动注入 `COZE_SUPABASE_URL`、`COZE_SUPABASE_ANON_KEY`、`COZE_SUPABASE_SERVICE_ROLE_KEY`，项目运行在真实模式下。

### Coze 平台 Supabase 配置详解

#### 连接方式

**Supabase REST API（应用层使用）**

| 变量 | 值 |
|------|-----|
| `COZE_SUPABASE_URL` | `https://br-alive-kea-4152cf8a.supabase2.aidap-global.cn-beijing.volces.com` |
| `COZE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...` |
| `COZE_SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIs...` |

**PostgreSQL 直连（迁移/运维）**

| 参数 | 值 |
|------|-----|
| 主机 | `cp-pure-gust-6827df3b.pg2.aidap-global.cn-beijing.volces.com` |
| 端口 | `5432` |
| 数据库 | `postgres` |
| 用户名 | `postgres` |
| 密码 | `tLk6MwE1qBEt55E57n` |

#### 数据库管理命令

```bash
# 查看数据库状态
node scripts/db-admin.js status

# 执行数据库迁移
node scripts/db-admin.js migrate

# 初始化默认数据
node scripts/db-admin.js init
```

详细配置说明见 `COZE_PLATFORM_CONFIG.md`。

### 数据持久化验证（2026-06-10）

| 模块 | CREATE | READ | UPDATE | DELETE | 备注 |
|------|--------|------|--------|--------|------|
| 用户管理 | ✓ | ✓ | ✓ | ✓ | 真实 UUID |
| 话术库 | ✓ | ✓ | ✓ | ✓ | |
| 系统设置 | ✓ | ✓ | ✓ | - | |
| 营销活动 | ✓ | ✓ | ✓ | ✓ | |
| 推送模板 | ✓ | ✓ | ✓ | ✓ | |
| 对话标签 | ✓ | ✓ | ✓ | ✓ | |
| 客户标签 | ✓ | ✓ | ✓ | ✓ | |
| 技能组 | ✓ | ✓ | ✓ | ✓ | |
| 路由规则 | ✓ | ✓ | ✓ | ✓ | |
| Bot 配置 | ✓ | ✓ | ✓ | ✓ | |
| 工单 | ✓ | ✓ | ✓ | ✓ | |
| 客户 | ✓ | ✓ | ✓ | ✓ | |
| 告警 | ✓ | ✓ | ✓ | ✓ | |
| 知识库 | ✓ | ✓ | ✓ | ✓ | |

### 假数据与摆设清单（2026-06-10）

以下排查在**真实模式**（Supabase 已连接）下进行。分为六类：

#### 一、数据全假（硬编码 Mock，无论真实/Demo 模式均不查数据库）

| 页面 | 功能 | 摆设位置 | 说明 |
|------|------|---------|------|
| 智能对话 | 查订单工具 (`/api/tools/order-query`) | `route.ts` 顶部的 `MOCK_ORDERS` | 只有 3 条硬编码订单 (ORD-2024001~003)，不查数据库。Mock工具置信度已封顶0.6（含结果有效性校验降分） |
| 智能对话 | 查物流工具 (`/api/tools/logistics-query`) | `route.ts` 顶部的 `MOCK_LOGISTICS` | 只有 2 条硬编码物流数据，不查数据库。Mock工具置信度已封顶0.6 |
| 智能对话 | 退款操作工具 (`/api/tools/refund-action`) | `route.ts` 整体 | 不做任何真实退款，始终返回"确认退款"按钮卡片。Mock工具置信度已封顶0.55 |

> **影响范围**：LLM Function Calling 调用这三个工具时，返回的全是假数据。用户看到"订单卡片"和"物流进度"都是写死的。

#### 二、CRUD 可用但业务逻辑未接入（数据存入数据库，但未被业务代码消费）

| 功能 | 页面 | 问题 | 状态 |
|------|------|------|------|
| 质检规则 | `/quality` | ~~CRUD 写入 `quality_rules` 表，但无自动执行引擎~~ | ✅ 已修复：LLM 回复后自动触发 `QualityService.runQualityCheck`，扫描 negative_sentiment / keyword_violation 规则，结果写入 `quality_checks` 表 |
| 路由规则 | `/settings` | ~~CRUD 写入 `routing_rules` 表，但消息处理时未读取路由规则~~ | ✅ 已修复：`messages/route.ts` 中 `RoutingService.matchRule` 按 keyword/default 条件匹配，命中时使用目标 Bot 的 system_prompt |
| 子Agent 委派 | `/settings` | ~~子Agent CRUD + 委派 API 均可用，但 LLM 流程中未自动委派~~ | ✅ 已修复：`messages/route.ts` 中主动意图识别自动委派 + `generateSubAgentResponse` 真正调用 LLM |
| 系统设置 `welcome_message` | `/settings` | ~~保存到数据库，但创建新会话时不读取~~ | ✅ 已修复：`conversations/route.ts` POST 创建会话时读取并写入首条消息 |
| 系统设置 `session_timeout` | `/settings` | ~~保存到数据库，但无超时检测逻辑~~ | ✅ 已修复：`messages/route.ts` 发送消息前检查 `updated_at`，超时自动结束会话 |
| 系统设置 `max_turns` | `/settings` | ~~保存到数据库，但无轮次限制逻辑~~ | ✅ 已修复：`messages/route.ts` 发送消息前检查 `message_count`，达上限自动结束会话 |
| 系统设置 `rating_enabled` | `/settings` | ~~保存到数据库，但评价入口始终显示~~ | ✅ 已修复：`rating/route.ts` 读取设置，`rating_enabled=false` 时返回 403 |
| 系统设置 `new_conversation_notify` | `/settings` | ~~保存到数据库，但无通知逻辑~~ | ✅ 已修复：`conversations/route.ts` 创建会话后向 `alerts` 表插入通知型告警 |
| 系统设置 `unhandled_remind` | `/settings` | ~~保存到数据库，但无定时提醒~~ | ✅ 已修复：`messages/route.ts` 每次消息时检查超时会话（1小时去重）；`BackgroundSchedulerService.runUnhandledReminder()` 支持外部 Cron 触发 |
| 排班管理 | `/workspace` | ~~CRUD 写入 `schedules` 表，但坐席分配时不参考排班~~ | ✅ 已修复：转人工时 `AgentService.autoAssign` 按排班+技能组优先匹配坐席 |
| 营销活动触达 | `/marketing` | ~~活动 CRUD + 统计可用，但不会主动触达客户~~ | ✅ 已修复 Phase 1-6：executeCampaign 匹配客群投放、新增客群维度（活跃天数/新客天数/对话次数范围/排除匿名）、消息模板变量插值、定时投放（scheduled_at/processScheduledCampaigns）、A/B 变体 + 获胜判定 + 推广、效果分析（趋势/类型/变体对比）、客群预览 API |
| 子Agent 自动委派 | `/settings` | ~~子Agent CRUD + 委派 API 可用，但 LLM 流程中未自动委派~~ | ✅ 已修复：`messages/route.ts` 中主动意图识别（`detectIntentAndRoute`，confidence≥0.5）自动委派；`generateSubAgentResponse` 改为真正调用 LLM |

#### 三、异常时静默降级为假数据（✅ 已全部修复）

**修复方案**：`analytics-repository.ts` 所有 catch 块改为返回空数据（零值/空数组），不再返回假数据。

| 功能 | 摆设位置 | 修复前降级行为 | 修复后 |
|------|---------|---------|------|
| Dashboard 核心指标 | `getCoreMetrics` | 返回 `DEMO_METRICS`（127对话/892消息/8活跃/4.5评分） | 返回全零指标 |
| Dashboard 来源分布 | `getSourceDistribution` | 返回 `{web:89, qianniu:28, doudian:10}` | 返回 `{}` |
| Dashboard 告警统计 | `getAlertStats` | 返回 `{total:15, unresolved:2, critical:1}` | 返回全零统计 |
| Dashboard 最近告警 | `getRecentAlerts` | 返回 `DEMO_ALERTS`（2条假告警） | 返回 `[]` |
| Dashboard 满意度趋势 | `getRatingsWithDate` | 返回 7 天固定评分 [4,5,5,4,5,4,5] | 返回 `[]` |
| Dashboard 来源满意度 | `getRatingsBySource` | 返回 `{web:4.6, qianniu:4.3, doudian:4.8}` | 返回 `[]` |
| Dashboard 自动回复命中率 | `getAutoReplyHits` | 返回 `156` | 返回 `0`（原本就是） |
| Dashboard 转人工数 | `analytics-repository.ts` `getHandoffCount` | 返回 `12` | 同上 |

> **核心风险**：Dashboard 的 catch 块静默返回假数据，前端和用户均无法区分"数据为零"和"数据库查询出错"。建议改为：出错时返回空数据或在前端显示"数据加载异常"提示。

#### 四、前端硬编码 Fallback（API 加载失败时的默认值，真实模式下优先查数据库）

| 组件 | 变量名 | 内容 | 说明 |
|------|--------|------|------|
| `chat-window.tsx` | `DEFAULT_TRANSFER_DEPARTMENTS` | 5个部门（售前/售后/投诉/VIP/技术支持） | 转接部门默认值，API 加载失败时使用 |
| `chat-window.tsx` | `DEFAULT_TRANSFER_AGENTS` | 4个坐席（张晓明/李婷/王伟/赵敏） | 转接坐席默认值，API 加载失败时使用 |
| `chat-window.tsx` | `DEFAULT_QUICK_REPLIES` | 6条快捷回复 | 聊天输入框快捷回复，API 加载失败时使用 |

> **设计说明**：前端组件从 API 动态加载配置（真实模式读取数据库），加载失败时才使用硬编码默认值。这是合理的降级策略。

#### 五、Demo 模式内存数据（仅 `isDemoMode()` 为 true 时生效）

> **重要**：当前 Coze 平台已注入 Supabase 环境变量，项目运行在**真实模式**，以下数据不生效。此处仅作记录。

| Repository | 变量名 | 数据量 | 说明 |
|------------|--------|--------|------|
| `analytics-repository.ts` | `DEMO_METRICS` | 1条 | Dashboard 核心指标（127对话/892消息/4.5评分） |
| `analytics-repository.ts` | `DEMO_ALERTS` | 2条 | Dashboard 最近告警 |
| `analytics-repository.ts` | `DEMO_SOURCE_DISTRIBUTION` | 1条 | 来源分布 `{web:89, qianniu:28, doudian:10}` |
| `analytics-repository.ts` | `DEMO_HANDOVER_COUNT` | 1条 | 转人工数 `12` |
| `conversation-repository.ts` | `DEMO_CONVERSATIONS` | 4条 | 对话列表假数据 |
| `conversation-repository.ts` | `DEMO_MESSAGES` | 多条 | 消息假数据 |
| `auto-reply-repository.ts` | `DEMO_AUTO_REPLY_RULES` | 4条 | 自动回复规则 |
| `bot-config-repository.ts` | `DEMO_SUB_AGENTS` | 3条 | 子Agent配置 |
| `conversation-tag-repository.ts` | `DEMO_TAGS` | 5条 | 对话标签 |
| `marketing-repository.ts` | `DEMO_CAMPAIGNS` | 3条 | 营销活动 |
| `push-repository.ts` | `DEMO_PUSH_TEMPLATES` | 2条 | 推送模板 |
| `push-repository.ts` | `DEMO_EVENT_LOGS` | 空数组 | 推送事件日志 |
| `push-repository.ts` | `DEMO_WEBHOOK_SECRET` | 动态生成 | Webhook 密钥 |
| `quality-repository.ts` | `DEMO_QUALITY_RULES` | 3条 | 质检规则 |
| `settings-repository.ts` | `DEMO_SETTINGS` | 多条 | 系统设置默认值 |
| `sub-agent-repository.ts` | `DEMO_DELEGATIONS` | 2条 | 子Agent委派记录 |
| `sub-agent-repository.ts` | `DEMO_COLLABORATIONS` | 2条 | 子Agent协作记录 |
| `customer-repository.ts` | `demoCustomers` | 5条 | 客户假数据 |
| `knowledge-repository.ts` | `demoItems` | 多条 | 知识库条目 |
| `alert-repository.ts` | `demoAlerts` | 3条 | 告警假数据 |
| `agent-repository.ts` | `demoQueue` | 2条 | 坐席排队列表 |

#### 六、已确认完全可用的功能

| 功能 | 页面 | 说明 |
|------|------|------|
| 对话监控 | `/` | 实时查看平台对话+接管+转人工+转工单+发消息+内部备注（原"智能对话"已改为监控视图，测试统一走`/simulation`） |
| 消息发送（SSE 流式） | `/` | 含知识库检索 + 自动回复匹配 + Function Calling + 置信度评分 |
| 满意度评价 | `/` | 写入 conversations.rating |
| 转人工 | `/` | 写入 agent_queue + conversations.status=handoff |
| 内部备注 | `/workspace` | 写入 messages，支持 @提及 |
| 协同参与者 | `/workspace` | 读写 conversations.participant_ids |
| 知识库 CRUD + 搜索 | `/faq` | 含版本历史、回滚、导入 |
| 知识自学习 | `/faq` (Tab页) | 扫描对话提取候选QA，审批后入知识库 |
| 工单管理 | `/tickets` | CRUD + 评论 + 状态流转 + 从对话创建 |
| 客户管理 | `/customers` | CRUD + 标签 + 关联对话 |
| 告警管理 | Dashboard | CRUD + 标记已处理 |
| 导出 | `/history` | 对话记录/统计报表 CSV 导出 |
| 用户管理 | `/team` | CRUD + 角色分配 |
| 权限配置 | `/team` | 批量更新权限矩阵 |
| 话术库 | `/workspace` | CRUD + 分类 + 使用次数 |
| 技能组 | `/settings` | CRUD |
| 对话标签 | `/quality` | CRUD + 打标/取消 |
| 客户标签 | `/customers` | CRUD |
| 营销活动 | `/marketing` | CRUD + 统计 + 主动触达投放 + 客群预览 + 消息模板变量插值 + 定时投放 + A/B 获胜判定与推广 + 效果分析图表 |
| 推送模板 + Webhook | `/settings` | CRUD + Webhook事件处理 |
| Bot 配置 | `/settings` | CRUD |
| 子Agent | `/settings` | CRUD + 委派/协作 + **自动意图识别委派** |
| 路由规则 CRUD | `/settings` | 创建/编辑/删除 + **消息处理时自动匹配分发** |
| 排班 CRUD | `/workspace` | 创建/删除 + **坐席分配时优先匹配** |
| 坐席工作台 | `/workspace` | 状态切换 + 排队列表 + 接单 + 转接 + 绩效 |
| 系统设置（AI 相关） | `/settings` | ai_model/multimodal_*/system_prompt/ai_temperature/ai_max_tokens 已接入 |
| 系统设置（对话控制） | `/settings` | welcome_message/session_timeout/max_turns/rating_enabled/new_conversation_notify/unhandled_remind 已接入 |
| 质检自动执行 | `/quality` | LLM 回复后自动扫描规则，结果写入 quality_checks |
| 图片上传（多模态） | `/` | 上传 → 视觉LLM识别
| 知识库图片回复 | `/` | 知识库搜索匹配带image_url条目 → LLM引用[IMG:url](alt) → 后端提取 → 前端渲染图片消息
| AI引用溯源面板 | `/simulation` | 右侧面板展示知识库原文片段、相关度、名称/分类；点击AI消息自动切换；流式完成自动展示 |
| 话术库动态化 | `/` | ChatWindow 组件从 `/api/quick-replies` 动态加载话术，支持 `scope` 参数过滤（ai/agent/global） |
| 商品详情管理 | `/faq` | 知识库新增「商品详情」Tab，支持商品 CRUD + 分类/状态筛选 + 批量操作 + 向量化存储 |
| 商品检索 | `/` | AI 对话时自动检索商品详情（向量+关键词双通道），返回商品上下文 |
| 商品查询工具 | `/` | LLM Function Call `query_product_detail`，命中后触发商品 Provider 查询数据库，返回商品信息 |

---


## 店铺管理（2026-07-01）

### 概述

在设置页新增「店铺管理」分区，支持三步向导创建 AI 客服店铺，每个店铺关联知识库、配置业务规则（包邮策略/快递/发货时间等）、托管多个客服账号。

### 数据库表

| 表名 | 说明 |
|------|------|
| `shops` | 店铺主表（含 `knowledge_ids jsonb`、`config jsonb`、`agent_quota integer` 扩展字段） |
| `shop_agent_accounts` | 客服托管账号（店铺ID、账号名、AES-256加密密码、平台、状态） |

### Config 字段结构（`config jsonb`）

| Key | 类型 | 说明 |
|-----|------|------|
| `shipping_policy` | string | 包邮策略：`all_free`/`threshold_free`/`no_free`/`remote_no_free`/`by_product` |
| `allow_designated_express` | boolean | 是否允许指定快递 |
| `designated_express` | string | 指定快递名称（可选） |
| `shipping_time` | string | 发货时间：`24h`/`48h`/`72h`/`3-5d`/`5-7d`/`custom` |
| `shipping_origin` | string | 发货地 |
| `return_policy_7days` | boolean | 是否支持7天退换 |
| `handoff_timeout_hours` | number | 超时转人工小时数 |
| `default_reply_ids` | string[] | 默认回复话术ID数组 |
| `handoff_reply_ids` | string[] | 转人工话术ID数组 |
| `work_hours` | `{start, end}` | 工作时间 |

### 三步向导

| Step | 内容 | 关键状态 |
|------|------|---------|
| Step 1 | 知识库选择（多选搜索卡片网格） | `knowledgeIds[]` |
| Step 2 | 7项业务规则配置（Radio/Input） | `config{}` |
| Step 3 | 坐席额度 + 托管账号 + 话术选择 + 工作时间 | `quota`、`agentAccounts[]` |

### 关键架构决策

1. **Config 默认值**：创建时由 `shop-service.ts` 填充默认值（`shipping_policy: 'threshold_free'` 等）
2. **密码加密**：Service 层调用 `encrypt(plainPassword)` 一次，Repository 层直接存储密文（无双重加密）
3. **话术去重**：`Promise.all` 并发加载 `ai`/`agent` 范围话术，用 `Map` 去重合并
4. **Agent 账号验证**：提交时过滤无效账号（`filter(a => a.account_name.trim() && a.password.trim())`）
5. **账号配额**：`agent_quota - usedAccounts` 计算剩余可用额度
6. **统计聚合**：`shops-repository.ts getStats()` 并行查询店铺数/总账号数/已用账号数

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/server/repositories/types.ts` | `ShopRow`/`ShopAgentAccountRow` 类型定义（含新字段） |
| `src/server/repositories/shops-repository.ts` | CRUD（含 `knowledge_ids`/`config`/`agent_quota`）+ `getStats()` |
| `src/server/repositories/shop-agent-accounts-repository.ts` | 客服账号 CRUD（`listByShopId`/`create`/`delete`） |
| `src/server/services/shop-service.ts` | Config 默认值填充 + 字段校验 |
| `src/server/services/shop-agent-accounts-service.ts` | 密码 AES-256 加密 + 运行时剥离密文字段 |
| `src/app/api/shops/route.ts` | GET(stats)/POST(创建店铺+关联账号) |
| `src/app/api/shops/[id]/route.ts` | GET/PATCH/DELETE（含新字段） |
| `src/app/api/shops/[id]/agent-accounts/route.ts` | GET/POST/DELETE 客服账号 |
| `src/components/settings/shop-create-wizard.tsx` | 三步向导组件（知识选择/规则配置/客服信息） |
| `src/components/settings/settings-page.tsx` | 店铺管理分区（统计卡片/列表/内联编辑/调用向导） |

### API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/shops | 店铺列表（`stats=true` 返回聚合统计） |
| POST | /api/shops | 创建店铺（含 `knowledge_ids`/`config`/`agent_quota`/`agentAccounts[]`） |
| GET | /api/shops/[id] | 店铺详情 |
| PATCH | /api/shops/[id] | 更新店铺（含新字段） |
| DELETE | /api/shops/[id] | 删除店铺（级联删除账号） |
| GET | /api/shops/[id]/agent-accounts | 客服账号列表 |
| POST | /api/shops/[id]/agent-accounts | 创建客服账号 |
| DELETE | /api/shops/[id]/agent-accounts?id=xxx | 删除客服账号 |

### 代码审查修复（2026-07-01）

| 问题 | 修复方案 |
|------|---------|
| B1: 空状态按钮无响应 | `setShowAddShop` → `setShowShopWizard` |
| B2: 死代码残留 | 移除 `showAddShop`/`handleAddShop`/`newShop` |
| B3: 坐席额度无法设置 | 添加 `quota` state + 数字输入框 + `shopStats` props |
| B4: 编辑无法更新新字段 | `update()` 添加 `knowledge_ids`/`config`/`agent_quota` 分支 |
| B5: PATCH API 缺字段 | body 类型扩展 |
| L2: Step3 可跳过验证 | `handleSubmit` 添加 `validAccounts` 过滤 + 错误提示 |
| L3: 错误静默吞掉 | `.catch` 改为 `setError` 展示 |
| L4: 话术重复加载 | `Promise.all` + `Map` 去重 |
| U2: 知识库 API 错误 | `/api/knowledge?query=` → `/api/knowledge/items?search=` |
| U3: Dialog 关闭不重置 | `onClose` 添加 `resetForm()` |
| U4: 编辑缺 config 字段 | 添加发货地/发货时间/超时转人工编辑 |
| U5: 列表不展示 config | 添加发货地/包邮策略标签 |

---

## 代码质量改进（2026-06-22）

### 安全修复

| 问题 | 修复方案 | 文件 |
|------|---------|------|
| 环境变量缺失处理 | `ENCRYPTION_KEY` 缺失时优雅降级，返回错误码而非抛异常 | `crypto.ts` |
| 模拟测试越权漏洞 | GET /api/simulations/[id] 无权限校验，任意用户可查看他人会话 | `simulations/[id]/route.ts` |
| 模拟测试历史数据边界 | created_by=null 的历史数据权限判断不严谨 | `simulations/[id]/route.ts` |

### 模拟测试私有化（2026-06-22）

| 能力 | 说明 |
|------|------|
| 按用户隔离 | 普通用户只能看到/操作自己创建的会话 |
| Admin 全权限 | 管理员可查看/删除所有会话 |
| 历史数据保护 | created_by=null 的旧数据仅管理员可访问 |
| 数据库变更 | `simulation_conversations` 表添加 `created_by` 列 |

### 结构化日志

| 文件 | 说明 |
|------|------|
| `src/lib/logger.ts` | 结构化日志工具，支持分级（debug/info/warn/error）+ 敏感数据脱敏 |
| `src/lib/constants.ts` | 魔法数字常量提取（速率限制、TTL、超时等） |

**已迁移到日志工具的模块（2026-06-22 第二轮）：**
- `src/lib/api-utils.ts`
- `src/lib/auth/jwt.ts`
- `src/lib/auth/login-security.ts`
- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/messages/route.ts`
- `src/app/api/platforms/qianniu/webhook/route.ts`
- `src/app/api/platforms/doudian/webhook/route.ts`
- `src/server/services/llm-streaming-service.ts`
- `src/server/services/conversation-service.ts`
- `src/server/services/customer-service.ts`
- `src/server/services/agent-service.ts`
- `src/server/services/knowledge-gap-service.ts`

### 测试基础设施

| 文件 | 说明 |
|------|------|
| `vitest.config.ts` | Vitest 测试配置 |
| `src/lib/logger.test.ts` | 日志工具测试 (13 tests) |
| `src/lib/crypto.test.ts` | 加密工具测试 (12 tests) |
| `src/lib/constants.test.ts` | 常量测试 (6 tests) |
| `src/lib/auth/jwt.test.ts` | JWT 认证测试 (8 tests) |

**运行测试：**
```bash
pnpm test        # 监听模式
pnpm test:run   # 单次运行
```

### 待改进项

| 优先级 | 问题 | 说明 |
|--------|------|------|
| 中 | 逐步迁移 console → logger | 剩余约 214 处 console 尚未迁移（从 249 降至 214） |
| 低 | 结构化日志输出格式 | 当前 JSON 模式，可扩展增加日志收集器集成 |

### 代码质量改进（2026-07-01）- Phase 1-4 恢复执行

本轮在沙箱环境上下文中断后恢复执行，重建了 Phase 1-4 的全部改动。

#### P0 安全与类型

| 改动 | 说明 | 文件 |
|------|------|------|
| 消除 `as any` 类型断言 | 定义 TicketWithRelations/UpgradeSocket/AgentQueueItemWithPriority 接口替代 8 处 as any | `ticket-service.ts`, `server.ts`, `types.ts` |

#### P1 输入校验与流水线对齐

| 改动 | 说明 | 文件 |
|------|------|------|
| 消息长度校验 | MAX_MESSAGE_LENGTH=10000 硬上限，返回 `MESSAGE_TOO_LONG` 错误码 | `messages/route.ts` |
| 上传文件魔数校验 | JPEG/PNG/GIF/WebP Magic Bytes 验证，防止多态文件上传 | `upload/route.ts` |

#### P2 代码去重与常量收敛

| 改动 | 说明 | 文件 |
|------|------|------|
| chat-utils.ts 新建 | 统一 `formatMessageTime` / `shouldShowTimeDivider`，消除 chat-window.tsx 和 conversation-detail.tsx 重复定义 | `chat-window.tsx`, `conversation-detail.tsx` |
| constants.ts 新建 | 收敛魔法数字：RATE_LIMIT / AUTH / HTTP / SSE / DEMO_ARRAY_MAX_SIZE / KNOWLEDGE_SEARCH_LIMIT | 全项目 14 处导入 |

#### P3 AuthContext 清理

| 改动 | 说明 | 文件 |
|------|------|------|
| 移除 `authFetch` | 零引用遗留字段，从 AuthContextValue 接口和 Provider 中移除 | `auth.tsx`, `app-layout.tsx` |
| 移除 `useHasRole` | 零引用导出 hook，从 auth.tsx 移除，清理 app-layout.tsx 导入 | `auth.tsx`, `app-layout.tsx` |

#### constants.ts 当前导出

```typescript
export const RATE_LIMIT = { MESSAGE_MAX_PER_MINUTE, KNOWLEDGE_IMPORT_MAX_PER_MINUTE, UPLOAD_MAX_PER_MINUTE, WINDOW_MS }
export const AUTH = { LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MINUTES, PASSWORD_BCRYPT_ROUNDS, LOGIN_MAX_LOG_EVENTS }
export const HTTP = { KNOWLEDGE_MIN_SCORE, MAX_MESSAGE_LENGTH, MAX_UPLOAD_SIZE_BYTES, JWT_COOKIE_NAME, JWT_EXPIRES_IN }
export const SSE = { STREAM_TIMEOUT_MS, TIME_DIVIDER_GAP_MS }
export const DEMO_ARRAY_MAX_SIZE = 200
export const KNOWLEDGE_SEARCH_LIMIT = 5
export const KNOWLEDGE_IMAGE_SEARCH_LIMIT = 3
```

### 磁盘空间管理

- `.next/` 目录（Turbopack 缓存）会随 ts-check/build 快速增长，磁盘紧张时手动 `rm -rf .next/`

---

## 会话列表懒加载（2026-07-04）

### 概述

对话监控、模拟测试、坐席工作台三个会话列表均实现懒加载，初始加载 10 条，滚动/点击加载更多。

### 公共 Hook

| 文件 | 说明 |
|------|------|
| `src/hooks/use-lazy-list.ts` | 通用懒加载 Hook，支持分页/轮询/手动刷新/局部更新 |

`useLazyList` 返回：`items / total / hasMore / isInitialLoading / isLoadingMore / isPolling / error / loadInitial / loadMore / reset / refresh / updateItems / setTotal / startPolling / cleanup`

设计要点：
- **fetchFn 用 ref 持有**：所有内部方法通过 `fetchFnRef.current` 调用，fetchFn 不稳定不影响回调链
- **无 hasAutoLoadedRef guard**：已证明会导致 reset() 后 loadInitial 短路，移除后 loadInitial 始终可执行
- **itemsLengthRef**：追踪已加载数量，refresh 时 `Math.max(itemsLengthRef.current, pageSize)` 作为 limit，不丢失已展开数据
- **currentPageRef**：避免 loadMore 闭包过期

### 对话监控（MonitorPage）

- 后端已支持 `page` + `limit`，响应含 `statusCounts` 字段
- `ConversationRepository.getStatusCounts()`：Supabase `GROUP BY status` 聚合统计
- StatsBar 改为读取后端 `statusCounts`，不再从已加载列表本地 filter
- 搜索/筛选改为后端参数（`GET /api/conversations?search=&status=`）
- filter/search 参数通过 ref 传递，避免 `setActiveFilter` 异步竞态
- 轮询使用 Hook 的 `startPolling(5000)`，refresh 时用 `limit=已加载数量` 替换当前列表
- useEffect 用 ref 持有回调，deps=[] 防止跳顶
- ConversationMonitorList 移除前端双重筛选，信任后端已筛选结果
- IntersectionObserver 滚动加载 + 底部加载指示器

### 模拟测试（SimulationPage）

- `GET /api/simulations` 支持 `page` + `limit` 参数，返回 `total`
- `SimulationRepository` 新增 `count()` 方法
- `fetchFn` 用 `useCallback([], [])` 包裹（不传 userId，admin 可见全部）
- 删除对话后调用 `updateItems(prev => prev.filter(...))` + `setTotal(n => Math.max(0, n - 1))`
- 新建对话后 `updateItems(prev => [data.conversation, ...prev])` + `setTotal(n => n + 1)`
- IntersectionObserver 滚动加载 + 底部加载指示器

### 坐席工作台（WorkspacePage + QueuePanel）

- `GET /api/agent/queue` 支持 `limit` + `offset` 参数，返回 `total`
- `AgentRepository.listQueue()` 返回 `{ items, total }`，新增 `count()` 方法
- `fetchData` 支持三种模式：`'refresh'` / `'load-queued'` / `'load-assigned'`
- 用 `queuedItemsLengthRef` / `assignedItemsLengthRef` 追踪已加载数量
- refresh 时 `limit = Math.max(loaded, 10)` 不丢失已展开数据
- StatsBar 显示 `queuedTotal` / `assignedTotal`（非 `items.length`）
- Badge 显示 `已加载数/总数`
- 排队/服务中各加"查看更多 N 条"按钮

### 已修复的 Bug

| Bug | 原因 | 修复 |
|-----|------|------|
| 列表全部为空 | `hasAutoLoadedRef` guard 导致 reset() 后 loadInitial 被短路 | 移除 `hasAutoLoadedRef`，loadInitial 始终可执行 |
| 滚动时列表跳到顶部 | useEffect deps 包含不稳定回调链，重复执行 | 用 useRef 持有回调，useEffect deps=[] |
| 模拟测试列表为空（第一轮） | fetchFn 错误添加 userId 过滤，userId 始终 null | 移除 userId 参数 |
| 模拟测试列表为空（第二轮） | fetchFn 匿名函数，每次渲染新引用导致无限循环 | fetchFn 用 useCallback 包裹；Hook 内部改用 fetchFnRef.current |

---

## 知识库商品详情专栏（2026-07-01）

### 概述

在知识库中新增「商品详情」专栏，支持结构化商品信息管理（名称/SKU/规格/价格/卖点等），商品数据独立存储，与知识库向量检索打通，AI 可通过 Function Call 或向量检索获取商品信息并回复买家。

### 数据库表：product_details

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| name | varchar(255) | 商品名称 |
| sku | varchar(100) UNIQUE | 商品SKU编码 |
| category | varchar(100) | 商品分类（复用知识库分类体系） |
| parent_category | varchar(100) | 父分类 |
| brand | varchar(100) | 品牌 |
| price | decimal(10,2) | 售价 |
| original_price | decimal(10,2) | 原价 |
| specifications | jsonb | 规格参数（key/value 键值对数组） |
| features | text[] | 卖点/特色 |
| description | text | 商品详细描述 |
| usage_instructions | text | 使用说明 |
| image_urls | text[] | 商品图片URL数组 |
| status | varchar(20) | on_sale/off_sale/discontinued |
| doc_ids | jsonb | Coze SDK 向量文档ID列表 |
| content_hash | varchar(64) | SHA-256内容哈希（去重） |
| tags | varchar(50)[] | 标签 |
| platform_connection_id | UUID FK | 所属店铺（多店铺支持） |
| external_product_id | varchar(100) | 平台侧商品ID（预留字段） |
| sync_source | varchar(20) | manual/qianniu/doudian（预留字段） |
| hit_count | integer | AI引用次数 |
| last_hit_at | timestamptz | 最后引用时间 |

**索引**：sku(UNIQUE)、category、status、content_hash、platform_connection_id、sync_source、hit_count

**涉及文件**：`src/storage/database/shared/schema.ts`、`src/server/repositories/product-detail-repository.ts`

### 关键架构决策

1. **独立存储，不走 knowledge_items 中转**：商品数据存在 `product_details` 表，Coze 向量文档的 doc_ids 直接存于 `doc_ids` 字段。不在 `knowledge_items` 中创建关联行。
2. **向量文档生命周期**：创建商品时向量化 → 上架/下架时更新 doc_ids 状态 → 删除时清理向量文档
3. **与知识库搜索打通**：`knowledge-search-service.search()` 返回结果后处理，如包含商品类文档则附加 `product_id`；AI 回复时注入商品上下文

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/server/repositories/product-detail-repository.ts` | 商品 CRUD（含 SKU 去重、引用计数） |
| `src/server/services/product-detail-service.ts` | 业务逻辑（向量化同步、文本摘要构建、搜索上下文） |
| `src/app/api/knowledge/products/route.ts` | 商品 CRUD API |
| `src/app/api/knowledge/products/[id]/route.ts` | 商品详情 API |
| `src/app/api/knowledge/products/batch/route.ts` | 批量操作 API |
| `src/server/services/tool-providers/product-provider.ts` | LLM Function Call 商品查询 Provider |
| `src/server/services/tool-providers/factory.ts` | 注册 product provider |
| `src/server/services/tool-providers/types.ts` | `ToolProviderType` 增加 `'product'` |
| `src/server/services/tool-execution-service.ts` | `query_product_detail` 工具定义 |
| `src/server/services/llm-streaming-service.ts` | 系统提示词追加商品工具说明 + `productContext` 参数 |
| `src/app/api/conversations/[id]/messages/route.ts` | 消息处理中集成商品搜索上下文 |
| `src/components/faq/product-form-modal.tsx` | 商品创建/编辑表单 |
| `src/components/faq/faq-page.tsx` | FAQ 页面新增「商品详情」Tab |

### API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/knowledge/products | 列表（支持category/status/search/platform_connection_id筛选） |
| POST | /api/knowledge/products | 创建商品（含向量化） |
| PUT | /api/knowledge/products | 更新商品（含增量向量化） |
| DELETE | /api/knowledge/products?id=xxx | 删除商品（含向量文档清理） |
| GET | /api/knowledge/products/[id] | 商品详情 |
| PATCH | /api/knowledge/products/batch | 批量操作（修改状态/分类） |

### LLM Function Call

工具名称：`query_product_detail`

参数：`{"sku": "SKU001"}` 或 `{"name": "纯棉T恤"}` 或 `{"product_id": "uuid"}`

示例：`[TOOL_CALL]query_product_detail|{"sku":"SKU001"}[/TOOL_CALL]`

置信度：基础 0.7（数据库数据可靠），未找到商品 0.4，查询失败 0.3

### 前端 UI

- FAQ 页面新增「商品详情」Tab（TabType 扩展）
- 顶部统计卡片：在售商品数 / 已下架数 / 本周AI引用数
- 筛选区：商品名称+SKU搜索 / 分类筛选 / 状态下拉
- 商品列表：卡片式布局（缩略图 + 名称 + SKU + 价格 + 状态标签 + 引用次数）
- 操作按钮：编辑 / 上架-下架切换 / 删除
- 表单模态框：结构化字段（名称/SKU/分类/品牌/价格/规格参数/卖点/描述/图片上传）

### 数据库表：size_charts

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 主键 |
| name | varchar(255) | 尺码表名称（如"女装T恤尺码表"、"男鞋尺码表"） |
| category | varchar(100) | 适用分类（复用知识库分类体系） |
| parent_category | varchar(100) | 父分类 |
| chart_type | varchar(30) | 尺码表类型：`clothing`（服装）/ `shoes`（鞋类）/ `accessories`（配饰）/ `custom`（自定义） |
| product_id | UUID FK → product_details.id | 关联商品（NULL=通用尺码表） |
| sku | varchar(100) | 商品SKU（冗余字段，方便快速查询） |
| size_columns | jsonb | 尺码列定义 `[{"key":"size","label":"尺码"},{"key":"bust","label":"胸围(cm)"}]` |
| size_rows | jsonb | 尺码数据行 `[{"size":"S","bust":"82-86","waist":"62-66"}]` |
| recommend_params | jsonb | 推荐参数 `{"dimensions":[{"key":"height","label":"身高","unit":"cm","range":[150,185],"required":true}]}` |
| recommend_rules | text | 推荐规则说明（自然语言，供LLM理解） |
| description | text | 尺码表补充说明（如"偏小一码建议选大一号"） |
| image_url | varchar(500) | 尺码表图片URL（可选） |
| doc_ids | jsonb | Coze SDK 向量文档ID |
| content_hash | varchar(64) | SHA-256 去重哈希 |
| status | varchar(20) | `active` / `disabled` |
| hit_count | integer | AI引用次数 |
| last_hit_at | timestamptz | 最后引用时间 |
| platform_connection_id | UUID FK | 所属店铺 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

**索引**：category、product_id、sku、status、content_hash、platform_connection_id、hit_count

**设计决策**：
- `product_id` 为 NULL 表示分类通用尺码表；非 NULL 表示商品专属尺码表
- `recommend_params.dimensions` 结构化定义推荐维度（身高/体重/偏好等），支持 AI 个性化推荐
- 一个商品可创建多张不同 `chart_type` 的尺码表

**涉及文件**：`src/storage/database/shared/schema.ts`、`src/server/repositories/size-chart-repository.ts`

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/server/repositories/size-chart-repository.ts` | 尺码表 CRUD（含 SKU 去重、引用计数） |
| `src/server/services/size-chart-service.ts` | 业务逻辑（向量化同步、文本摘要构建、搜索上下文、尺码推荐） |
| `src/app/api/knowledge/size-charts/route.ts` | 尺码表 CRUD API |
| `src/app/api/knowledge/size-charts/[id]/route.ts` | 尺码表详情 API |
| `src/server/services/tool-providers/size-chart-provider.ts` | LLM Function Call 尺码查询 Provider |
| `src/server/services/tool-providers/factory.ts` | 注册 size_chart provider |
| `src/server/services/tool-providers/types.ts` | `ToolProviderType` 增加 `'size_chart'` |
| `src/server/services/tool-execution-service.ts` | `query_size_chart` 工具定义 + 映射同步 |
| `src/server/services/llm-streaming-service.ts` | 系统提示词追加尺码工具说明 + `sizeChartContext` 参数 |
| `src/app/api/conversations/[id]/messages/route.ts` | 消息处理中集成尺码搜索上下文 |
| `src/components/chat/source-panel.tsx` | 引用溯源面板新增尺码表类型 |
| `src/components/faq/size-chart-form-modal.tsx` | 尺码表创建/编辑表单（含预览态） |
| `src/components/faq/faq-page.tsx` | FAQ 页面新增「尺码配置」Tab |
| `src/components/faq/product-form-modal.tsx` | 商品表单新增关联尺码表选择区 |
| `src/storage/database/shared/schema.ts` | `sizeChartVersions` 表定义 |

### API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | /api/knowledge/size-charts | 列表（支持category/chart_type/status/search筛选） |
| POST | /api/knowledge/size-charts | 创建尺码表（含向量化） |
| PUT | /api/knowledge/size-charts | 更新尺码表（含增量向量化） |
| DELETE | /api/knowledge/size-charts?id=xxx | 删除尺码表（含向量文档清理） |
| GET | /api/knowledge/size-charts/[id] | 尺码表详情 |
| GET | /api/knowledge/size-charts/versions?chart_id=xxx | 获取尺码表版本历史 |
| POST | /api/knowledge/size-charts/versions | 回滚到指定版本 |
| POST | /api/knowledge/size-charts/import | 批量导入尺码表（Excel/CSV） |
| GET | /api/knowledge/size-charts/export?format=csv | 导出尺码表（CSV） |

### LLM Function Call

工具名称：`query_size_chart`

参数：`{"sku": "SKU001"}` 或 `{"category": "女装/T恤"}` 或 `{"size_chart_id": "uuid"}`
可选参数：`{"height": 170, "weight": 65}` 用于个性化尺码推荐

示例：`[TOOL_CALL]query_size_chart|{"sku":"SKU001","height":170,"weight":65}[/TOOL_CALL]`

置信度策略：

| 场景 | 置信度 |
|------|--------|
| 查到商品专属尺码表 + 有推荐参数 | 0.75 |
| 查到商品专属尺码表 + 无推荐参数 | 0.7 |
| 查到通用尺码表（非商品专属） | 0.6 |
| 未找到尺码表 | 0.4 |
| 查询失败 | 0.3 |

### 前端 UI

- FAQ 页面新增「尺码配置」Tab（TabType 扩展 `'size_charts'`）
- 顶部统计卡片：总尺码表数 / 启用中 / 本周AI引用数 / 关联商品数
- 筛选区：尺码表名称搜索 / 分类筛选 / 类型下拉（服装/鞋类/配饰/自定义）/ 状态下拉
- 尺码表列表：卡片式布局（名称 + 分类 + 类型 + 状态标签 + 引用次数）
- 操作按钮：编辑 / 禁用-启用切换 / 删除
- 表单模态框：动态列定义（表格编辑）+ 行数据 + AI推荐参数配置 + 预览态切换

### Phase 3: 商品关联增强

| 能力 | 说明 |
|------|------|
| 商品-尺码表关联 | `size_charts.product_id` FK 关联商品详情，支持从商品详情页查看关联尺码表列表 |
| 商品表单关联选择 | 创建/编辑商品时，可下拉选择关联已有尺码表 |
| 智能关联提示 | 保存商品时若同分类有通用尺码表，提示可关联 |

**关键文件：**
- `src/components/faq/product-form-modal.tsx` — 新增关联尺码表选择区（`SizeChartsSection`）

### Phase 4: 批量导入/导出与版本管理

| 能力 | 说明 |
|------|------|
| Excel/CSV 批量导入 | `POST /api/knowledge/size-charts/import`，支持 .xlsx/.csv，多条记录事务写入 |
| CSV 导出 | `GET /api/knowledge/size-charts/export?format=csv`，按筛选条件导出 |
| 版本管理 | 每次更新尺码表自动创建版本快照（`size_chart_versions`），支持历史查看和回滚 |

**新增数据库表：** `size_chart_versions(id, size_chart_id, version_number, content_snapshot, description, created_at)`

**关键文件：**
- `src/storage/database/shared/schema.ts` — `sizeChartVersions` 表定义
- `src/server/repositories/size-chart-version-repository.ts` — 版本 CRUD
- `src/app/api/knowledge/size-charts/versions/route.ts` — 版本历史 GET + 回滚 PATCH
- `src/app/api/knowledge/size-charts/import/route.ts` — 批量导入
- `src/app/api/knowledge/size-charts/export/route.ts` — CSV 导出


---

## 项目初始化与预览链路（2026-07-08）

### 初始化信息

| 项目 | 值 |
|------|------|
| 工作区根目录 | `/workspace/projects` |
| 技术项目根目录 | `/workspace/projects`（与工作区根目录重合） |
| 项目类型 | web |
| 运行时 | Node.js 24 |
| 包管理器 | pnpm |
| 可预览 | enabled |

### 根 `.coze` 配置

位置：`/workspace/projects/.coze`

```toml
[project]
sub_id = "835864e9"
name = "smartassist"
requires = ["nodejs-24"]
project_type = "web"

[preview]
preview_enable = "enabled"

[dev]
build = ["bash", "./scripts/prepare.sh"]
run = ["bash", "./scripts/dev.sh"]
validate = ["bash", "./scripts/validate.sh"]
deps = ["git"]

[deploy.profile]
kind = "service"
flavor = "web"

[deploy]
build = ["bash", "./scripts/build.sh"]
run = ["bash", "./scripts/start.sh"]
deps = ["git"]

[subprojects]
path = ["."]
```

### 预览链路修复记录

**问题**：`server.ts` 依赖 `HOSTNAME` 环境变量确定绑定地址，但 `dev.sh` 和 `start.sh` 未设置此变量，导致服务绑定到 `localhost` 而非 `0.0.0.0`。

**修复**：
1. `scripts/dev.sh`：添加 `HOSTNAME=0.0.0.0` 环境变量，传递到启动命令
2. `scripts/start.sh`：添加 `HOSTNAME=0.0.0.0` 环境变量，传递到启动命令

**验证结果**：
- 端口绑定：`*:5000`（IPv4 全接口）
- `/login` 返回 200
- `/` 返回 307（重定向到登录页面）

### 关键脚本

| 脚本 | 职责 |
|------|------|
| `scripts/prepare.sh` | 安装依赖（pnpm install） |
| `scripts/dev.sh` | 启动开发预览服务（端口 5000，绑定 0.0.0.0） |
| `scripts/validate.sh` | 运行类型检查和 lint |
| `scripts/build.sh` | 构建生产产物（Next.js + tsup） |
| `scripts/start.sh` | 启动生产服务（端口 5000，绑定 0.0.0.0） |

### 预览访问

预览服务已在 5000 端口运行，可通过平台分配的访问地址访问。
