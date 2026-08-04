/**
 * E2E Test Logger
 * Phase C2: E2E Authentication Matrix Framework
 * 
 * A simple logger for E2E tests that outputs to console with timestamps
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function formatLog(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function shouldLog(level: LogLevel): boolean {
  const envLevel = process.env.E2E_LOG_LEVEL?.toLowerCase() as LogLevel || 'info';
  return LOG_LEVELS[level] >= LOG_LEVELS[envLevel];
}

export const testLogger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.debug(formatLog('debug', message, meta));
    }
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.log(formatLog('info', message, meta));
    }
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(formatLog('warn', message, meta));
    }
  },

  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatLog('error', message, meta));
    }
  },

  log(entry: LogEntry): void {
    const fn = console.log;
    fn(formatLog(entry.level, entry.message, entry.meta));
  },
};

// Default export for convenience
export default testLogger;
