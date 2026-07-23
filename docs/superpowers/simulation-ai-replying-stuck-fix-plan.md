# Bug Fix: AI 正在回复状态在页面切换后卡死

**日期**: 2026-07-17
**状态**: ✅ 已修复

## 问题描述

**用户描述**: "模拟测试模块中，用户发送消息后，AI正在思考，此时切换到别的页面，再回到模拟测试中，该会话会一直显示'AI正在回复'"

**影响范围**:
- 模拟测试模块 (`/simulation`)
- 真实对话监控 (`/`, 监控页面)
- 真实对话聊天 (`/chat`, 坐席工作台)

---

## 根本原因

### 架构缺陷: UI 状态不是"单一真实来源"

问题代码路径:

1. 用户发送消息 → 前端 `handleSendMessage` 发起 SSE 流
2. 流开始 → 前端设置 `isAIReplying = true` (React `useState`)
3. 用户切换页面 → React 组件卸载 (`useState` 状态丢失)
4. 用户切回来 → 前端从数据库加载消息列表,根据"最后一条消息是否为 user 角色"猜测 `isAIReplying`
5. 如果 AI 回复消息已写入数据库 → 最后一条是 assistant → 正确显示
6. **如果 AI 回复尚未写入**(异步操作未完成) → 最后一条仍是 user → `isAIReplying = true` 卡死

```
用户发消息
  ↓
前端设置 isAIReplying=true (内存状态)
  ↓
用户切走 → 组件卸载 → 状态丢失
  ↓
用户切回 → 从 DB 加载
  ↓
最后一条是 user → 重新猜测 isAIReplying=true
  ↓
AI 回复未完成 → 一直显示"AI正在回复" ← BUG
```

### 为什么这是根本原因

局部打补丁无法解决:
- 增加轮询频率 → 仍依赖启发式判断,无法区分"真正等待中"vs"已结束但 DB 未刷新"
- 延长超时时间 → 治标不治本,极端情况仍会卡死
- 在组件卸载时发 cleanup 请求 → 网络不可靠,请求可能失败

**正确解法**: 将"AI 是否正在回复"建模为数据库状态字段,前端直接从 DB 读取,不再依赖启发式判断。

---

## 修复方案

### 核心改动: 新增 `ai_processing` 数据库字段

**两张表都添加**:

| 表 | 新增列 |
|---|--------|
| `simulation_conversations` | `ai_processing BOOLEAN DEFAULT FALSE`, `ai_processing_started_at TIMESTAMPTZ` |
| `conversations` | `ai_processing BOOLEAN DEFAULT FALSE`, `ai_processing_started_at TIMESTAMPTZ` |

**设计原则**:

1. **写入时机**: `POST /messages` 开始处理时设置 `ai_processing=true`
2. **清除时机**: 流结束后(无论成功/超时/错误)在 `finally` 块中设置为 `false`
3. **staleness 自愈**: `ai_processing_started_at` 超过 5 分钟自动视为过期,前端不显示"AI正在回复"
4. **前端派生**: 前端从 DB 字段直接派生 UI 状态,不再维护独立 React state

---

## 文件改动清单

### Phase 5a: 模拟测试模块 (9 个文件)

| # | 文件 | 改动 |
|---|------|------|
| 1 | `supabase/migrations/20260717_simulation_ai_processing_status.sql` | 新增列 + 索引 |
| 2 | `src/lib/types.ts` | `SimulationConversation` 接口新增 `ai_processing`, `ai_processing_started_at` |
| 3 | `src/server/repositories/simulation-repository.ts` | `CONVERSATION_SELECT` 包含新列; 新增 `markAiProcessing()`, `clearAiProcessing()` 方法 |
| 4 | `src/app/api/simulations/[id]/messages/route.ts` | 流开始前调用 `markAiProcessing`; 每个终端分支调用 `clearAiProcessing`; GET 返回新列 |
| 5 | `src/lib/ai-processing-status.ts` | 新增 `resolveAiProcessingState()` — staleness 检测核心逻辑 |
| 6 | `src/lib/ai-processing-status.test.ts` | 8 个单元测试覆盖所有边界情况 |
| 7 | `src/server/repositories/simulation-repository.test.ts` | 2 个集成测试覆盖 demo mode |
| 8 | `src/components/simulation/simulation-page.tsx` | sidebar badge 和 polling 逻辑改用 DB 派生 |
| 9 | `scripts/verify-ai-processing-status.sh` | 端到端验证脚本 |

### Phase 5b: 真实对话模块 (6 个文件)

| # | 文件 | 改动 |
|---|------|------|
| 10 | `supabase/migrations/20260717_conversation_ai_processing_status.sql` | 新增列 + 索引 |
| 11 | `src/lib/types.ts` | `Conversation` 接口新增 `ai_processing`, `ai_processing_started_at` |
| 12 | `src/server/repositories/conversation-repository.ts` | `CONVERSATION_LIST_SELECT` 包含新列; 新增 `markAiProcessing()`, `clearAiProcessing()` |
| 13 | `src/server/services/llm-streaming-service.ts` | 流 finally 块调用 `clearAiProcessing` |
| 14 | `src/app/api/conversations/[id]/messages/route.ts` | auto-reply/sub-agent/stream-init 各路径调用 mark/clear |
| 15 | `src/components/monitor/conversation-monitor-list.tsx` | sidebar badge 改用 DB 派生 |
| 16 | `src/components/chat/chat-page.tsx` | `loadMessages` 改用 DB 派生 `isSending` 状态 |

---

## 关键实现细节

### 1. Staleness 检测 (self-healing)

```typescript
// ai-processing-status.ts
const STALE_AFTER_MS = 5 * 60 * 1000; // 5 分钟

export function resolveAiProcessingState(aiProcessing, aiProcessingStartedAt, nowMs) {
  if (!aiProcessing) return { isProcessing: false, isStale: false, raw: false };
  if (!aiProcessingStartedAt) return { isProcessing: true, isStale: false, raw: true };
  const isStale = (nowMs - Date.parse(aiProcessingStartedAt)) > STALE_AFTER_MS;
  return { isProcessing: !isStale, isStale, raw: true, startedAt: aiProcessingStartedAt };
}
```

### 2. 后端 finally 块清理 (simulation route)

```typescript
// POST /simulations/[id]/messages
const assistantMsg = await simulationRepository.createMessage({...});
controller.enqueue(...);
await simulationRepository.clearAiProcessing(conversationId); // ← 关键
controller.close();
```

### 3. 前端 DB 派生 (sidebar badge)

```tsx
// simulation-page.tsx — sidebar
{resolveAiProcessingState(conv.ai_processing, conv.ai_processing_started_at).isProcessing && (
  <span><Loader2 className="animate-spin" />回复中</span>
)}
```

---

## 验证结果

### 单元测试 (10 个测试全部通过)

| 测试文件 | 测试数 | 状态 |
|---------|--------|------|
| `ai-processing-status.test.ts` | 8 | ✅ |
| `simulation-repository.test.ts` | 2 | ✅ |

### 端到端验证 (Node.js 脚本,真实数据库)

```
Step 1: Login                        [OK]
Step 2: Create simulation             [OK]
Step 3: Check ai_processing BEFORE   [OK] ai_processing=false
Step 4: Send message (SSE stream)    [OK] done:true found
Step 5: Check ai_processing AFTER    [OK] ai_processing=false ✓
Step 6: GET /messages includes field [OK]
Step 7: Cleanup                      [OK]
[PASS] All checks passed!
```

---

## 预防措施

### 架构层面

1. **数据库作为唯一真实来源**: UI 状态应由 DB 派生,避免组件 local state 作为"事实"
2. **流处理使用 try/finally**: 确保 cleanup 逻辑在所有退出路径执行
3. **staleness 自愈**: 任何状态字段都应有时间戳,支持异常恢复

### 代码规范

1. **禁止在组件内维护跨组件生命周期的异步状态**: 例如"是否正在处理"这类跨页面共享的状态,必须存在数据库中
2. **SSE 流完成后立即清除状态**: 在 `controller.close()` 前同步 await 清理
3. **时间戳不可缺**: 任何布尔状态字段必须配有对应的时间戳,支持 staleness 检测

### 测试覆盖

1. 每个新的 API 流处理路径必须验证 `ai_processing` 的写入/清除
2. 前端组件卸载/重挂场景必须有单元测试覆盖
