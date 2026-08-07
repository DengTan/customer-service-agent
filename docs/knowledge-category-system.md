# 知识库分类系统设计文档

## 1. 概述

知识库分类系统用于组织和管理知识条目，支持层级分类、颜色标记、统计计数等功能。

## 2. 数据库设计

### 2.1 表结构：knowledge_categories

```sql
CREATE TABLE knowledge_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  color VARCHAR(20) DEFAULT '#6366f1',
  sort_order INTEGER DEFAULT 0,
  description TEXT,
  item_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 索引
CREATE INDEX idx_knowledge_categories_sort_order ON knowledge_categories(sort_order);
CREATE INDEX idx_knowledge_categories_name ON knowledge_categories(name);
```

### 2.2 knowledge_items 关联字段

```sql
ALTER TABLE knowledge_items ADD COLUMN category_id UUID REFERENCES knowledge_categories(id) ON DELETE SET NULL;
CREATE INDEX idx_knowledge_items_category_id ON knowledge_items(category_id);
```

### 2.3 RPC 函数：计数更新

```sql
CREATE OR REPLACE FUNCTION increment_knowledge_category_count(cat_id UUID, delta INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE knowledge_categories
  SET item_count = GREATEST(0, item_count + delta)
  WHERE id = cat_id;
END;
$$ LANGUAGE plpgsql;
```

## 3. 架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────┐
│  UI Layer (React Components)            │
│  - CategoryManagerDialog                │
│  - CategorySelect                       │
│  - KnowledgeTab (分类筛选)              │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  API Layer (Next.js Route Handlers)     │
│  - GET    /api/knowledge/categories     │
│  - POST   /api/knowledge/categories     │
│  - GET    /api/knowledge/categories/:id │
│  - PUT    /api/knowledge/categories/:id │
│  - DELETE /api/knowledge/categories/:id │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  Service Layer                           │
│  - KnowledgeCategoryService             │
│    • 业务逻辑验证                       │
│    • 重复名称检查                       │
│    • 树形结构构建                       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  Repository Layer                        │
│  - KnowledgeCategoryRepository          │
│    • CRUD 操作                          │
│    • 计数维护                           │
│    • 树形查询                           │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  Database (Supabase PostgreSQL)         │
└─────────────────────────────────────────┘
```

## 4. API 接口设计

### 4.1 获取分类列表（树形 + 扁平）

**Request:**
```http
GET /api/knowledge/categories
```

**Response:**
```json
{
  "success": true,
  "categories": [
    {
      "id": "uuid-1",
      "name": "产品相关",
      "color": "#6366f1",
      "sort_order": 1,
      "description": null,
      "item_count": 5,
      "created_at": "2026-08-05T10:00:00Z",
      "updated_at": null
    },
    {
      "id": "uuid-2",
      "name": "物流相关",
      "color": "#8b5cf6",
      "sort_order": 2,
      "item_count": 3,
      "created_at": "2026-08-05T10:00:00Z",
      "updated_at": null
    }
  ]
}
```

### 4.2 创建分类

**Request:**
```http
POST /api/knowledge/categories
Content-Type: application/json

{
  "name": "产品相关",
  "color": "#6366f1",
  "description": "产品相关知识"
}
```

**Response:**
```json
{
  "success": true,
  "id": "uuid-1",
  "name": "产品相关",
  "color": "#6366f1",
  "sort_order": 0,
  "description": "产品相关知识",
  "item_count": 0,
  "created_at": "2026-08-05T10:00:00Z",
  "updated_at": null
}
```

### 4.3 更新分类

**Request:**
```http
PUT /api/knowledge/categories/:id
Content-Type: application/json

{
  "name": "产品相关（更新）",
  "color": "#8b5cf6"
}
```

**Response:**
```json
{
  "success": true,
  "id": "uuid-1",
  "name": "产品相关（更新）",
  "color": "#8b5cf6",
  ...
}
```

### 4.4 删除分类

**Request:**
```http
DELETE /api/knowledge/categories/:id?strategy=set_null
```

**Query Parameters:**
- `strategy`: `set_null` | `merge_to`（默认 `set_null`）
- `merge_to_id`: 合并目标分类 ID（仅当 `strategy=merge_to` 时需要）

**Response:**
```json
{
  "success": true,
  "affected_items": 5
}
```

## 5. 核心功能

### 5.1 分类管理（CategoryManagerDialog）

#### 功能列表

1. **查看分类列表**
   - 平铺列表展示
   - 显示分类颜色圆点
   - 显示条目数量
   - 按 sort_order 和名称排序

2. **创建分类**
   - 输入分类名称
   - 选择颜色（10 种预设）
   - 唯一性校验

3. **编辑分类**
   - 内联编辑模式
   - 修改名称
   - 修改颜色
   - 保存/取消操作

4. **删除分类**
   - 确认对话框
   - 显示影响的条目数
   - 删除后将关联条目的分类设为空

5. **搜索分类**
   - 模糊匹配分类名称
   - 实时过滤

#### UI 设计

```
┌──────────────────────────────────────────────┐
│ 分类管理                                [X]  │
├──────────────────────────────────────────────┤
│ [🔍 搜索分类...]                   [+ 新建]  │
├──────────────────────────────────────────────┤
│ ● 产品相关 (5)                    [✏️] [🗑️] │
│ ● 物流相关 (3)                    [✏️] [🗑️] │
│ ● 售后相关 (2)                    [✏️] [🗑️] │
│ ● 支付相关 (1)                    [✏️] [🗑️] │
└──────────────────────────────────────────────┘
```

### 5.2 分类选择器（CategorySelect）

#### 功能

- 下拉选择分类
- 支持快速搜索
- 支持创建新分类
- 显示分类颜色

#### 使用场景

1. 知识条目导入时选择分类
2. 知识条目编辑时修改分类

### 5.3 分类筛选（KnowledgeTab）

#### 功能

- 顶部胶囊式分类标签
- 点击切换筛选
- 显示每个分类的条目数量
- 「全部」标签显示总数

#### UI 设计

```
[全部 (10)] [产品相关 (5)] [物流相关 (3)] [售后相关 (2)]
```

## 6. 数据一致性

### 6.1 计数维护

**触发时机：**
1. 导入知识条目时 `+1`
2. 删除知识条目时 `-1`
3. 修改条目分类时 `旧分类-1, 新分类+1`
4. 删除分类时重新计算

**实现方式：**
```typescript
// 增量更新（快）
await categoryRepository.updateItemCount(categoryId, 1);

// 重新计算（慢但准确）
await categoryRepository.recomputeItemCount(categoryId);
```

### 6.2 删除策略

删除分类时，将关联条目的 `category_id` 设为 `NULL`：

```typescript
// 1. 将关联条目的 category_id 设为 NULL
UPDATE knowledge_items
SET category_id = NULL, updated_at = NOW()
WHERE category_id = 'deleted-category-id';

// 2. 删除分类
DELETE FROM knowledge_categories WHERE id = 'deleted-category-id';
```

## 7. 代码文件清单

### 7.1 数据库迁移

```
supabase/migrations/20260805_knowledge_categories.sql
```

### 7.2 类型定义

```typescript
// src/server/repositories/knowledge-category-repository.ts
export interface KnowledgeCategory {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  description: string | null;
  item_count: number;
  created_at: string;
  updated_at: string | null;
}
```

### 7.3 核心文件

| 文件路径 | 职责 |
|---------|------|
| `src/app/api/knowledge/categories/route.ts` | GET/POST 接口 |
| `src/app/api/knowledge/categories/[id]/route.ts` | GET/PUT/DELETE 接口 |
| `src/server/services/knowledge-category-service.ts` | 业务逻辑层 |
| `src/server/repositories/knowledge-category-repository.ts` | 数据访问层 |
| `src/components/faq/category-manager-dialog.tsx` | 分类管理弹窗 |
| `src/components/faq/category-select.tsx` | 分类选择器 |
| `src/components/faq/knowledge-tab.tsx` | 分类筛选集成 |

## 8. 实现步骤

### 步骤 1: 数据库迁移

创建 `knowledge_categories` 表和 RPC 函数。

### 步骤 2: Repository 层

实现 CRUD、计数维护。

### 步骤 3: Service 层

实现业务逻辑、唯一性校验。

### 步骤 4: API 层

实现 REST 接口、权限校验。

### 步骤 5: UI 组件

实现分类管理弹窗、选择器、筛选器。

### 步骤 6: 集成测试

测试创建、编辑、删除、计数准确性。

## 9. 预设颜色

```typescript
export const CATEGORY_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];
```

## 10. 错误处理

### 业务错误码

| 错误码 | 说明 | HTTP 状态码 |
|-------|------|------------|
| `VALIDATION_ERROR` | 输入验证失败 | 400 |
| `DUPLICATE_NAME` | 分类名称已存在 | 400 |
| `NOT_FOUND` | 分类不存在 | 404 |

### 示例

```json
{
  "success": false,
  "error": "分类名称已存在",
  "code": "DUPLICATE_NAME"
}
```

## 11. Demo 模式支持

当 `isDemoMode()` 返回 `true` 时，Repository 层返回硬编码的假数据：

```typescript
if (isDemoMode()) {
  return [
    { id: 'demo-1', name: '产品相关', color: '#6366f1', item_count: 5, ... },
    { id: 'demo-2', name: '物流相关', color: '#8b5cf6', item_count: 3, ... },
    { id: 'demo-3', name: '售后相关', color: '#ec4899', item_count: 2, ... },
  ];
}
```

## 12. 性能优化

1. **索引优化**：`sort_order`, `name`, `category_id` 建立索引
2. **计数缓存**：`item_count` 字段避免实时聚合
3. **懒加载**：分类列表支持分页（可选）

## 13. 后续扩展

1. **拖拽排序**：支持分类拖拽调整顺序
2. **批量操作**：批量删除、批量移动
3. **分类图标**：支持自定义图标
4. **权限控制**：不同角色的分类操作权限
5. **分类统计**：分类下的条目趋势图
6. **分类合并**：将多个分类合并为一个

---

**文档版本**: v1.0  
**最后更新**: 2026-08-06  
**作者**: Kiro AI Assistant
