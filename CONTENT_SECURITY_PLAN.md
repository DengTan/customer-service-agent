# 内容安全过滤功能实现计划

## 需求概述

为 SmartAssist 智能客服系统添加消息内容安全过滤功能，包括：
1. **敏感词过滤**：过滤用户消息中的脏话/违规词
2. **URL 白名单**：检测并过滤未授权的外部链接
3. **前端配置 UI**：在设置页面添加内容安全配置

---

## 计划审查结果

### 发现的问题

| 问题 | 原计划 | 修正后 |
|------|--------|--------|
| 表命名不够明确 | `sensitive_words` | `content_sensitive_words` |
| UI 分区过细 | 新增「内容安全」分区 | 集成到现有「对话设置」分区 |
| 实施顺序 | 按文件类型分 Phase | 按功能优先级：敏感词 → URL白名单 → UI |

---

## Phase 1: 数据库设计

### 1.1 数据库表定义

**新增表 1: `content_sensitive_words`（敏感词表）**

```typescript
// src/storage/database/shared/schema.ts
export const contentSensitiveWords = pgTable(
  "content_sensitive_words",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    word: varchar("word", { length: 100 }).notNull().unique(), // 敏感词内容
    match_mode: varchar("match_mode", { length: 20 }).notNull().default("exact"), // exact=精确, fuzzy=模糊(含敏感词的短语)
    action: varchar("action", { length: 20 }).notNull().default("block"), // block=阻止, replace=替换, warn=警告
    replacement: varchar("replacement", { length: 100 }), // 替换词(当action=replace时)
    category: varchar("category", { length: 50 }).default("脏话"), // 分类: 脏话/政治/广告/其他
    is_enabled: boolean("is_enabled").notNull().default(true),
    hit_count: integer("hit_count").notNull().default(0), // 命中次数统计
    created_by: varchar("created_by", { length: 36 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("csw_word_idx").on(table.word),
    index("csw_category_idx").on(table.category),
    index("csw_is_enabled_idx").on(table.is_enabled),
  ]
);
```

**新增表 2: `allowed_domains`（URL 白名单表）**

```typescript
export const allowedDomains = pgTable(
  "allowed_domains",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    domain: varchar("domain", { length: 255 }).notNull().unique(), // 域名,支持通配符如 *.example.com
    pattern_type: varchar("pattern_type", { length: 20 }).notNull().default("exact"), // exact=精确, wildcard=通配符, suffix=域名后缀
    description: varchar("description", { length: 255 }), // 用途说明
    is_enabled: boolean("is_enabled").notNull().default(true),
    hit_count: integer("hit_count").notNull().default(0), // 命中次数统计
    created_by: varchar("created_by", { length: 36 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ad_domain_idx").on(table.domain),
    index("ad_is_enabled_idx").on(table.is_enabled),
  ]
);
```

**新增表 3: `content_filter_logs`（过滤日志表）**

```typescript
export const contentFilterLogs = pgTable(
  "content_filter_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }), // 关联对话
    message_id: varchar("message_id", { length: 36 }), // 关联消息(如果已保存)
    filter_type: varchar("filter_type", { length: 20 }).notNull(), // sensitive_word, url
    word: varchar("word", { length: 100 }), // 命中的敏感词/域名
    action: varchar("action", { length: 20 }).notNull(), // blocked, replaced, warned
    original_content: text("original_content").notNull(), // 原始消息内容
    filtered_content: text("filtered_content"), // 过滤后内容(如有替换)
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("cfl_conversation_id_idx").on(table.conversation_id),
    index("cfl_filter_type_idx").on(table.filter_type),
    index("cfl_created_at_idx").on(table.created_at),
  ]
);
```

### 1.2 Settings 表扩展

新增以下设置项（存储在 settings 表）：

| Key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `content_filter_enabled` | boolean | `true` | 是否启用内容过滤 |
| `sensitive_word_filter_enabled` | boolean | `true` | 敏感词过滤开关 |
| `url_filter_enabled` | boolean | `true` | URL 白名单过滤开关 |
| `url_filter_mode` | string | `"whitelist"` | 模式: whitelist(白名单)/blacklist(黑名单) |
| `sensitive_word_default_action` | string | `"block"` | 默认动作: block/replace/warn |
| `url_block_message` | string | `"抱歉,发送的链接不在白名单范围内"` | URL 拦截提示 |

---

## Phase 2: 后端核心逻辑

### 2.1 Repository 层

**新建文件: `src/server/repositories/content-filter-repository.ts`**

```typescript
export class ContentFilterRepository {
  // 敏感词 CRUD
  async listSensitiveWords(filters?: { category?: string; is_enabled?: boolean }): Promise<SensitiveWordRow[]>
  async createSensitiveWord(word: CreateSensitiveWordInput): Promise<SensitiveWordRow>
  async updateSensitiveWord(id: string, updates: UpdateSensitiveWordInput): Promise<SensitiveWordRow>
  async deleteSensitiveWord(id: string): Promise<void>
  async incrementHitCount(word: string): Promise<void>

  // URL 白名单 CRUD
  async listAllowedDomains(filters?: { is_enabled?: boolean }): Promise<AllowedDomainRow[]>
  async createAllowedDomain(domain: CreateDomainInput): Promise<AllowedDomainRow>
  async updateAllowedDomain(id: string, updates: UpdateDomainInput): Promise<AllowedDomainRow>
  async deleteAllowedDomain(id: string): Promise<void>
  async incrementDomainHitCount(domain: string): Promise<void>

  // 过滤日志
  async createFilterLog(log: CreateFilterLogInput): Promise<void>
  async listFilterLogs(filters?: { conversation_id?: string; filter_type?: string; limit?: number }): Promise<FilterLogRow[]>
}
```

### 2.2 Service 层

**新建文件: `src/server/services/content-filter-service.ts`**

```typescript
export class ContentFilterService {
  // 主过滤方法
  async filterContent(
    content: string,
    options?: { conversationId?: string; logEnabled?: boolean }
  ): Promise<FilterResult>

  // 敏感词检查
  async checkSensitiveWords(content: string): Promise<SensitiveWordMatch[]>

  // URL 检查
  async checkUrls(content: string): Promise<UrlMatch[]>

  // URL 白名单匹配(支持通配符)
  isDomainAllowed(url: string): Promise<boolean>
  matchWildcardDomain(domain: string, pattern: string): boolean
}
```

**类型定义:**

```typescript
interface FilterResult {
  allowed: boolean;
  filteredContent: string;
  sensitiveWordMatches: SensitiveWordMatch[];
  urlMatches: UrlMatch[];
  warnings: string[];
}

interface SensitiveWordMatch {
  word: string;
  position: number;
  length: number;
  action: 'block' | 'replace' | 'warn';
  replacement?: string;
  category: string;
}

interface UrlMatch {
  url: string;
  domain: string;
  isAllowed: boolean;
}
```

### 2.3 消息流水线集成

**修改文件: `src/app/api/conversations/[id]/messages/route.ts`**

在用户消息验证后（第 38 行之后）添加内容过滤检查：

```typescript
// 第 36-38 行后新增
if (userMessage.length > HTTP.MAX_MESSAGE_LENGTH) {
  return apiError(`消息内容超过最大长度限制...`);
}

// 新增: 内容过滤检查
const contentFilterEnabled = await settingsService.getSetting('content_filter_enabled') === 'true';
if (contentFilterEnabled) {
  const contentFilterService = new ContentFilterService();
  const filterResult = await contentFilterService.filterContent(userMessage, {
    conversationId: conversationId,
    logEnabled: true,
  });

  if (!filterResult.allowed) {
    return NextResponse.json({
      message: {
        role: 'system',
        content: filterResult.warnings[0] || '您的消息包含不合规内容，请修改后再试。',
      },
    }, { status: 400 });
  }

  // 如果有替换,使用过滤后的内容继续处理
  if (filterResult.filteredContent !== userMessage) {
    userMessage = filterResult.filteredContent;
  }
}
```

### 2.4 API 路由

**新建文件: `src/app/api/content-filter/`**

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/content-filter/sensitive-words` | 获取敏感词列表 |
| POST | `/api/content-filter/sensitive-words` | 添加敏感词 |
| PUT | `/api/content-filter/sensitive-words` | 更新敏感词 |
| DELETE | `/api/content-filter/sensitive-words?id=xxx` | 删除敏感词 |
| GET | `/api/content-filter/domains` | 获取域名白名单 |
| POST | `/api/content-filter/domains` | 添加域名 |
| PUT | `/api/content-filter/domains` | 更新域名 |
| DELETE | `/api/content-filter/domains?id=xxx` | 删除域名 |
| GET | `/api/content-filter/logs` | 获取过滤日志 |

---

## Phase 3: 前端 UI

### 3.1 设置页面扩展

**修改文件: `src/components/settings/settings-page.tsx`**

在现有「对话设置」(chat) 分区添加内容安全子区块：

```tsx
// 对话设置分区中添加:

{activeSection === 'chat' && (
  <section>
    {/* 现有的对话设置内容 */}

    {/* 新增: 内容安全配置 */}
    <div className="mt-6 border-t pt-6">
      <h3 className="text-sm font-medium mb-4">内容安全</h3>

      {/* 开关配置 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">启用内容过滤</div>
            <div className="text-xs text-muted-foreground">
              对用户消息进行敏感词和链接过滤
            </div>
          </div>
          <ToggleSwitch
            checked={settings.content_filter_enabled === 'true'}
            onChange={(v) => updateSetting('content_filter_enabled', String(v))}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">敏感词过滤</div>
            <div className="text-xs text-muted-foreground">
              过滤脏话、违规词等
            </div>
          </div>
          <ToggleSwitch
            checked={settings.sensitive_word_filter_enabled === 'true'}
            onChange={(v) => updateSetting('sensitive_word_filter_enabled', String(v))}
            disabled={settings.content_filter_enabled !== 'true'}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">URL 白名单</div>
            <div className="text-xs text-muted-foreground">
              只允许发送白名单中的链接
            </div>
          </div>
          <ToggleSwitch
            checked={settings.url_filter_enabled === 'true'}
            onChange={(v) => updateSetting('url_filter_enabled', String(v))}
            disabled={settings.content_filter_enabled !== 'true'}
          />
        </div>
      </div>

      {/* 敏感词管理按钮 */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={() => setShowSensitiveWordManager(true)}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted"
        >
          管理敏感词 ({sensitiveWordCount})
        </button>
        <button
          onClick={() => setShowDomainManager(true)}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-muted"
        >
          管理白名单域名 ({domainCount})
        </button>
      </div>
    </div>
  </section>
)}
```

### 3.2 敏感词管理弹窗

**新建文件: `src/components/settings/sensitive-word-manager.tsx`**

功能:
- 列表展示敏感词(支持分类筛选)
- 添加/编辑敏感词(内容、匹配模式、动作、替换词、分类)
- 批量导入/导出
- 命中统计展示

### 3.3 域名白名单管理弹窗

**新建文件: `src/components/settings/domain-whitelist-manager.tsx`**

功能:
- 列表展示域名(支持通配符说明)
- 添加/编辑域名(域名、匹配模式、描述)
- 常用域名快捷添加(如官方商城、社交媒体)
- 命中统计展示

---

## 实施顺序

### Step 1: 数据库和 Repository（核心）
1. 在 `schema.ts` 添加三张新表
2. 创建 `content-filter-repository.ts`
3. 创建数据库迁移 SQL

### Step 2: Service 和过滤逻辑
4. 创建 `content-filter-service.ts`
5. 实现 `filterContent()` 核心方法
6. 实现 URL 通配符匹配算法

### Step 3: API 路由
7. 创建 `/api/content-filter/` 路由
8. 在 `messages/route.ts` 集成过滤检查

### Step 4: 前端 UI
9. 在设置页面添加配置开关
10. 创建敏感词管理弹窗
11. 创建域名白名单管理弹窗
12. 添加默认值到 `FACTORY_DEFAULTS`

---

## 关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/storage/database/shared/schema.ts` | 修改 | 添加三张新表 |
| `src/server/repositories/content-filter-repository.ts` | 新建 | 数据访问层 |
| `src/server/services/content-filter-service.ts` | 新建 | 业务逻辑层 |
| `src/app/api/content-filter/sensitive-words/route.ts` | 新建 | 敏感词 CRUD API |
| `src/app/api/content-filter/domains/route.ts` | 新建 | 域名白名单 CRUD API |
| `src/app/api/content-filter/logs/route.ts` | 新建 | 过滤日志 API |
| `src/app/api/conversations/[id]/messages/route.ts` | 修改 | 集成内容过滤 |
| `src/components/settings/settings-page.tsx` | 修改 | 添加内容安全配置 UI |
| `src/components/settings/sensitive-word-manager.tsx` | 新建 | 敏感词管理组件 |
| `src/components/settings/domain-whitelist-manager.tsx` | 新建 | 域名白名单管理组件 |
| `supabase/migrations/` | 新建 | 数据库迁移文件 |

---

## 技术要点

### URL 通配符匹配算法

```typescript
// 支持三种模式
function matchDomain(inputDomain: string, pattern: string, patternType: string): boolean {
  switch (patternType) {
    case 'exact':
      return inputDomain === pattern;
    case 'wildcard': // *.example.com
      const suffix = pattern.replace(/^\*\./, '');
      return inputDomain === suffix || inputDomain.endsWith('.' + suffix);
    case 'suffix': // example.com
      return inputDomain === pattern || inputDomain.endsWith('.' + pattern);
    default:
      return false;
  }
}
```

### 敏感词匹配优化

使用 Aho-Corasick 算法或 Tire 树实现高效的多模式匹配，避免对每条消息遍历所有敏感词。

---

## 验收标准

1. 用户发送包含敏感词的消息，系统按配置动作处理(阻止/替换/警告)
2. 用户发送不在白名单的 URL，系统阻止并提示
3. 管理员可在设置页面配置过滤规则
4. 过滤日志记录所有拦截事件
5. 配置项持久化到数据库，重启后生效
