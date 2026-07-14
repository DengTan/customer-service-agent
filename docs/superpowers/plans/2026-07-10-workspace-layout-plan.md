# 坐席工作台视觉优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化坐席工作台视觉层级，突出当前对话，侧边栏轻量化，三栏分隔更协调

**Architecture:** 保持三栏布局结构，通过样式优化提升视觉层次：左侧列表改为 Tab 切换 + 卡片式设计，右侧信息卡片分组优化，整体间距和分隔线统一

**Tech Stack:** React, Tailwind CSS, shadcn/ui

---

## Task 1: 重构左侧排队列表为 Tab 切换模式

**Files:**
- Modify: `src/components/workspace/queue-panel.tsx`
- Modify: `src/components/workspace/workspace-page.tsx` (移除 QueuePanel 的嵌套结构)

- [ ] **Step 1: 重构 queue-panel.tsx - 改为 Tab 切换模式**

将"排队等待"和"正在服务"从两个独立区块改为 Tab 切换：

```tsx
// Tab 切换组件替换原来的两个折叠区块
<div className="flex border-b border-border">
  <button
    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
      activeTab === 'queued'
        ? 'text-primary border-b-2 border-primary -mb-px'
        : 'text-muted-foreground hover:text-foreground'
    }`}
    onClick={() => setActiveTab('queued')}
  >
    <span>排队等待</span>
    <Badge variant="secondary" className="text-xs">{queuedItems.length}/{queuedTotal}</Badge>
  </button>
  <button
    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
      activeTab === 'assigned'
        ? 'text-primary border-b-2 border-primary -mb-px'
        : 'text-muted-foreground hover:text-foreground'
    }`}
    onClick={() => setActiveTab('assigned')}
  >
    <span>正在服务</span>
    <Badge variant="secondary" className="text-xs">{assignedItems.length}/{assignedTotal}</Badge>
  </button>
</div>
```

- [ ] **Step 2: 统一列表项样式为卡片式设计**

```tsx
// 列表项卡片样式
<div className={`p-3 rounded-lg transition-all cursor-pointer ${
  selectedConversation?.id === item.id
    ? 'bg-primary/5 border-l-[3px] border-primary'
    : 'bg-muted/30 hover:bg-muted/50 border-l-[3px] border-transparent'
}`}>
  <div className="flex items-center justify-between mb-1.5">
    <div className="flex items-center gap-2">
      {activeTab === 'assigned' && (
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
      )}
      <span className="text-sm font-medium truncate">
        {item.customer_name || '未知客户'}
      </span>
    </div>
    {item.priority === 'urgent' && (
      <Badge variant="destructive" className="text-xs">紧急</Badge>
    )}
  </div>
  {/* ... 其他内容 */}
</div>
```

- [ ] **Step 3: 调整容器宽度和 padding**

```tsx
<div className="w-[280px] border-r border-border bg-card flex flex-col overflow-hidden shrink-0">
  {/* Tab 头部 */}
  {/* 列表区域 */}
  <div className="flex-1 overflow-y-auto p-3 space-y-2">
    {/* 列表项 */}
  </div>
</div>
```

- [ ] **Step 4: 更新 workspace-page.tsx 传递 props**

移除原来 QueuePanel 内部管理 assignedItems 的逻辑，改为统一在父组件管理 activeTab

---

## Task 2: 优化右侧客户信息面板

**Files:**
- Modify: `src/components/workspace/customer-info-panel.tsx`

- [ ] **Step 1: 重构卡片布局，添加分组标题和视觉分隔**

```tsx
<div className="w-[280px] border-l border-border bg-card overflow-y-auto shrink-0">
  <div className="p-4 space-y-5">
    {/* 基本信息 - 始终显示 */}
    <section>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
        客户信息
      </h3>
      <div className="flex items-center gap-3">
        {/* 头像和基本信息 */}
      </div>
    </section>

    {/* 问题摘要 - 有内容时显示 */}
    {selectedConversation.summary && (
      <section>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          问题摘要
        </h3>
        <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          {selectedConversation.summary}
        </div>
      </section>
    )}

    {/* 转人工原因 - 有内容时显示 */}
    {selectedConversation.reason && (
      <section>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          转人工原因
        </h3>
        <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          {selectedConversation.reason}
        </div>
      </section>
    )}

    {/* 快捷操作 */}
    <section>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
        快捷操作
      </h3>
      <div className="space-y-1.5">
        {/* 操作按钮 */}
      </div>
    </section>
  </div>
</div>
```

- [ ] **Step 2: 统一操作按钮样式**

```tsx
<Button
  variant="ghost"
  className="w-full justify-start gap-2 h-9 px-3 rounded-lg
             text-muted-foreground hover:text-foreground hover:bg-muted
             transition-colors"
  onClick={onTransfer}
>
  <ArrowRightLeft className="w-4 h-4" />
  转接其他坐席
</Button>
```

---

## Task 3: 调整整体布局间距

**Files:**
- Modify: `src/components/workspace/workspace-page.tsx`

- [ ] **Step 1: 统一 Header 区域间距**

```tsx
<div className="h-14 border-b border-border px-4 flex items-center justify-between bg-card shrink-0">
  {/* 内容保持紧凑，间距统一为 4 */}
</div>
```

- [ ] **Step 2: 统一三栏布局的分隔线样式**

```tsx
<div className="flex flex-1 min-h-0">
  {/* 左侧 - 280px，带右侧细线分隔 */}
  <div className="w-[280px] border-r border-border/50 shrink-0">
  </div>

  {/* 中间 - 弹性区域 */}
  <div className="flex-1 min-w-0">
  </div>

  {/* 右侧 - 280px，带左侧细线分隔 */}
  <div className="w-[280px] border-l border-border/50 shrink-0">
  </div>
</div>
```

---

## Task 4: 验证视觉效果

- [ ] **Step 1: 启动开发服务器**
- [ ] **Step 2: 访问 /workspace 页面**
- [ ] **Step 3: 截图对比优化前后效果**
- [ ] **Step 4: 确认三个区域视觉层级清晰**
