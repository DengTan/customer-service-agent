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
  JWT_COOKIE_NAME: 'sa_jwt',
  JWT_EXPIRES_IN: 8 * 60 * 60,
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
