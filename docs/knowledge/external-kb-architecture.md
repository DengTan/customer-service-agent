# 外部知识库架构文档

## 架构概览

```
用户查询
  ↓
RetrievalOrchestrator.retrieve()
  ↓
检查 external_knowledge_enabled
  ├─ false → 仅内部 KB
  └─ true  → 尝试外部 KB
      ↓
      loadExternalKnowledgeConfig() [30s TTL 缓存]
      ↓
      FastGPTClient.search()
        ↓
        ├─ 成功 → 返回 ExternalKB Bundle
        ├─ 4xx → 抛异常 → 配置告警 → 降级内部 KB
        └─ 5xx/超时 → 抛异常 → 降级内部 KB
      ↓
bestKnowledgeBundle() 决策
  ├─ ExternalKB.confidence > InternalKB.confidence → 采用外部
  └─ 否则 → 采用内部
```

## 降级策略

| 场景 | 行为 | degradationReason |
|------|------|-------------------|
| `external_knowledge_enabled = false` | 跳过外部 KB | - |
| FastGPT 返回空结果 | 降级内部 KB | `external_kb_empty` |
| FastGPT 所有结果 `<` minScore | 降级内部 KB | `external_kb_low_score` |
| FastGPT 401/403 | 配置告警 + 降级 | `external_kb_4xx:401` |
| FastGPT 500/502/503 | 降级内部 KB | `external_kb_5xx:500` |
| 网络超时 | 降级内部 KB | `external_kb_error` |

## SSRF 防护

`src/lib/security/ssrf-guard.ts` 阻止以下地址：

- RFC 1918 私有网络（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）
- Loopback（`127.0.0.0/8`、`::1/128`）
- Link-local（`169.254.0.0/16`、`fe80::/10`）
- CGNAT（`100.64.0.0/10`）
- Broadcast / "this network"（`0.0.0.0/8`）
- IPv6 unique-local（`fc00::/7`）
- Magic domains（`localhost`、`.localhost`、`localtest.me`、`sslip.io`、`nip.io`、`vcap.me`、`lvh.me`）

> DNS rebinding 不在静态检查覆盖范围内。生产环境应配合 egress proxy 固定 DNS 解析以获得完整防护。

## 配置流程

1. Admin 在设置页填写 `baseUrl` / `apiKey` / `datasetId`
2. 点击「测试连接」 → `probeFastGPT` 验证（8 秒前端超时 + 10 秒服务端超时）
3. 保存 → 配置加密写入 `settings` 表（`external_knowledge_api_key` 为 AES-256-GCM 密文）
4. 30s TTL 缓存自动刷新（`loadExternalKnowledgeConfig`）
5. 下次查询时 `loadExternalKnowledgeConfig` 读取并解密

## 数据流

```
settings 表 (encrypted apiKey)
  ↓ decrypt()
FastGPTClient [30s cache]
  ↓ HTTP POST /core/dataset/searchTest
FastGPT 服务
  ↓ response.data[].list
extractScore() [MAX of channels]
  ↓ normalize (clamp 0-1)
KnowledgeSourceItem[] (source_type: 'external')
  ↓
ChatWindow.tsx
  ↓
SourcePanel.tsx (蓝色角标 + ExternalLink 图标)
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/server/services/fastgpt-client.ts` | FastGPT HTTP 客户端（含重试、超时、SSRF 校验、FastGPTError 类型守卫） |
| `src/server/services/retrieval-orchestrator.ts` | 编排器，融合内部/外部 KB 结果 |
| `src/lib/security/ssrf-guard.ts` | SSRF 防护（统一 `isBlockedUrl` / `validateExternalUrl`） |
| `src/lib/api/security/external-kb-probe.ts` | 测试连接探针 |
| `src/app/api/knowledge/external/test-connection/route.ts` | 用户输入 API Key 的连接测试 |
| `src/app/api/knowledge/external/test-connection/saved/route.ts` | 使用已保存 Key 的连接测试 |
| `src/components/settings/external-knowledge-settings.tsx` | 设置页 UI（含 8s 超时、本地缓存、重试按钮） |

## 前端 UX（P2-13 / P2-29 / P2-31）

| 能力 | 说明 |
|------|------|
| 8s 客户端超时 | `Promise.race` 兜底，避免 UI 卡死 |
| 测试结果持久化 | `localStorage['external-kb-test-result']`，5 分钟 TTL，刷新页面后恢复 |
| 失败重试按钮 | 错误状态下显示独立的「重试连接」按钮 |
| matched dataset 提示 | 成功时 toast 展示已匹配的知识库名称 |

## 外部反馈路径（P2-23）

| 字段 | 内部 KB | 外部 KB |
|------|---------|---------|
| `source_type` | `'internal'` | `'external'` |
| `source_name` | - | FastGPT dataset 名称 |
| `external_dataset_id` | - | FastGPT documentId（稳定标识） |
| `knowledge_item_id` | 内部 UUID | `null`（避免 FK 冲突） |
| 低质量检查 | 启用 | 跳过（无内部行可评估） |

## 类型守卫（P2-17 / P2-22）

| 守卫 | 替代的 `as` 断言 |
|------|------------------|
| `SearchResult`（retrieval-orchestrator.ts） | `searchHybrid()` 返回值上 5+ 处 `as { sources | confidence | context | images | hybridMetadata }` |
| `isFastGPTError(error)`（fastgpt-client.ts） | `(err as Error & { code?: string }).code === '...'` |
| `FastGPTError` 接口 | 自定义 Error 上的 `code` 字段 |

## 测试

| 测试 | 路径 |
|------|------|
| SSRF 守卫单元测试 | `src/lib/security/ssrf-guard.test.ts` |
| 运行命令 | `pnpm test:ssrf` |
