/**
 * Unified API utilities for SmartAssist
 *
 * Solves:
 *   EH-01: Consistent top-level try-catch for all API routes
 *   EH-02: Unified error response format
 *   EH-03: Hide internal error details in production
 *   EH-15: Unified success/error response wrappers
 *   EH-07: Safe JSON body parsing
 */

import { NextRequest, NextResponse } from 'next/server';
import { isServiceError } from '@/server/services/service-error';
import { extractTokenFromCookies, verifyToken } from '@/lib/auth/jwt';
import { logger as loggerCollection } from '@/lib/logger';
import { getIPFromRequest } from '@/lib/auth/ip-utils';
import type { PermissionResource, PermissionAction, UserRole } from '@/lib/types';
import { PermissionService } from '@/server/services/permission-service';
import { PROBLEM_JSON_CONTENT_TYPE } from '@/lib/api/problem-json';
const apiLogger = loggerCollection.api;
const securityLogger = loggerCollection.security;

// ─── Request ID ──────────────────────────────────────────────

/** Standard HTTP header name for request tracing. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Extracts or generates a request ID from/in a NextRequest.
 * Checks `x-request-id` header first; falls back to generating a UUID v4.
 */
export function getOrCreateRequestId(request: NextRequest): string {
  const header = request.headers.get(REQUEST_ID_HEADER);
  if (header && header.length > 0 && header.length <= 64) {
    return header;
  }
  // Generate a simple UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── HTTP Status Codes ─────────────────────────────────────

export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// ─── Response Helpers ──────────────────────────────────────

/** Standard success response */
export function apiSuccess<T>(data: T, status: number = HttpStatus.OK): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * Standard error response.
 *
 * Stage A / A5c: `apiError` now returns RFC 7807 Problem Details
 * (`application/problem+json`). The legacy `{ success, error }` envelope
 * is preserved for legacy callers as a top-level `error` extension field
 * so existing clients keep working until they migrate.
 *
 * In production (NODE_ENV === 'production'), internal error details are
 * hidden. The `internalMessage` is always logged server-side (with
 * sensitive fields redacted).
 */
export function apiError(
  userMessage: string,
  {
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    internalMessage,
    code,
    meta,
  }: {
    status?: number;
    internalMessage?: string;
    code?: string;
    meta?: Record<string, unknown>;
  } = {},
): NextResponse {
  if (internalMessage) {
    apiLogger.error(`[API Error] ${code ? `[${code}] ` : ''}${redactSensitiveFields(internalMessage)}`);
  }

  const isProd = process.env.NODE_ENV === 'production';
  const detail = isProd ? userMessage : (internalMessage ?? userMessage);

  const extensions: Record<string, unknown> = { code };
  if (meta) extensions.meta = meta;
  if (!isProd && internalMessage) extensions.debug = internalMessage;

  // Legacy compatibility: keep `success: false` and `error` keys so existing
  // frontends keep working during the migration to RFC 7807.
  extensions.success = false;
  extensions.error = detail;

  const headers: Record<string, string> = {
    'Content-Type': PROBLEM_JSON_CONTENT_TYPE,
  };

  const body = {
    type: '/problems/internal-error',
    title: 'Error',
    status,
    detail,
    ...extensions,
  };

  return new NextResponse(JSON.stringify(body), { status, headers });
}

/**
 * Redacts potentially sensitive fields from log messages.
 * Matches common patterns like tokens, passwords, API keys, emails, phone numbers.
 */
function redactSensitiveFields(message: string): string {
  return message
    // Redact email-like patterns
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '[REDACTED_EMAIL]')
    // Redact phone-like patterns (Chinese mobile: 11 digits starting with 1)
    .replace(/1[3-9]\d{9}/g, '[REDACTED_PHONE]')
    // Redact common secret key patterns
    .replace(/(?:api[_-]?key|token|secret|password|auth)["\s:=]+["']?[\w\-_.]{8,}/gi, (match) =>
      match.replace(/[\w\-_.]{8,}$/, '[REDACTED]')
    )
    // Redact Bearer tokens
    .replace(/Bearer\s+[\w\-_.]+/gi, 'Bearer [REDACTED]')
    // Redact long hex strings (likely tokens/IDs)
    .replace(/\b[0-9a-f]{32,}\b/gi, '[REDACTED_HEX]');
}

// ─── SQL LIKE Pattern Escaping ────────────────────────────────

/**
 * Escapes special characters in a string for safe use in SQL LIKE/ILIKE patterns.
 * Escapes: % (wildcard), _ (single char), \ (escape char).
 *
 * IMPORTANT: When using this with Supabase's `.ilike()` / `.like()`, you MUST
 * also pass the ESCAPE clause. Since Supabase's query builder doesn't support
 * custom ESCAPE, we use the default `\` and ensure backslashes are escaped.
 *
 * For Supabase, the pattern `%${escaped}%` with `.ilike('col', ...)` is safe
 * because PostgreSQL's default LIKE escape character is `\` when using
 * `standard_conforming_strings = on` (default in PG 9.1+).
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

// ─── Demo Mode Memory Management ──────────────────────────────

/** Maximum number of items a demo-mode in-memory array is allowed to hold. */
import { DEMO_ARRAY_MAX_SIZE } from './constants';

/**
 * Trims an in-memory demo array to `DEMO_ARRAY_MAX_SIZE`, removing the
 * oldest entries (from the end). Call this after pushing/unshifting new items.
 */
export function trimDemoArray<T>(arr: T[]): T[] {
  if (arr.length > DEMO_ARRAY_MAX_SIZE) {
    arr.splice(DEMO_ARRAY_MAX_SIZE);
  }
  return arr;
}

// ─── Simple Rate Limiting ─────────────────────────────────────

/**
 * In-memory sliding-window rate limiter.
 * Keyed by IP address (or a custom key). Each window resets after `windowMs`.
 *
 * NOTE: This is per-process only. In a multi-instance deployment,
 * use Redis or a shared store instead.
 */
const MAX_RATE_LIMIT_ENTRIES = 10000;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/** Periodically purge expired entries to prevent memory leak */
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) rateLimitStore.delete(key);
    }
  }, 60_000);
}

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/**
 * Checks the rate limit for the given request. Returns a 429 response if
 * the limit is exceeded, or null if the request is allowed.
 *
 * Uses the client IP from `x-forwarded-for` or `x-real-ip` as the key.
 */
export function checkRateLimit(
  request: NextRequest,
  options: RateLimitOptions = { maxRequests: 60, windowMs: 60_000 },
): NextResponse | null {
  // Allow higher limits during testing
  const isTest = process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT === '1';
  const effectiveMax = isTest ? Math.max(options.maxRequests, 1000) : options.maxRequests;
  const effectiveWindow = isTest ? 600_000 : options.windowMs; // 10min in tests

  // Enforce size limit to prevent memory exhaustion
  if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of rateLimitStore) {
      if (entry.resetAt < oldestTime) {
        oldestTime = entry.resetAt;
        oldestKey = key;
      }
    }
    if (oldestKey) rateLimitStore.delete(oldestKey);
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + effectiveWindow });
    return null;
  }

  entry.count++;
  if (entry.count > effectiveMax) {
    return apiError('请求过于频繁，请稍后再试', {
      status: HttpStatus.TOO_MANY_REQUESTS,
      code: 'RATE_LIMITED',
      internalMessage: `Rate limit exceeded for IP ${ip}: ${entry.count}/${options.maxRequests} in ${options.windowMs}ms`,
    });
  }

  return null;
}

// ─── Role-based Access Control ─────────────────────────────────

/**
 * Extract the acting user's role from JWT token in cookie.
 * The legacy x-user-role header is DEPRECATED and only works in development mode.
 * 
 * Security Note: In production, this header is completely ignored to prevent
 * role spoofing attacks. All requests must use valid JWT tokens.
 */
export function extractUserRole(request: NextRequest): string | null {
  // Try JWT token first (secure method)
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const token = extractTokenFromCookies(cookieHeader);
    if (token) {
      const payload = verifyToken(token);
      if (payload?.role) {
        return payload.role;
      }
    }
  }

  // Legacy header fallback - ONLY allowed in development mode
  // This is a security risk in production and must be disabled
  if (process.env.NODE_ENV !== 'production') {
    const legacyRole = request.headers.get('x-user-role');
    if (legacyRole) {
      apiLogger.warn('[Security] Legacy x-user-role header used (dev mode only)', {
        legacyRole,
        ip: getIPFromRequest(request as unknown as Request),
      });
      return legacyRole;
    }
  } else {
    // 阻止在生产环境中使用伪造的 x-user-role header
    const legacyRole = request.headers.get('x-user-role');
    if (legacyRole) {
      securityLogger.warn('[Security] Blocked attempt to use legacy x-user-role header in production', {
        ip: getIPFromRequest(request as unknown as Request),
        attemptedRole: legacyRole,
      });
      // 直接返回 403，不继续处理请求
      return null;
    }
  }
  
  return null;
}

/**
 * Get authenticated user ID from JWT token.
 * Returns null if not authenticated.
 */
export function getAuthenticatedUserId(request: NextRequest): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const token = extractTokenFromCookies(cookieHeader);
  if (!token) return null;

  const payload = verifyToken(token);
  return payload?.sub ?? null;
}

/**
 * Returns a 403 error if the requesting user's role is not in `allowedRoles`.
 * Otherwise returns null (access granted).
 */
export function requireRole(
  request: NextRequest,
  allowedRoles: string[],
): NextResponse | null {
  const role = extractUserRole(request);
  // Treat null role as unauthenticated, deny access
  if (!role || !allowedRoles.includes(role)) {
    return apiError('权限不足，无法执行此操作', {
      status: HttpStatus.FORBIDDEN,
      code: 'FORBIDDEN',
      internalMessage: `Role "${role}" not in [${allowedRoles.join(', ')}]`,
    });
  }
  return null;
}

/**
 * Returns a 403 error if the requesting user's role does not have the specified
 * permission on the given resource. Otherwise returns null (access granted).
 *
 * This reads from the role_permissions database table via PermissionService.
 * If no DB row exists for (role, resource, action), falls back to DEFAULT_PERMISSIONS.
 */
export async function requirePermission(
  request: NextRequest,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<NextResponse | null> {
  const role = extractUserRole(request);
  if (!role) {
    return apiError('未登录或登录已过期', {
      status: HttpStatus.UNAUTHORIZED,
      code: 'UNAUTHORIZED',
    });
  }

  const service = new PermissionService();
  const allowed = await service.checkPermission(role as UserRole, resource, action);
  if (!allowed) {
    return apiError('权限不足，无法执行此操作', {
      status: HttpStatus.FORBIDDEN,
      code: 'FORBIDDEN',
      internalMessage: `Role "${role}" denied for ${resource}/${action}`,
    });
  }
  return null;
}

// ─── Safe JSON Parsing ─────────────────────────────────────

/**
 * Safely parse request.json() with SyntaxError protection.
 * Solves EH-07: invalid JSON no longer causes 500.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  request: NextRequest,
): Promise<{ data: T | null; error: NextResponse | null }> {
  try {
    const data = (await request.json()) as T;
    return { data, error: null };
  } catch {
    return {
      data: null,
      error: apiError('请求体 JSON 格式无效', {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_JSON',
      }),
    };
  }
}

// ─── Route Handler Wrapper ─────────────────────────────────

type HandlerResult = NextResponse | Response;

/**
 * Generic params type for dynamic route segments.
 * Each route file should destructure the specific keys it needs.
 */
type RouteParams = Record<string, string>;

type HandlerFn<TParams extends RouteParams = RouteParams> = (
  request: NextRequest,
  context: { params: Promise<TParams> },
) => Promise<HandlerResult>;

/**
 * Wraps an API route handler with:
 * 1. Top-level try-catch (EH-01)
 * 2. Unified error formatting (EH-02/EH-03)
 *
 * Usage:
 * ```ts
 * export const GET = withErrorHandler(async (request, { params }) => {
 *   const { id } = await params;
 *   // ... your logic
 *   return apiSuccess({ data });
 * });
 * ```
 */
export function withErrorHandler<TParams extends RouteParams = RouteParams>(
  handler: HandlerFn<TParams>,
): HandlerFn<TParams> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (err) {
      if (isServiceError(err)) {
        return apiError(err.userMessage, {
          status: err.status,
          internalMessage: err.message,
          code: err.code,
        });
      }

      const internalMessage = err instanceof Error ? err.message : String(err);
      apiLogger.error('[API Unhandled Error]', { error: internalMessage });

      return apiError('服务器内部错误，请稍后重试', {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        internalMessage,
        code: 'INTERNAL_ERROR',
      });
    }
  };
}

/**
 * Wrap a simple handler (no params) with error handling.
 * For routes like GET/POST on /api/settings that don't have dynamic segments.
 */
type SimpleHandlerFn = (request: NextRequest) => Promise<HandlerResult>;

export function withErrorHandlerSimple(handler: SimpleHandlerFn): SimpleHandlerFn {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (isServiceError(err)) {
        return apiError(err.userMessage, {
          status: err.status,
          internalMessage: err.message,
          code: err.code,
        });
      }

      const internalMessage = err instanceof Error ? err.message : String(err);
      apiLogger.error('[API Unhandled Error]', { error: internalMessage });

      return apiError('服务器内部错误，请稍后重试', {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        internalMessage,
        code: 'INTERNAL_ERROR',
      });
    }
  };
}

// ─── Audit Trail ─────────────────────────────────────────────

/**
 * Context passed to audit hooks when an operation is executed.
 */
export interface AuditContext {
  /** ID of the user performing the operation */
  userId: string | null;
  /** Additional context about the operation */
  payload: Record<string, unknown>;
  /** Operation type (create, update, delete, etc.) */
  operation?: string;
}

/**
 * A hook that runs alongside an audited operation.
 * Should throw if the audit fails in fail-closed mode.
 */
export type AuditHook = (ctx: AuditContext) => Promise<void>;

/**
 * Options for withAuditTrail.
 */
interface AuditTrailOptions {
  /** Table being audited (for logging) */
  table: string;
  /** Operation type (create, update, delete, etc.) */
  operation: string;
  /** Field names to redact from logs */
  redact?: readonly string[];
  /** If true, throw on hook failure; if false, log and continue (default: true) */
  failClosed?: boolean;
}

/**
 * Wrap an async operation with audit trail hooks.
 * Hooks run after the operation completes (for logging purposes).
 * If failClosed is true and any hook throws, the error propagates.
 */
export async function withAuditTrail<T>(
  options: AuditTrailOptions,
  run: () => Promise<T>,
  hooks: AuditHook[] = [],
  context: AuditContext = { userId: null, payload: {} },
): Promise<T> {
  const result = await run();

  // Run all hooks (fire-and-forget unless failClosed is true)
  const hookPromises = hooks.map(async (hook) => {
    try {
      await hook(context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiLogger.warn('[AuditTrail] Hook failed', {
        table: options.table,
        operation: options.operation,
        error: msg,
      });
      if (options.failClosed !== false) {
        throw err;
      }
    }
  });

  await Promise.all(hookPromises);
  return result;
}
