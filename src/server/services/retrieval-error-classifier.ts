/**
 * Sprint 3 — Retrieval error classifier (R-7).
 *
 * The retrieval pipeline swallows errors from at least four logical
 * channels: Supabase RPC (data layer), Ollama (vector embedding),
 * FastGPT (external KB), and the network stack. They all surface as
 * `Error` instances with different shapes; before Sprint 3 every channel
 * was logged with `logger.agent.error(...)` at the same severity, making
 * incident triage a guessing game.
 *
 * This classifier picks one of three buckets:
 *
 * - `NETWORK`   — fetch / DNS / socket failures (`TypeError: fetch failed`,
 *                 `ECONNRESET`, `AbortError`, `ETIMEDOUT`).
 *                 Logged at WARN — these are operational conditions, not bugs.
 * - `NOT_FOUND` — `NotFoundError` (PGRST116) and similar "row missing"
 *                 outcomes. Logged at DEBUG — they are expected.
 * - `UNSUPPORTED` — `UnsupportedFeatureError` (PG 42883 / undefined_function).
 *                   Logged at WARN — caller is expected to fall back.
 * - `DATA_ERROR` — `RepositoryError` other than NOT_FOUND/UNSUPPORTED.
 *                  Logged at ERROR — likely a misconfiguration or schema
 *                  drift that needs a human.
 * - `UNKNOWN`   — anything else, treated like DATA_ERROR (logged at ERROR).
 *
 * All buckets return a stable `kind` string and `level` (one of
 * `warn | debug | error`) so callers can pick a logger method without
 * branching on the underlying type.
 */

import { isRepositoryError, NotFoundError, UnsupportedFeatureError } from '@/lib/repository-errors';

export type RetrievalErrorKind =
  | 'NETWORK'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'DATA_ERROR'
  | 'UNKNOWN';

export interface ClassifiedError {
  kind: RetrievalErrorKind;
  level: 'warn' | 'debug' | 'error';
  message: string;
  cause: unknown;
}

const NETWORK_MESSAGE_RE =
  /fetch failed|ECONNRESET|socket hang up|ETIMEDOUT|ENOTFOUND|getaddrinfo|network is unreachable/i;
const NETWORK_NAME_SET = new Set(['AbortError', 'TypeError']);

function isAbortErrorLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /AbortError/.test(err.message));
}

function isNetworkError(err: unknown): boolean {
  if (isAbortErrorLike(err)) return true;
  if (err instanceof Error && NETWORK_NAME_SET.has(err.name)) return true;
  if (err instanceof Error && NETWORK_MESSAGE_RE.test(err.message)) return true;
  return false;
}

/**
 * Classify an arbitrary error into a RetrievalErrorKind bucket.
 *
 * Pure function — no logging side effects. Use the returned `level`
 * to choose the logger method (`logger.warn` for NETWORK / UNSUPPORTED,
 * `logger.debug` for NOT_FOUND, `logger.error` for DATA_ERROR / UNKNOWN).
 */
export function classifyRetrievalError(err: unknown): ClassifiedError {
  if (err === null || err === undefined) {
    return { kind: 'UNKNOWN', level: 'error', message: 'unknown retrieval error', cause: err };
  }

  // Domain errors take precedence — they are the cleanest signal.
  if (isRepositoryError(err)) {
    if (err instanceof NotFoundError) {
      return { kind: 'NOT_FOUND', level: 'debug', message: err.message, cause: err };
    }
    if (err instanceof UnsupportedFeatureError) {
      return { kind: 'UNSUPPORTED', level: 'warn', message: err.message, cause: err };
    }
    // Any other RepositoryError (CONFLICT, VALIDATION, INTERNAL).
    return { kind: 'DATA_ERROR', level: 'error', message: err.message, cause: err };
  }

  if (isNetworkError(err)) {
    return {
      kind: 'NETWORK',
      level: 'warn',
      message: err instanceof Error ? err.message : String(err),
      cause: err,
    };
  }

  return {
    kind: 'UNKNOWN',
    level: 'error',
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  };
}

/**
 * Convenience logging helper that maps the classified bucket onto the
 * correct logger method. The `channel` argument is a short string used
 * as the `where` key in the log record (e.g. `'orchestrator.knowledgeSearch'`).
 */
export function logClassifiedRetrievalError(
  channel: string,
  err: unknown,
  context: Record<string, unknown> = {},
): ClassifiedError {
  const c = classifyRetrievalError(err);
  // Import lazily to avoid pulling logger into repository/types tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { logger } = require('@/lib/logger') as typeof import('@/lib/logger');
  const log = logger.agent ?? logger.default;
  const meta = { channel, kind: c.kind, ...context, error: c.cause };
  if (c.level === 'warn') log.warn(`[Retrieval] ${c.kind} at ${channel}`, meta);
  else if (c.level === 'debug') log.debug(`[Retrieval] ${c.kind} at ${channel}`, meta);
  else log.error(`[Retrieval] ${c.kind} at ${channel}`, meta);
  return c;
}
