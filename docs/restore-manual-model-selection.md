# 恢复手动模型选择功能

## 目标

在「设置 → AI 模型」中让管理员明确选择：

- **普通对话模型**：处理不含图片的消息。
- **多模态模型**：处理含图片的消息，且必须标记为支持视觉能力。

系统不再依据 `selectBestModel()` 自动变更管理员选中的模型或 Provider。模型选择错误、模型被禁用或 Provider 不可用时，应返回明确的配置错误，不应静默改用其他模型。

---

## 当前基线（2026-08-06）

### 数据模型

模型配置已完成迁移，唯一来源如下：

- `llm_providers`：Provider 的连接信息，例如 `base_url`、加密后的 `api_key`、是否启用。
- `llm_models`：Provider 下的具体模型，例如 `model_id`、`display_name`、`supports_vision`、`is_enabled`。

`llm_providers.models` 已移除，任何新代码或文档都不得使用该字段。

### 现有 API

```text
GET /api/llm-providers
  -> { providers: LlmProvider[] }

GET /api/llm-providers?provider_id=<providerId>
  -> { models: LlmModel[] }
```

模型列表必须通过第二个接口按 Provider 加载，而不是假定 Provider 响应内嵌 `models` 数组。

### 现有运行时行为

`src/app/api/conversations/[id]/messages/route.ts` 当前向 `LLMStreamingService.createStream()` 传递：

- `aiModel: undefined`
- `multimodalModel: undefined`
- 选中的 Provider 及其默认模型

`LLMStreamingService` 随后调用 `LlmProviderService.selectBestModel()` 自动选择聊天或视觉模型。因此，现有 `ai_model` / `multimodal_model` 设置值并未实际驱动对话模型。

---

## 设计决策

### 保存 `llm_models.id`，不要只保存 `model_id`

`model_id` 不是全局唯一值。同一个模型标识可以出现在多个 Provider 中，例如不同网关均可能配置 `gpt-4o`。如果设置中只保存 `model_id`，运行时仍需要依赖全局 `llm_provider_id` 推断归属，容易形成错误组合。

新增两个设置键：

| 设置键 | 值 | 用途 |
|---|---|---|
| `ai_model_id` | `llm_models.id` | 普通对话模型的记录 ID |
| `multimodal_model_id` | `llm_models.id` | 多模态模型的记录 ID |

`settings` 是键值存储，不需要为上述键新增表字段或执行 DDL 迁移。将两个键加入默认设置即可。

### Provider 选择的职责变化

手动选择的模型记录已经包含 `provider_id`，因此运行时应从模型记录取得 Provider，而不是使用 `llm_provider_id` 决定实际请求目标。

保留 `llm_provider_id` 仅用于 Provider 管理页的“当前 Provider”展示和编辑上下文；它不应覆盖手动选中的模型归属。

### 多模态模型的约束

多模态选择器只显示启用且 `supports_vision = true` 的模型。后端仍必须重新验证该约束，不能仅信任前端。

---

## 实施步骤

### 1. 默认设置与服务端设置解析

修改 `src/lib/settings-defaults.ts`，加入：

```typescript
ai_model_id: '',
multimodal_model_id: '',
```

保留已有 `ai_model` 和 `multimodal_model` 作为历史数据，不再在新的运行时逻辑中读取或写入它们。后续可在单独的数据清理版本中移除旧设置键。

在设置读取逻辑中，确保新增键作为普通字符串返回。

### 2. 增加按模型 ID 查询的服务能力

为 Repository 和 `LlmProviderService` 增加按 `llm_models.id` 查询模型的方法。返回值必须同时包含：

- 模型记录：`id`、`provider_id`、`model_id`、`display_name`、`supports_vision`、`is_enabled`
- Provider 记录：`id`、`base_url`、解密后的 `api_key`、`is_enabled`

建议定义一个专用运行时解析结果，避免消息路由和流式服务各自重复组装连接信息：

```typescript
interface ResolvedLlmModel {
  modelId: string;
  modelRecordId: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  supportsVision: boolean;
}
```

解析时必须失败关闭：

- 模型不存在或已禁用：返回配置错误。
- Provider 不存在、禁用或缺少有效 API Key：返回配置错误。
- 图片请求选择的模型不支持视觉：返回配置错误。

不要调用 `selectBestModel()` 作为隐式回退。

### 3. 更新 AI 设置前端

修改 `src/components/settings/ai-settings.tsx`。

#### 3.1 加载模型数据

先获取 Provider 列表，再并行加载每个 Provider 的模型：

```typescript
const providerResponses = await apiFetch('/api/llm-providers');
const { providers } = await providerResponses.json();

const modelEntries = await Promise.all(
  providers.map(async (provider) => {
    const response = await apiFetch(`/api/llm-providers?provider_id=${provider.id}`);
    const { models } = await response.json();
    return models.map((model: LlmModel) => ({ provider, model }));
  }),
);
```

仅向选择器提供启用的 Provider 和启用的模型。普通模型选择器显示所有已启用模型；多模态模型选择器仅显示 `supports_vision === true` 的模型。

#### 3.2 选择器值

选择器的 `value` 必须是模型记录 ID：

```tsx
<option value={entry.model.id}>
  {entry.model.display_name} ({entry.provider.display_name})
</option>
```

更新设置时写入：

```typescript
ai_model_id: selectedModelId
multimodal_model_id: selectedModelId
```

Provider Manager 创建、更新、删除或启用/禁用模型后，AI 设置页必须重新加载候选模型。若当前已选模型不再可用，保留设置值以便提示，但在选择器中显示“当前选择已不可用”，并阻止保存，或提示管理员重新选择。

### 4. 消息路由解析已选模型

修改 `src/app/api/conversations/[id]/messages/route.ts`。

在调用 `createStream()` 前：

1. 根据是否存在 `imageUrl` 选择 `appSettings.ai_model_id` 或 `appSettings.multimodal_model_id`。
2. 当图片识别已禁用时，保留当前固定话术或转人工分支，无需解析多模态模型。
3. 通过新增的 `LlmProviderService` 方法解析模型和 Provider。
4. 将已解析的模型 ID 与连接信息传给流式服务。

传入参数应类似：

```typescript
aiModel: textModel?.modelId,
multimodalModel: visionModel?.modelId,
llmProviderId: resolvedModel.providerId,
llmProviderBaseUrl: resolvedModel.baseUrl,
llmProviderApiKey: resolvedModel.apiKey,
```

避免再传递“当前 Provider 的默认模型”作为模型选择后备。没有明确模型配置时，返回 SSE 错误事件，提示管理员进入设置完成选择。

### 5. 流式服务按显式选择执行

修改 `src/server/services/llm-streaming-service.ts`。

模型决策应只有以下分支：

| 请求 | 条件 | 使用模型 |
|---|---|---|
| 纯文本 | 已配置普通模型 | `options.aiModel` |
| 纯文本 | 未配置普通模型 | 配置错误 |
| 图片 | 多模态关闭 | 当前固定话术或转人工策略 |
| 图片 | 已启用且已配置视觉模型 | `options.multimodalModel` |
| 图片 | 已启用但未配置视觉模型 | 配置错误 |

删除 `createStream()` 内调用 `selectBestModel()` 的路径，以及 `llmProviderDefaultModel` 对普通文本或图片请求的模型回退。Provider 凭据仅可用于已选模型所属的 Provider。

可保留 `LlmProviderService.selectBestModel()` 供其他明确需要自动推荐的功能使用，但它不得参与客服对话的运行时模型决策。

### 6. 管理操作的保护

删除或禁用模型、禁用 Provider 时，系统应检查它是否被 `ai_model_id` 或 `multimodal_model_id` 引用。允许操作时要在管理界面展示警告；运行时仍以明确配置错误处理，不能自动切换到其他模型。

---

## 测试验证

### 前端

1. 创建一个 Provider，并为它添加一个文本模型和一个视觉模型。
2. 在 AI 设置中选择普通模型和多模态模型，保存并刷新页面，确认选择保持。
3. 禁用或删除已选模型，确认页面提示当前选择不可用，并要求重新选择。
4. 验证多模态选择器不会列出不支持视觉的模型。

### 后端

1. 纯文本请求使用 `ai_model_id` 对应的 `model_id` 和所属 Provider 的连接信息。
2. 图片请求使用 `multimodal_model_id` 对应的 `model_id` 和所属 Provider 的连接信息。
3. 图片识别关闭时，不发起 LLM 请求，而是执行固定话术或转人工策略。
4. 缺少普通模型、多模态模型、Provider API Key，或模型已禁用时，返回具体配置错误且不自动回退。
5. 选择跨 Provider 的模型时，运行时使用模型自己的 `provider_id`，不受 UI 当前 `llm_provider_id` 影响。
6. 为 `LlmProviderService` 的模型解析方法补充单元测试，覆盖不存在、禁用、视觉能力不足、Provider 无密钥等失败场景。

---

## 迁移说明

此功能不需要修改 `settings` 表结构。部署代码后，管理员需要在设置页完成一次模型选择。

不建议使用固定模型名称批量回填，例如 `qwen2.5:7b`。模型 ID 和 Provider 配置由每个环境决定，固定名称可能指向不存在或不兼容的 API 模型。若需要预填，必须先按目标环境查询实际的 `llm_models.id`，再写入对应的设置键。

---

## 完成标准

- `llm_providers.models` 在文档和代码中均无引用。
- 管理员可选择并持久化文本与视觉模型。
- 运行时精确使用已选模型及其所属 Provider。
- 配置无效时系统给出明确错误，不静默选择其他模型。
- 自动选择逻辑不再影响客服对话。

**文档版本**：v2.0  
**更新日期**：2026-08-06
