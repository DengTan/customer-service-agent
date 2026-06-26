/**
 * SmartAssist 结构化日志工具
 *
 * 功能：
 * - 统一日志格式，支持不同日志级别
 * - 开发环境彩色输出，生产环境 JSON 格式
 * - 自动脱敏敏感字段（Token、密码、邮箱、手机号）
 * - 支持结构化元数据
 * - 零依赖，轻量级实现
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  module?: string;
  [key: string]: unknown;
}

interface LoggerOptions {
  /** 日志模块名称，如 'Auth', 'Database', 'Agent' */
  module?: string;
  /** 最小日志级别，低于此级别的日志将被忽略 */
  minLevel?: LogLevel;
  /** 是否启用敏感字段脱敏 */
  redactSensitive?: boolean;
}

// 敏感字段模式
const SENSITIVE_PATTERNS = [
  // 邮箱
  { pattern: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '[EMAIL]' },
  // 手机号（中国大陆 11 位）
  { pattern: /1[3-9]\d{9}/g, replacement: '[PHONE]' },
  // 密码/密钥
  { pattern: /(password|passwd|pwd)["\s:=]+["']?[^\s"'&]{6,}/gi, replacement: '$1=[REDACTED]' },
  // API Key / Token / Secret
  { pattern: /(api[_-]?key|token|secret|auth|bearer)["\s:=]+["']?[A-Za-z0-9+/=_.-]{8,}/gi, replacement: '$1=[REDACTED]' },
  // Long hex strings (likely tokens/IDs)
  { pattern: /\b[0-9a-f]{32,}\b/gi, replacement: '[HEX_TOKEN]' },
  // JWT Bearer token
  { pattern: /Bearer\s+[A-Za-z0-9+/=_.-]{10,}/gi, replacement: 'Bearer [REDACTED]' },
];

/**
 * 脱敏敏感字段
 */
export function redactSensitiveFields(input: string | object): string | object {
  if (typeof input === 'string') {
    return redact(input);
  }
  if (Array.isArray(input)) {
    return input.map(item => redactSensitiveFields(item));
  }
  if (input !== null && typeof input === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = redactSensitiveFields(value as string | object);
    }
    return result;
  }
  return input;
}

function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * 检查当前环境是否为生产环境
 */
function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.COZE_PROJECT_ENV === 'PROD'
  );
}

/**
 * 格式化日志时间为 ISO 8601 格式
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 输出日志到控制台
 */
function outputLog(entry: LogEntry, isProd: boolean): void {
  if (isProd) {
    // 生产环境：JSON 格式
    console.log(JSON.stringify(entry));
  } else {
    // 开发环境：彩色格式化输出
    const levelColors: Record<string, string> = {
      DEBUG: '\x1b[36m', // 青色
      INFO: '\x1b[32m',  // 绿色
      WARN: '\x1b[33m',  // 黄色
      ERROR: '\x1b[31m', // 红色
    };
    const color = levelColors[entry.level] || '\x1b[0m';
    const reset = '\x1b[0m';

    const moduleStr = entry.module ? `[${entry.module}] ` : '';
    const metaStr = Object.keys(entry)
      .filter((k) => k !== 'timestamp' && k !== 'level' && k !== 'message' && k !== 'module')
      .map((k) => `${k}=${JSON.stringify(entry[k])}`)
      .join(' ');

    console.log(
      `${entry.timestamp} ${color}${entry.level.padEnd(5)}${reset} ${moduleStr}${entry.message}${metaStr ? ' ' + metaStr : ''}`,
    );
  }
}

/**
 * 创建日志入口函数
 */
function createLogEntry(
  level: LogLevel,
  levelName: string,
  message: string,
  options: LoggerOptions,
  meta?: Record<string, unknown>,
): LogEntry {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level: levelName,
    message: options.redactSensitive !== false ? redact(message) : message,
  };

  if (options.module) {
    entry.module = options.module;
  }

  if (meta) {
    // 脱敏元数据中的敏感值
    const sanitizedMeta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'string') {
        sanitizedMeta[key] = options.redactSensitive !== false ? redact(value) : value;
      } else {
        sanitizedMeta[key] = value;
      }
    }
    Object.assign(entry, sanitizedMeta);
  }

  return entry;
}

/**
 * SmartAssist 日志器类
 */
export class Logger {
  private readonly module?: string;
  private readonly minLevel: LogLevel;
  private readonly redactSensitive: boolean;
  private readonly isProd: boolean;

  constructor(options: LoggerOptions = {}) {
    this.module = options.module;
    this.minLevel = options.minLevel ?? LogLevel.INFO;
    this.redactSensitive = options.redactSensitive !== false;
    this.isProd = isProduction();
  }

  /**
   * 创建子日志器，继承配置但可以覆盖模块名
   */
  child(module: string): Logger {
    return new Logger({
      module,
      minLevel: this.minLevel,
      redactSensitive: this.redactSensitive,
    });
  }

  /**
   * Debug 级别日志
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.minLevel > LogLevel.DEBUG) return;
    const entry = createLogEntry(LogLevel.DEBUG, 'DEBUG', message, {
      module: this.module,
      redactSensitive: this.redactSensitive,
    }, meta);
    outputLog(entry, this.isProd);
  }

  /**
   * Info 级别日志
   */
  info(message: string, meta?: Record<string, unknown>): void {
    if (this.minLevel > LogLevel.INFO) return;
    const entry = createLogEntry(LogLevel.INFO, 'INFO', message, {
      module: this.module,
      redactSensitive: this.redactSensitive,
    }, meta);
    outputLog(entry, this.isProd);
  }

  /**
   * Warn 级别日志
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.minLevel > LogLevel.WARN) return;
    const entry = createLogEntry(LogLevel.WARN, 'WARN', message, {
      module: this.module,
      redactSensitive: this.redactSensitive,
    }, meta);
    outputLog(entry, this.isProd);
  }

  /**
   * Error 级别日志
   */
  error(message: string, meta?: Record<string, unknown>): void {
    if (this.minLevel > LogLevel.ERROR) return;
    const entry = createLogEntry(LogLevel.ERROR, 'ERROR', message, {
      module: this.module,
      redactSensitive: this.redactSensitive,
    }, meta);
    outputLog(entry, this.isProd);
  }

  /**
   * 以 Error 对象记录错误
   */
  errorWithException(message: string, error: unknown, meta?: Record<string, unknown>): void {
    if (this.minLevel > LogLevel.ERROR) return;

    let errorMeta: Record<string, unknown> = { ...meta };

    if (error instanceof Error) {
      errorMeta = {
        ...errorMeta,
        errorName: error.name,
        errorMessage: this.redactSensitive ? redact(error.message) : error.message,
        stack: error.stack,
      };
    } else if (error !== null && error !== undefined) {
      errorMeta = {
        ...errorMeta,
        error: this.redactSensitive ? redact(String(error)) : String(error),
      };
    }

    const entry = createLogEntry(LogLevel.ERROR, 'ERROR', message, {
      module: this.module,
      redactSensitive: this.redactSensitive,
    }, errorMeta);
    outputLog(entry, this.isProd);
  }
}

// ─── 全局日志器工厂 ────────────────────────────────────────────

/** 全局日志器缓存 */
const globalLoggers = new Map<string, Logger>();

/**
 * 获取全局日志器
 * @param module 模块名称，如果为根日志器则不传
 */
export function getLogger(module?: string): Logger {
  const key = module || '__root__';

  if (!globalLoggers.has(key)) {
    globalLoggers.set(key, new Logger({ module }));
  }

  return globalLoggers.get(key)!;
}

/**
 * 创建日志器（别名，用于兼容旧的 API）
 */
export function createLogger(module?: string, options?: LoggerOptions): Logger {
  return new Logger({ module, ...options });
}

/**
 * 清除全局日志器缓存（主要用于测试）
 */
export function clearLoggerCache(): void {
  globalLoggers.clear();
}

// ─── 预设日志器 ────────────────────────────────────────────────

export const logger = {
  auth: getLogger('Auth'),
  database: getLogger('Database'),
  agent: getLogger('Agent'),
  api: getLogger('API'),
  security: getLogger('Security'),
  platform: getLogger('Platform'),
  default: getLogger('Default'),
};

export default getLogger();
