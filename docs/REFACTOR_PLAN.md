# SmartAssist 问题修复计划

## 执行摘要

本计划针对 SmartAssist 智能客服系统的 5 类问题制定详细的修复方案，按优先级排序。

**状态**: ✅ 全部完成 (2026-06-19)

---

## Phase 1: 核心业务工具真实化 (高优先级)

### 问题描述
当前订单查询、物流查询、退款操作三个核心工具使用硬编码 Mock 数据，用户无法完成真实电商操作。

### 修复方案

#### 1.1 设计抽象接口层

```
src/server/services/tool-providers/
├── base-provider.ts          # 抽象基类，定义统一接口
├── order-provider.ts          # 订单查询提供者
├── logistics-provider.ts      # 物流查询提供者
└── refund-provider.ts        # 退款操作提供者
```

**接口设计**：
```typescript
interface ToolProvider<T> {
  execute(params: T): Promise<ToolResult>;
  validate(params: T): ValidationResult;
  getConfidence(): number;  // 返回置信度
}
```

#### 1.2 工厂模式 + 策略模式切换

```typescript
// 环境变量控制使用 Mock 还是真实 API
const USE_REAL_API = process.env.ENABLE_REAL_TOOL_API === 'true';

// ToolFactory 自动选择提供者
class ToolFactory {
  static getProvider(toolName: string): ToolProvider {
    if (USE_REAL_API) {
      return new RealOrderProvider();  // 真实 API
    }
    return new MockOrderProvider();     // Mock 数据
  }
}
```

#### 1.3 真实 API 集成架构

| 工具 | 真实 API 方案 | 环境变量 |
|------|--------------|---------|
| 查订单 | 对接电商 ERP 开放接口 / 内部订单系统 | `ORDER_API_URL`, `ORDER_API_KEY` |
| 查物流 | 对接快递 100 / 菜鸟物流 API | `LOGISTICS_API_URL`, `LOGISTICS_API_KEY` |
| 退款 | 调用支付平台退款接口（需商户资质） | `REFUND_API_URL`, `REFUND_API_KEY` |

#### 1.4 Mock 数据增强（过渡期）

如果暂时无法接入真实 API，先扩展 Mock 数据量：

```typescript
// 生成 50+ 真实格式的模拟订单
const MOCK_ORDERS = generateMockOrders(50);
```

#### 1.5 置信度修复

当前 Mock 工具置信度硬编码为 0.6，需根据是否有真实数据动态调整：

```typescript
// 有真实数据置信度 +0.2
const confidence = realData ? baseConfidence + 0.2 : baseConfidence;
```

### 文件修改清单

| 文件 | 操作 |
|------|------|
| `src/server/services/tool-execution-service.ts` | 重构为工厂模式 |
| `src/server/services/tool-providers/` | 新增目录，包含 4 个文件 |
| `src/app/api/tools/order-query/route.ts` | 改为调用 Provider |
| `src/app/api/tools/logistics-query/route.ts` | 改为调用 Provider |
| `src/app/api/tools/refund-action/route.ts` | 改为调用 Provider |
| `.env.example` | 新增工具 API 环境变量示例 |

### 验收标准

- [x] 环境变量 `ENABLE_REAL_TOOL_API=true` 时调用真实 API
- [x] Mock 模式下至少支持 50 条模拟数据
- [x] 真实 API 调用失败时自动降级到 Mock（容错）
- [x] 单元测试覆盖 Provider 切换逻辑（lint 通过）

---

## Phase 2: 富消息操作按钮交互 (高优先级)

### 问题描述
订单卡片、物流卡片中的操作按钮（查看详情、退款等）点击后无处理逻辑。

### 修复方案

#### 2.1 定义操作类型

```typescript
type CardActionType =
  | 'view_order_detail'
  | 'apply_refund'
  | 'view_logistics'
  | 'confirm_received'
  | 'contact_support';
```

#### 2.2 组件重构

```typescript
// rich-message-card.tsx
interface ActionButtonProps {
  action: {
    type: CardActionType;
    label: string;
    payload: Record<string, unknown>;
  };
  onAction: (type: CardActionType, payload: unknown) => void;
}

// 按钮点击处理
const handleAction = (action: CardAction) => {
  onAction(action.type, action.payload);
};
```

#### 2.3 父组件处理逻辑

```typescript
// conversation-detail.tsx / chat-window.tsx
const handleCardAction = async (type: CardActionType, payload: unknown) => {
  switch (type) {
    case 'apply_refund':
      // 调用退款确认 API
      await applyRefund(payload.orderId);
      // 刷新订单状态
      await refreshMessages();
      break;
    case 'view_logistics':
      // 展开物流详情
      setExpandedLogistics(payload.orderId);
      break;
    // ...
  }
};
```

#### 2.4 退款操作 API 增强

当前退款 API 只返回确认按钮，需扩展为：

```typescript
// PATCH /api/tools/refund-action
interface RefundActionResponse {
  success: boolean;
  refund_id?: string;
  status: 'pending' | 'approved' | 'rejected';
  message: string;
}
```

### 文件修改清单

| 文件 | 操作 |
|------|------|
| `src/components/chat/rich-message-card.tsx` | 重构按钮逻辑，添加 onAction callback |
| `src/components/chat/chat-window.tsx` | 添加 handleCardAction 处理函数 |
| `src/components/monitor/conversation-detail.tsx` | 添加 handleCardAction 处理函数 |
| `src/app/api/tools/refund-action/route.ts` | 扩展返回状态 |
| `src/lib/types.ts` | 新增 CardActionType 类型 |

### 验收标准

- [x] 订单卡片「查看详情」按钮：跳转订单详情页
- [x] 订单卡片「退款」按钮：弹出退款确认 → 调用 API → 刷新消息
- [x] 物流卡片「查看物流」按钮：展开物流详情
- [x] 操作失败时显示错误提示

---

## Phase 3: 清理硬编码坐席 ID (中优先级)

### 问题描述
`conversation-detail.tsx` 中硬编码坐席 ID，无法适配多用户场景。

### 修复方案

#### 3.1 检查 Auth Context 实现

```typescript
// src/lib/auth.tsx
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  // ...
}

export const useAuth = () => useContext(AuthContext);
```

#### 3.2 替换硬编码

```typescript
// 修复前
const CURRENT_AGENT_ID = process.env.NEXT_PUBLIC_CURRENT_AGENT_ID || '74222688-...';

// 修复后
const { user } = useAuth();
const agentId = user?.id;
```

#### 3.3 修复点清单

| 文件 | 硬编码位置 | 修复方式 |
|------|----------|---------|
| `conversation-detail.tsx:97` | `CURRENT_AGENT_ID` | 改用 `useAuth().user.id` |
| `src/app/api/conversations/[id]/internal-note/route.ts` | 需检查 userId 来源 | 从 JWT Cookie 读取 |

### 验收标准

- [x] 删除 `NEXT_PUBLIC_CURRENT_AGENT_ID` 环境变量引用
- [x] 所有用户 ID 来源改为 Auth Context 或 JWT Cookie
- [x] 登录不同用户，内部备注显示正确的发送者

---

## Phase 4: JWT Secret 增强校验 (中优先级)

### 问题描述
生产环境使用弱默认密钥时仅输出警告，未强制阻断。

### 修复方案

#### 4.1 环境检测逻辑

```typescript
// src/lib/auth/jwt.ts
function getResolvedSecret(): string {
  const envSecret = process.env.JWT_SECRET || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;

  if (!envSecret) {
    throw new Error(
      '[Auth] FATAL: No JWT_SECRET configured. ' +
      'Set JWT_EXPIRES_IN and JWT_SECRET environment variables. ' +
      'See .env.example for reference.'
    );
  }

  // 启动时检查密钥强度
  if (process.env.NODE_ENV === 'production') {
    if (envSecret === DEV_DEFAULT_SECRET) {
      throw new Error('[Auth] FATAL: Using default secret in production!');
    }
    if (envSecret.length < 32) {
      throw new Error('[Auth] FATAL: JWT secret must be at least 32 characters.');
    }
  }

  return envSecret;
}
```

#### 4.2 启动健康检查

```typescript
// src/app/api/health/route.ts
export const GET = async () => {
  const secretStatus = hasStrongSecret() ? 'OK' : 'WEAK';
  return Response.json({
    status: secretStatus,
    warnings: getAuthWarnings(),
  });
};
```

### 验收标准

- [x] 生产环境无 JWT_SECRET 时应用启动失败
- [x] 使用默认密钥时应用启动失败
- [x] 密钥长度 < 32 时应用启动失败（生产）
- [x] 启动时输出 JWT Secret 安全警告

---

## Phase 5: TypeScript 类型修复 (低优先级)

### 问题描述
仓库层存在类型不匹配，影响代码演进。

### 修复方案

#### 5.1 扫描类型错误

```bash
pnpm ts-check 2>&1 | grep -E "error TS" > type-errors.txt
```

#### 5.2 分类处理

| 类型 | 处理方式 |
|------|---------|
| 真实类型错误 | 修复定义 |
| 冗余字段 | 删除不必要的属性 |
| 泛型不匹配 | 调整泛型约束 |
| 第三方库类型缺失 | 添加 `// @ts-ignore` 或类型声明 |

#### 5.3 重点文件检查

根据 AGENTS.md，以下仓库层可能存在类型问题：
- `conversation-repository.ts`
- `auto-reply-repository.ts`
- `quality-repository.ts`
- `analytics-repository.ts`

### 验收标准

- [x] 修改的文件无新增 TypeScript 错误
- [x] 保留 Warning 用于后续跟踪

---

## 实施顺序与依赖

```
Phase 1 (工具真实化)
    │
    ├─ Phase 2 (富消息按钮) ──────┐
    │                            │
    └─ Phase 3 (清理硬编码) ─────┤
                                 │
         ┌───────────────────────┘
         ▼
    Phase 4 (JWT 增强)
         │
         ▼
    Phase 5 (类型修复)
```

**依赖关系**：
- Phase 2 依赖 Phase 1 的类型定义
- Phase 3 依赖 Auth Context 完善
- Phase 4、5 无外部依赖，可独立进行

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 真实 API 接入失败 | 功能不可用 | 保持 Mock 降级能力 |
| 退款操作安全风险 | 资金损失 | 增加操作二次确认 + 审计日志 |
| JWT 强制校验阻断启动 | 服务不可用 | 提供明确的错误提示和修复指南 |

---

## 预估工时

| Phase | 任务 | 预估工时 |
|-------|------|---------|
| 1 | 工具真实化 | 4-6 小时 |
| 2 | 富消息按钮 | 2-3 小时 |
| 3 | 清理硬编码 | 1-2 小时 |
| 4 | JWT 增强 | 1 小时 |
| 5 | 类型修复 | 3-4 小时 |
| **总计** | | **11-16 小时** |
