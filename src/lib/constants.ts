/**
 * 全局常量收敛
 * 消除代码中的魔法数字，统一管理关键阈值
 */

// ============================================================
// 速率限制
// ============================================================
export const RATE_LIMIT = {
  MESSAGE_MAX_PER_MINUTE: 20,
  KNOWLEDGE_IMPORT_MAX_PER_MINUTE: 10,
  UPLOAD_MAX_PER_MINUTE: 30,
  WINDOW_MS: 60 * 1000,
} as const;

// ============================================================
// 登录安全
// ============================================================
export const AUTH = {
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15,
  PASSWORD_BCRYPT_ROUNDS: 12,
  LOGIN_MAX_LOG_EVENTS: 1000,
} as const;

// ============================================================
// HTTP 安全
// ============================================================
export const HTTP = {
  KNOWLEDGE_MIN_SCORE: 0.75,
  MAX_MESSAGE_LENGTH: 10000,
  MAX_UPLOAD_SIZE_BYTES: 20 * 1024 * 1024,
  JWT_COOKIE_NAME: 'auth_token',
  JWT_EXPIRES_IN: 8 * 60 * 60,
  // P0-3: knowledge items all-ids 硬上限，避免大批量选取撑爆响应
  KNOWLEDGE_ALL_IDS_MAX: 5000,
} as const;

// ============================================================
// SSE 与流式
// ============================================================
export const SSE = {
  STREAM_TIMEOUT_MS: 60 * 1000,
  TIME_DIVIDER_GAP_MS: 5 * 60 * 1000,
} as const;

// ============================================================
// Demo 模式内存管理
// ============================================================
export const DEMO_ARRAY_MAX_SIZE = 200;

// ============================================================
// 知识库
// ============================================================
export const KNOWLEDGE_SEARCH_LIMIT = 5;
export const KNOWLEDGE_IMAGE_SEARCH_LIMIT = 3;

// ============================================================
// 安全配置
// ============================================================
export const SECURITY = {
  // 信任的代理前缀，仅在直接部署时使用（如反向代理已剥离 X-Forwarded-*）
  // 生产环境应通过环境变量配置，留空则不信任任何代理头
  TRUSTED_PROXY: process.env.TRUSTED_PROXY ?? '',
  // 强制要求 HTTPS 才设置 Secure cookie，即使 X-Forwarded-Proto 被伪造也无法绕过
  // 生产部署应设为 true，确保 cookie 在 HTTPS 上才设置 Secure 标志
  COOKIE_REQUIRE_HTTPS: process.env.COOKIE_REQUIRE_HTTPS === 'true',
} as const;

// ============================================================
// 内容过滤
// ============================================================
export const CONTENT_FILTER = {
  CACHE_TTL_MS: 30_000, // 30 seconds
  MAX_CACHE_SIZE: 10_000, // Max entries in cache
  MAX_REPLACE_ITERATIONS: 10, // Max iterations for word replacement
} as const;

// ============================================================
// 前端轮询与搜索
// ============================================================
export const FRONTEND = {
  POLL_INTERVAL_MS: 10_000, // 10 seconds - general polling
  NOW_REFRESH_INTERVAL_MS: 10_000, // 10 seconds - queue wait time refresh
  SEARCH_DEBOUNCE_MS: 300, // 300ms - search input debounce
  AGENT_STATUS_POLL_MS: 5_000, // 5 seconds - agent status polling
  TIME_DIVIDER_MS: 5 * 60 * 1000, // 5 minutes - time divider gap
} as const;

// ============================================================
// 工单管理
// ============================================================
export const TICKET = {
  PAGE_SIZE: 50,
  MAX_TITLE_LENGTH: 500,
  MAX_DESCRIPTION_LENGTH: 5000,
  MAX_COMMENT_LENGTH: 5000,
  BATCH_MAX_SIZE: 100,
  EXPORT_MAX_ROWS: 5000,
  CUSTOMER_TICKET_LIMIT: 20,
} as const;
