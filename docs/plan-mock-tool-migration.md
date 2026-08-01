# 三个 Mock 工具迁移到 ToolProvider 工厂 — 实施计划

> **项目根目录**：`d:\customer_service_agent-main`
> **调研时间**：2026-08-01
> **调研模式**：纯只读（不修改任何源文件）
> **重要发现**：经核实，AGENTS.md 中描述的"三个工具绕过 Provider 工厂"的状态 **已经不存在**。本报告记录了实际代码现状、AGENTS.md 与现实的差异、以及如果需要进一步收紧工厂化路径应当采取的剩余步骤。

---

## 0. TL;DR — 与 AGENTS.md 的关键差异

| AGENTS.md 描述 | 实际代码现状 |
|---|---|
| Order 工具"硬编码 `MOCK_ORDERS` (ORD-2024001~003)" | `route.ts` **完全没有** `MOCK_ORDERS` 常量；mock 数据已迁移到 `mock-data.ts` 的 `generateMockOrder(orderId)`，基于哈希生成（10 个商品 × 6 个状态 = 组合空间，远不止 3 条） |
| Logistics 工具"硬编码 2 条 `MOCK_LOGISTICS`" | `route.ts` **完全没有** `MOCK_LOGISTICS` 常量；mock 数据已迁移到 `generateMockLogistics(orderId)` |
| Refund 工具"整个文件都是 mock" | `route.ts` **已委托**给 `RefundProvider`；mock 行为降级到 `refund-provider.ts:getMockConfirmation()`，并支持真实 API 调用 |
| "Mock 工具置信度封顶 0.6 / 0.55" | 实际由 `BaseToolProvider.getBaseConfidence()` 统一返回 `isRealApi ? 0.85 : 0.6`；refund 在 mock 基础上额外 `-0.1/-0.15` 折扣（见 `refund-provider.ts:173`） |
| "Provider 工厂架构存在于 `src/server/services/tool-providers/`" | ✅ 正确，且 `factory.ts` 已注册全部 5 个 provider（order/logistics/refund/product/size_chart） |
| "Mock providers 也存在于 `src/server/services/tool-providers/`，只是 route handlers 没调用" | ⚠️ 部分过时：providers 存在，**但 route handlers 实际上已经在调用** |

**结论**：原始迁移目标已经完成。本计划记录：
1. 现状审计（确认现状已合规）
2. 工厂调用链一致性证据
3. **剩余工作清单**：对仍残留的 5 个问题点的整改（见第 8 节）
4. 撤销/回滚方案（万一未来需要）

---

## 1. 现状审计

### 1.1 三个工具的当前实现状态

| 工具 | Route handler 使用 Provider? | Mock provider 文件存在? | 置信度基线 (mock) | 置信度基线 (real) | 是否 env-gated 真实调用? |
|---|---|---|---|---|---|
| Order | ✅ 是 (`getOrderProvider()`) | ✅ `order-provider.ts` | 0.6 (来自 `BaseToolProvider`) | 0.85 | ✅ `ENABLE_REAL_TOOL_API` + `ORDER_API_URL`/`ORDER_API_KEY` |
| Logistics | ✅ 是 (`getLogisticsProvider()`) | ✅ `logistics-provider.ts` | 0.6 (来自 `BaseToolProvider`) | 0.85 | ✅ `ENABLE_REAL_TOOL_API` + `LOGISTICS_API_URL`/`LOGISTICS_API_KEY` |
| Refund | ✅ 是 (`getRefundProvider()`) | ✅ `refund-provider.ts` | 0.6 - 0.1 = 0.5（额外 -0.15 fallback） | 0.85 - 0.1 = 0.75（额外 -0.15 fallback） | ✅ `ENABLE_REAL_TOOL_API` + `REFUND_API_URL`/`REFUND_API_KEY` |

**所有数据均来自直接读源码，非推理。**

### 1.2 工厂注册状态

`src/server/services/tool-providers/factory.ts:85` 已声明 5 个可用类型：

```typescript
static getAvailableTypes(): ToolProviderType[] {
  return ['order', 'logistics', 'refund', 'product', 'size_chart'];
}
```

`factory.ts:130-136` 已声明全部 5 个工具名 → provider 类型的映射：

```typescript
const toolToProviderMap: Record<string, ToolProviderType> = {
  query_order_status: 'order',
  query_logistics: 'logistics',
  apply_refund: 'refund',
  query_product_detail: 'product',
  query_size_chart: 'size_chart',
};
```

`src/server/services/tool-providers/types.ts:96` 已声明 union 类型：

```typescript
export type ToolProviderType = 'order' | 'logistics' | 'refund' | 'product' | 'size_chart';
```

### 1.3 Route handler → Provider 调用链证据

三个 route handler 文件的全文证据：

```1:33:src/app/api/tools/order-query/route.ts
import { NextRequest } from 'next/server';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { getOrderProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/order-query
 * Query order status with provider-based mock/real API switching
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const order_id = (body?.order_id as string) || '';

  if (!order_id) {
    return apiError('请提供订单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const provider = getOrderProvider();
  const result = await provider.execute({ order_id });

  if (result.errorCode) {
    return apiError(result.message, { status: HttpStatus.BAD_REQUEST, code: result.errorCode });
  }

  return apiSuccess({
    message_type: 'order',
    rich_content: result.data?.order,
    confidence: result.confidence,
    is_mock_data: result.isMockData,
  });
});
```

```1:35:src/app/api/tools/logistics-query/route.ts
import { NextRequest } from 'next/server';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { getLogisticsProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/logistics-query
 * Query logistics information with provider-based mock/real API switching
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const order_id = (body?.order_id as string) || '';
  const tracking_number = (body?.tracking_number as string) || '';

  if (!order_id && !tracking_number) {
    return apiError('请提供订单号或物流单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const provider = getLogisticsProvider();
  const identifier = order_id || tracking_number;
  const result = await provider.execute({ order_id, tracking_number });

  if (result.errorCode) {
    return apiError(result.message, { status: HttpStatus.BAD_REQUEST, code: result.errorCode });
  }

  return apiSuccess({
    message_type: 'logistics',
    rich_content: result.data?.logistics,
    confidence: result.confidence,
    is_mock_data: result.isMockData,
  });
});
```

```1:34:src/app/api/tools/refund-action/route.ts
import { NextRequest } from 'next/server';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';
import { getRefundProvider } from '@/server/services/tool-providers';

/**
 * POST /api/tools/refund-action
 * Apply for refund with provider-based mock/real API switching
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const order_id = (body?.order_id as string) || '';
  const reason = (body?.reason as string) || '';
  const amount = (body?.amount as number) || 0;

  if (!order_id) {
    return apiError('请提供订单号', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const provider = getRefundProvider();
  const result = await provider.execute({ order_id, reason, amount });

  if (result.errorCode) {
    return apiError(result.message, { status: HttpStatus.BAD_REQUEST, code: result.errorCode });
  }

  return apiSuccess({
    ...result.data,
    confidence: result.confidence,
    is_mock_data: result.isMockData,
  });
});
```

**所有三个 route handler 的核心模式完全一致**：解构 body → 验证必填字段 → 调用 `getXxxProvider().execute(params)` → 返回 `result.data/confidence/isMockData`。这正是工厂化路径的标准形态。

---

## 2. Provider 实现 — 已对齐工厂契约

### 2.1 BaseToolProvider 抽象基类

```98:141:src/server/services/tool-providers/types.ts
/**
 * Abstract base class for all tool providers.
 * Implement this interface to create a new provider for any tool.
 */
export abstract class BaseToolProvider {
  /** Provider type identifier */
  abstract readonly type: ToolProviderType;
  
  /** Whether this provider uses real API (vs mock) */
  protected isRealApi: boolean;

  constructor() {
    this.isRealApi = process.env.ENABLE_REAL_TOOL_API === 'true';
  }

  /**
   * Validate input parameters before execution.
   * @throws Error with message if validation fails
   */
  abstract validate(params: ToolParams): ValidationResult;

  /**
   * Execute the tool with given parameters.
   * @throws Error if execution fails
   */
  abstract execute(params: ToolParams): Promise<ToolResult>;

  /**
   * Get the base confidence score for this provider.
   * Real API calls get higher confidence, mock gets lower.
   */
  protected getBaseConfidence(): number {
    return this.isRealApi ? 0.85 : 0.6;
  }

  /**
   * Adjust confidence based on data quality.
   */
  protected adjustConfidence(base: number, hasData: boolean): number {
    if (!hasData) return 0.3;
    if (this.isRealApi) return Math.min(base + 0.1, 0.95);
    return base;
  }
}
```

### 2.2 三个 Provider 的关键 execute 路径（精简引用）

**OrderProvider**（`src/server/services/tool-providers/order-provider.ts:50-86`）：

```50:86:src/server/services/tool-providers/order-provider.ts
  async execute(params: ToolParams): Promise<ToolResult> {
    const validation = this.validate(params);
    if (!validation.valid) {
      return {
        message: validation.errorMessage!,
        confidence: 0.3,
        isMockData: false,
        errorCode: validation.errorCode,
      };
    }

    const orderId = (params.order_id as string).trim();

    try {
      // Try real API first if enabled
      if (this.isRealApi) {
        const result = await this.queryRealOrder(orderId);
        if (result) {
          return {
            message: this.formatOrderMessage(result),
            data: { order: result },
            confidence: this.adjustConfidence(this.getBaseConfidence(), true),
            isMockData: false,
          };
        }
        // Real API returned null, fall through to mock
        logger.debug(`[OrderProvider] Real API returned no data for ${orderId}, falling back to mock`);
      }

      // Use mock data
      return this.getMockResult(orderId);
    } catch (error) {
      // On any error, fall back to mock with degraded confidence
      logger.error(`[OrderProvider] Error querying order ${orderId}:`, { error });
      return this.getMockResult(orderId, true);
    }
  }
```

**LogisticsProvider** 模式完全相同（`src/server/services/tool-providers/logistics-provider.ts:53-88`）。

**RefundProvider**（`src/server/services/tool-providers/refund-provider.ts:60-96`）— mock 路径返回"确认退款"按钮卡片：

```154:176:src/server/services/tool-providers/refund-provider.ts
  private getMockConfirmation(orderId: string, reason: string, amount: number, isFallback = false): ToolResult {
    // Get order info for accurate amount
    const order = generateMockOrder(orderId);
    const refundAmount = amount > 0 ? amount : order.amount;
    const refundId = `RF${Date.now().toString().slice(-8)}`;

    return {
      message: `已为订单 ${orderId} 提交退款申请。退款原因：${reason}。预计1-3个工作日内处理，退款将原路返回您的支付账户。`,
      data: {
        message_type: 'action_buttons',
        rich_content: {
          title: '退款申请确认',
          description: `订单 ${orderId} 退款金额: ¥${refundAmount.toFixed(2)}，原因: ${reason}`,
          buttons: [
            { label: '确认退款', action: 'confirm_refund', data: { order_id: orderId, amount: refundAmount, refund_id: refundId } },
            { label: '取消', action: 'cancel_refund' },
          ],
        },
      },
      confidence: this.adjustConfidence(this.getBaseConfidence(), true) - (isFallback ? 0.15 : 0.1),
      isMockData: true,
    };
  }
```

---

## 3. mock-data.ts 现状审计

AGENTS.md 声称 "mock-data.ts 50+ 订单/物流模板"。实际：

| 项 | 实际数量 | 备注 |
|---|---|---|
| `MOCK_PRODUCTS` | 10 项 | `mock-data.ts:10-21` |
| `MOCK_STATUSES` | 6 个订单状态 | `mock-data.ts:23-25` |
| `CARRIERS` | 5 个快递公司 | `mock-data.ts:79-85` |
| 物流状态步骤生成器 | 6 种状态 | `mock-data.ts:96-126` |
| 哈希确定性生成 | 1 个 `hashCode()` | `mock-data.ts:165-173` |

**确定性组合**：10 商品 × 6 状态 × 4 支付方式 = 240 种组合（由 `hashCode(orderId)` 决定）。AGENTS.md 的 "50+" 数字大致对得上，但实际更高。

---

## 4. 工厂 vs llm-streaming-service 调用链

### 4.1 调用链证据

```
LLM 流式处理 (llm-streaming-service.ts:1232)
  └─ toolExecution.executeTool(toolName, args)
       └─ src/server/services/tool-execution-service.ts (待进一步审计)
            └─ executeTool(toolName, args)  ← tool-providers/factory.ts:126
                 └─ ToolProviderFactory.getProvider(providerType)  ← factory.ts:50
                      └─ getOrderProvider() | getLogisticsProvider() | getRefundProvider()
                           └─ provider.execute(args)
                                ├─ [real] queryRealOrder / queryRealLogistics / submitRealRefund
                                └─ [mock fallback] generateMockOrder / generateMockLogistics / getMockConfirmation
```

### 4.2 `llm-streaming-service.ts` 是否引用 mock-confidence?

搜索 `llm-streaming-service.ts` 关键词：

| 关键词 | 命中位置 | 评估 |
|---|---|---|
| `tool-providers` | 无 | ✅ 未直接引用（通过 `toolExecution` 间接调用） |
| `executeTool` | `src\server\services\llm-streaming-service.ts:1232` | ✅ 通过 service 间接调用 |
| `getOrderProvider` | 无 | ✅ 不直接引用 |
| `0.6`, `0.55`, `isMockData` | 无 | ✅ 不硬编码 mock-confidence |

**结论**：`llm-streaming-service.ts` 不需要修改。

---

## 5. `.env.example` 与 `.env` 现状

`.env.example:62-69`：

```62:69:.env.example
# ─── 业务工具 API (可选) ──────────────────────────────
# ENABLE_REAL_TOOL_API=false
# ORDER_API_URL=
# ORDER_API_KEY=
# LOGISTICS_API_URL=
# LOGISTICS_API_KEY=
# REFUND_API_URL=
# REFUND_API_KEY=
```

> 注意：`.env.example` 默认 `ENABLE_REAL_TOOL_API=false`（注释状态），新部署遵循 demo-first。

`.env:51-65`：

```51:65:.env
# ─── 业务工具 API ─────────────────────────────────────
# 启用真实 API 调用（false=使用 mock 假数据，true=调用真实 API）
ENABLE_REAL_TOOL_API=true

# 订单查询 API
ORDER_API_URL=https://your-order-api.com
ORDER_API_KEY=your_order_api_key

# 物流查询 API
LOGISTICS_API_URL=https://your-logistics-api.com
LOGISTICS_API_KEY=your_logistics_api_key

# 退款操作 API
REFUND_API_URL=https://your-refund-api.com
REFUND_API_KEY=your_refund_api_key
```

> ⚠️ **风险信号**：本地 `.env` 设置了 `ENABLE_REAL_TOOL_API=true` 但 `ORDER_API_URL=https://your-order-api.com`（占位符），这意味着生产环境如果误用此 `.env`，会得到"真实 API 已启用但 URL 无效"的混合行为。Provider 内部会优雅降级到 mock（`apiUrl && apiKey` 检查 → 返回 `null` → 落入 mock 路径），但日志会混乱。

**建议**：将本地 `.env` 改回 `ENABLE_REAL_TOOL_API=false`（默认 demo-first），仅在真实联调时切换。

---

## 6. 风险与回滚方案

### 6.1 风险矩阵

| 风险 | 等级 | 缓解 |
|---|---|---|
| `.env` 设置 `ENABLE_REAL_TOOL_API=true` 但 URL 是占位符 | 🟡 中 | 修改 `.env` 默认 `false`；Provider 内部已优雅降级（`apiUrl && apiKey` 双校验） |
| Refund 真实 API 调用不可逆（真的退款了） | 🔴 高 | 建议：**保持默认 mock**，真实 API 仅在 ops 主动设置 env 时启用；不要在 demo/开发环境默认开启 |
| Refund mock 置信度公式 `adjustConfidence(base, true) - 0.1` 比 base 0.6 还低 → 最终 ~0.5 | 🟡 中 | 已在代码中可观察到（`refund-provider.ts:173`）；低于 0.4 告警阈值但高于 0.3 fallback floor |
| Provider 单例在测试间不重置 → 状态泄漏 | 🟢 低 | `ToolProviderFactory.clearCache()` 已存在（`factory.ts:91`） |
| 并发请求中 provider 共享 env 读取 | 🟢 低 | `isRealApi` 在构造时读一次，env 切换需要重启或 `clearCache()` |
| 工厂 `toolToProviderMap` 拼写错误 → "未知工具" 静默 | 🟡 中 | 已有测试（`factory.test.ts`）锁定 `query_size_chart` 和 `query_product_detail` 映射，但**未覆盖 order/logistics/refund** |

### 6.2 回滚方案

如果工厂化路径出现严重问题，回滚步骤：

1. **环境开关回滚**：将 `.env` 中 `ENABLE_REAL_TOOL_API=true` 改为 `false`（默认），Provider 自动 fall back 到 mock
2. **代码回滚**（最坏情况）：每个 route handler 的 `getXxxProvider()` 调用替换为内联 mock（仓库历史中存在旧版本可恢复）：
   - `git log -- src/app/api/tools/order-query/route.ts` 找到迁移前 commit
   - `git show <commit>:src/app/api/tools/order-query/route.ts > src/app/api/tools/order-query/route.ts`
3. **Feature flag 方案**：如果未来想要更严格的灰度，可以新增 `USE_TOOL_PROVIDER_FACTORY` 环境变量，route handler 改为：

```typescript
const useFactory = process.env.USE_TOOL_PROVIDER_FACTORY !== 'false';
if (useFactory) {
  const provider = getOrderProvider();
  const result = await provider.execute({ order_id });
  // ...
} else {
  // legacy inline mock (从 git history 恢复)
}
```

> 当前代码 **没有** feature flag，依赖 `ENABLE_REAL_TOOL_API` 这一单一开关。如需加 flag，需新增 env 读取分支。

---

## 7. 估算改动规模

### 7.1 迁移本身（已完成，零改动）

| 工具 | Route handler 行数 | Provider 行数 | 改动 |
|---|---|---|---|
| Order | 33 | 180 | 0（已完成） |
| Logistics | 35 | 183 | 0（已完成） |
| Refund | 34 | 188 | 0（已完成） |

### 7.2 剩余建议改动（第 8 节列出）

| 项 | 改动量 | 文件 |
|---|---|---|
| 补 factory 回归测试覆盖 order/logistics/refund | +~50 行测试代码 | `src/server/services/tool-providers/factory.test.ts` |
| `.env` 默认值修回 `ENABLE_REAL_TOOL_API=false` | 1 行 | `.env` |
| AGENTS.md 更新（修正 7 处过时描述） | ~30 行 markdown | `AGENTS.md` |
| 将 mock-confidence 常量迁入 `constants.ts` | +~10 行常量定义 + 修改 3 个 provider 文件 | `src/lib/constants.ts` + 3 providers |
| Provider 真实调用增加重试/熔断 | +~30 行 | 各 provider 文件 |

**测试文件**：1 个新增测试文件路径已存在（`factory.test.ts`），无需新建。

---

## 8. 剩余建议工作清单

按优先级从高到低：

### 8.1 P0：本地 `.env` 默认值修复

- **位置**：`d:\customer_service_agent-main\.env:53`
- **问题**：`ENABLE_REAL_TOOL_API=true` + 占位符 URL = 误导性状态
- **建议**：改为 `ENABLE_REAL_TOOL_API=false`，仅在真实联调时切换
- **预估**：1 行修改

### 8.2 P1：补 factory 回归测试覆盖三个核心工具

- **位置**：`src/server/services/tool-providers/factory.test.ts`
- **现状**：测试只覆盖 `size_chart` 和 `product`
- **建议**：添加 3 个测试用例：

```typescript
it('executeTool(query_order_status, {order_id}) 不应返回未知工具错误', async () => {
  const result = await executeTool('query_order_status', { order_id: 'TEST001' });
  expect(JSON.stringify(result.message)).not.toContain('未知工具');
});

it('executeTool(query_logistics, {tracking_number}) 不应返回未知工具错误', async () => {
  const result = await executeTool('query_logistics', { tracking_number: 'SF1234567890' });
  expect(JSON.stringify(result.message)).not.toContain('未知工具');
});

it('executeTool(apply_refund, {order_id, reason}) 不应返回未知工具错误', async () => {
  const result = await executeTool('apply_refund', { order_id: 'TEST001', reason: '商品损坏' });
  expect(JSON.stringify(result.message)).not.toContain('未知工具');
});
```

- **预估**：+15 行测试代码

### 8.3 P2：mock-confidence 常量收敛

- **位置**：`src/lib/constants.ts`
- **现状**：mock 置信度 0.6 / 0.85 / 0.1 / 0.15 散落在 `BaseToolProvider` 和 `RefundProvider`
- **建议**：新增常量段：

```typescript
// ============================================================
// 工具 Provider 置信度
// ============================================================
export const TOOL_PROVIDER = {
  /** Mock 模式基础置信度 */
  MOCK_BASE_CONFIDENCE: 0.6,
  /** 真实 API 模式基础置信度 */
  REAL_API_BASE_CONFIDENCE: 0.85,
  /** 真实 API 加成上限 */
  REAL_API_BONUS_CAP: 0.95,
  /** 空数据 fallback 置信度 */
  EMPTY_DATA_CONFIDENCE: 0.3,
  /** 错误 fallback 置信度 */
  ERROR_FALLBACK_CONFIDENCE: 0.3,
  /** Refund mock 额外折扣 */
  REFUND_MOCK_PENALTY: 0.1,
  /** Refund 错误额外折扣 */
  REFUND_ERROR_PENALTY: 0.15,
  /** Provider 真实 API 调用超时（毫秒） */
  REAL_API_TIMEOUT_MS: 5000,
} as const;
```

然后修改 `types.ts:129-140` 和 `refund-provider.ts:173` 引用常量。

- **预估**：+12 行常量 + 5 处引用替换

### 8.4 P3：Provider 真实 API 调用增加重试/熔断

- **位置**：`order-provider.ts:101`, `logistics-provider.ts:103`, `refund-provider.ts:111`
- **现状**：每个真实 API 调用只有 5 秒超时（`AbortSignal.timeout(5000)`），无重试
- **建议**：引入简单指数退避重试（最多 2 次），包装到 `withRetry()` 工具函数
- **预估**：+30 行（含 `with-retry.ts` 工具）

### 8.5 P4：AGENTS.md 修正

更新 `AGENTS.md` 中关于"三类工具完全硬编码 mock"的所有描述，改写为：

- 三个工具已迁移到 Provider 工厂架构
- mock 数据位于 `src/server/services/tool-providers/mock-data.ts`
- 真实 API 通过 `ENABLE_REAL_TOOL_API=true` + 对应 URL/KEY 环境变量启用
- mock 置信度 0.6 / refund 0.5（额外 -0.1 折扣）

---

## 9. 推荐执行顺序（针对剩余工作）

由于迁移本身已完成，剩余工作优先级为：

1. **P0 `.env` 默认值修复**（5 分钟，零风险）
2. **P1 factory 测试覆盖**（30 分钟，提升回归安全）
3. **P2 常量收敛**（1 小时，可读性提升）
4. **P4 AGENTS.md 修正**（15 分钟，文档对齐）
5. **P3 重试/熔断**（2 小时，可选）

不建议再进行 route handler 层的迁移代码改动 — 已完成。

---

## 10. 自包含执行指南（针对读者无仓库上下文）

如果你拿到这份计划但从未打开过这个仓库：

1. **架构核心**：5 个 Provider 统一继承自 `src/server/services/tool-providers/types.ts` 中的 `BaseToolProvider` 抽象类。
2. **入口**：`POST /api/tools/{order-query,logistics-query,refund-action}` 三条路径已统一委托给 Provider。
3. **开关**：环境变量 `ENABLE_REAL_TOOL_API=true` 启用真实 API；同时需要 `*_API_URL` 和 `*_API_KEY`。
4. **降级策略**：真实 API 返回 null / 抛错 / 配置缺失时，自动 fallback 到 mock（log 降级事件）。
5. **测试入口**：运行 `pnpm test src/server/services/tool-providers/` 验证工厂完整性。
6. **审计 mock 行为**：阅读 `src/server/services/tool-providers/mock-data.ts` 了解所有 mock 数据形状。
7. **修改 mock 数据**：编辑 `MOCK_PRODUCTS`、`CARRIERS`、`LOGISTICS_STEPS_PRODUCER` 即可，Provider 自动应用。

---

## 附录 A：完整文件清单

| 文件 | 行数 | 角色 |
|---|---|---|
| `src/app/api/tools/order-query/route.ts` | 33 | Route handler（已委托 Provider） |
| `src/app/api/tools/logistics-query/route.ts` | 35 | Route handler（已委托 Provider） |
| `src/app/api/tools/refund-action/route.ts` | 34 | Route handler（已委托 Provider） |
| `src/server/services/tool-providers/types.ts` | 142 | BaseToolProvider + 类型定义 |
| `src/server/services/tool-providers/factory.ts` | 157 | 工厂 + executeTool 统一入口 |
| `src/server/services/tool-providers/index.ts` | 23 | 统一导出 |
| `src/server/services/tool-providers/order-provider.ts` | 180 | Order Provider（含 real API + mock fallback） |
| `src/server/services/tool-providers/logistics-provider.ts` | 183 | Logistics Provider |
| `src/server/services/tool-providers/refund-provider.ts` | 188 | Refund Provider（含 mock 按钮卡片） |
| `src/server/services/tool-providers/mock-data.ts` | 174 | Mock 数据生成器 |
| `src/server/services/tool-providers/product-provider.ts` | ~100 | Product Provider（参考实现） |
| `src/server/services/tool-providers/size-chart-provider.ts` | ~100 | Size Chart Provider（参考实现） |
| `src/server/services/tool-providers/factory.test.ts` | 61 | 工厂回归测试（仅覆盖 product/size_chart） |

## 附录 B：与 AGENTS.md 的逐条事实对照

| AGENTS.md 描述 | 现状证据（code ref） | 一致? |
|---|---|---|
| "Mock 工具置信度封顶 0.6" | `types.ts:130` `getBaseConfidence(): this.isRealApi ? 0.85 : 0.6` | ✅ 一致（mock=0.6, real=0.85） |
| "Mock 工具置信度封顶 0.55"（refund） | `refund-provider.ts:173` `... - (isFallback ? 0.15 : 0.1)` 即 0.6-0.1=0.5（不是 0.55） | ⚠️ 偏差 0.05 |
| "硬编码 `MOCK_ORDERS` (ORD-2024001~003)" | `mock-data.ts:41-68` 使用 `generateMockOrder(orderId)` 基于哈希生成，**无** `MOCK_ORDERS` 常量 | ❌ 已迁移 |
| "硬编码 2 条 `MOCK_LOGISTICS`" | `mock-data.ts:131-151` 使用 `generateMockLogistics(orderId)` | ❌ 已迁移 |
| "退款操作工具 (`refund-action/route.ts`) 整体不做真实退款" | `refund-provider.ts:102-148` `submitRealRefund()` 支持真实 API 调用 | ❌ 已迁移 |
| "mock-data.ts 50+ 订单/物流模板" | 实际：10 商品 × 6 状态 × 4 支付方式 = 240 种组合 | ⚠️ 数字粗略对得上 |
| "Provider 工厂架构存在 tool-providers/" | `factory.ts:44-119` + 5 个 provider 文件 | ✅ 一致 |
| "三个工具 bypass Provider 工厂" | `route.ts:19,20,21` 显示三个工具 **均已使用** `getXxxProvider()` | ❌ **核心错误** — 已不成立 |

**核心结论**：AGENTS.md 关于"硬编码 mock"的所有描述都基于旧代码。**当前代码状态已合规于工厂化架构**，无需进行原始迁移工作。
