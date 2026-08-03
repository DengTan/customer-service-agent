/**
 * L2 API Gateway (`withApi`).
 *
 * Stage A / A5a + A5b replaces ad-hoc route handlers with a single
 * high-order function that enforces the auth / perm / rate-limit /
 * idempotency contract for every route.
 *
 * ```ts
 * import { withApi } from '@/lib/api/with-api';
 * import { HttpStatus } from '@/lib/api-utils';
 *
 * export const POST = withApi({
 *   auth: 'required',
 *   perm: { resource: 'conversations', action: 'update' },
 *   rateLimit: { maxRequests: 30, windowMs: 60_000 },
 * }, async (ctx) => {
 *   const { id } = ctx.params; // dynamic params resolved for you
 *   const { user } = ctx; // authenticated user payload
 *   return apiSuccess({ ok: true });
 * });
 * ```
 *
 * Cross-cutting concerns:
 *  - `auth: 'required'` → returns RFC 7807 401 when no verified user
 *  - `auth: 'webhook-secret'` → uses the X-Internal-Secret header instead
 *  - `auth: 'optional'` → attaches user if present but does not enforce
 *  - `perm: { resource, action }` → delegates to PermissionService
 *  - `rateLimit` → sliding-window IP-based limit (delegates to api-utils)
 *  - `idempotency` → reserved hook for future outbox-backed dedup
 *  - `audit` → reserved hook for future audit trail integration
 */

import { NextResponse, type NextRequest } from 'next/server';
import { extractTokenFromCookies, verifyToken } from '@/lib/auth/jwt';
import {
  apiError,
  HttpStatus,
  requirePermission,
  getOrCreateRequestId,
  checkRateLimit,
  REQUEST_ID_HEADER,
} from '@/lib/api-utils';
import { problemResponse } from '@/lib/api/problem-json';
import {
  attachCorsHeaders,
  handleCorsPreflight,
  handleHeadShortCircuit,
} from '@/lib/api/cors';
import { logger as loggerCollection } from '@/lib/logger';
import { isServiceError } from '@/server/services/service-error';
import type { JWTPayload } from '@/lib/auth/jwt';
import type { PermissionResource, PermissionAction } from '@/lib/types';

const apiLogger = loggerCollection.api;

export type AuthStrategy = 'required' | 'optional' | 'webhook-secret' | 'public';

export interface WithApiOptions<TParams extends Record<string, string> = Record<string, string>> {
  auth?: AuthStrategy;
  perm?: { resource: PermissionResource; action: PermissionAction };
  rateLimit?: { maxRequests: number; windowMs: number };
  /**
   * Reserved for future work — Stage A wires the shape only. Future
   * implementation will hash the request body and short-circuit duplicates
   * via `effect_outbox` (RC-5 / B4a). Until then the flag is a no-op.
   */
  idempotency?: boolean;
  /**
   * Reserved for future work — wires the shape for `withAuditTrail`.
   * The hook will run after the handler returns; failures are logged.
   */
  audit?: { table: string; operation: string };
}

export interface WithApiContext<TParams extends Record<string, string> = Record<string, string>> {
  request: NextRequest;
  params: TParams;
  user: JWTPayload | null;
  requestId: string;
}

export type ApiHandlerFn<TParams extends Record<string, string> = Record<string, string>> = (
  ctx: WithApiContext<TParams>,
) => Promise<NextResponse | Response> | NextResponse | Response;

interface ResolvedRequest {
  ok: true;
  user: JWTPayload | null;
  requestId: string;
}
interface ResolvedRequestError {
  ok: false;
  response: NextResponse;
}
type Resolution = ResolvedRequest | ResolvedRequestError;

function resolveRequest<TParams extends Record<string, string>>(
  request: NextRequest,
  context: { params: Promise<TParams> } | undefined,
  options: WithApiOptions<TParams>,
): Promise<Resolution> {
  return (async () => {
    const requestId = getOrCreateRequestId(request);

    // 1) Rate limit (always, before auth so unauthenticated bursts are capped)
    if (options.rateLimit) {
      const limited = checkRateLimit(request, options.rateLimit);
      if (limited) {
        limited.headers.set(REQUEST_ID_HEADER, requestId);
        return { ok: false as const, response: limited };
      }
    }

    // 2) Authentication
    let user: JWTPayload | null = null;
    const auth = options.auth ?? 'required';
    if (auth === 'public') {
      user = null;
    } else if (auth === 'webhook-secret') {
      const provided = request.headers.get('x-internal-secret') ?? '';
      const expected = process.env.INTERNAL_API_SECRET ?? '';
      if (!expected || provided !== expected) {
        return {
          ok: false as const,
          response: problemResponse(HttpStatus.UNAUTHORIZED, 'Webhook secret missing or invalid', {
            instance: request.nextUrl.pathname,
            extensions: { requestId },
          }),
        };
      }
    } else {
      const cookieHeader = request.headers.get('cookie');
      const token = extractTokenFromCookies(cookieHeader);
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        if (auth === 'optional') {
          user = null;
        } else {
          return {
            ok: false as const,
            response: problemResponse(HttpStatus.UNAUTHORIZED, '未登录或登录已过期', {
              instance: request.nextUrl.pathname,
              extensions: { requestId, code: 'UNAUTHORIZED' },
            }),
          };
        }
      } else {
        user = payload;
      }
    }

    // 3) Permission (role-based)
    if (options.perm && user) {
      const forbidden = await requirePermission(request, options.perm.resource, options.perm.action);
      if (forbidden) {
        forbidden.headers.set(REQUEST_ID_HEADER, requestId);
        return { ok: false as const, response: forbidden };
      }
    } else if (options.perm && !user) {
      return {
        ok: false as const,
        response: problemResponse(HttpStatus.UNAUTHORIZED, '未登录或登录已过期', {
          instance: request.nextUrl.pathname,
          extensions: { requestId, code: 'UNAUTHORIZED' },
        }),
      };
    }

    return { ok: true as const, user, requestId };
  })();
}

function applyEnvelope(response: NextResponse, requestId: string, request: NextRequest): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  attachCorsHeaders(response, request);
  return response;
}

/**
 * Wrap a route handler with the full L2 API Gateway pipeline.
 *
 * NOTE: When the request method is OPTIONS the wrapper short-circuits to a
 * 204 response WITHOUT invoking auth / rate-limit (RC-1 / Q2 decision A).
 * HEAD is short-circuited to a 200 with empty body — also without invoking
 * the handler.
 */
export function withApi<TParams extends Record<string, string> = Record<string, string>>(
  options: WithApiOptions<TParams>,
  handler: ApiHandlerFn<TParams>,
) {
  return async (
    request: NextRequest,
    context?: { params: Promise<TParams> },
  ): Promise<NextResponse | Response> => {
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      const { response } = handleCorsPreflight(request);
      return response;
    }
    if (method === 'HEAD') {
      return handleHeadShortCircuit(request);
    }

    const resolution = await resolveRequest(request, context, options);
    if (!resolution.ok) {
      attachCorsHeaders(resolution.response, request);
      return resolution.response;
    }

    try {
      const params = (await context?.params) ?? ({} as TParams);
      const result = await handler({
        request,
        params,
        user: resolution.user,
        requestId: resolution.requestId,
      });

      if (result instanceof NextResponse) {
        return applyEnvelope(result, resolution.requestId, request);
      }

      // Convert raw Response to NextResponse so envelope applies.
      const wrapped = new NextResponse(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
      return applyEnvelope(wrapped, resolution.requestId, request);
    } catch (err) {
      if (isServiceError(err)) {
        const response = apiError(err.userMessage, {
          status: err.status,
          internalMessage: err.message,
          code: err.code,
        });
        apiLogger.error('[withApi] Service error', {
          code: err.code,
          status: err.status,
          requestId: resolution.requestId,
        });
        return applyEnvelope(response, resolution.requestId, request);
      }

      const internalMessage = err instanceof Error ? err.message : String(err);
      apiLogger.error('[withApi] Unhandled error', {
        error: internalMessage,
        requestId: resolution.requestId,
      });
      const response = apiError('服务器内部错误，请稍后重试', {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        internalMessage,
        code: 'INTERNAL_ERROR',
      });
      return applyEnvelope(response, resolution.requestId, request);
    }
  };
}

// ─── Per-method shorthands ────────────────────────────────────
//
// These helpers preserve the legacy `export const GET = ...` ergonomics
// while making it impossible to forget the gateway. They take the same
// options as `withApi()` but expose one HTTP method per call.

export function GET<TParams extends Record<string, string> = Record<string, string>>(
  options: WithApiOptions<TParams>,
  handler: ApiHandlerFn<TParams>,
) {
  return withApi(options, handler);
}
export function POST<TParams extends Record<string, string> = Record<string, string>>(
  options: WithApiOptions<TParams>,
  handler: ApiHandlerFn<TParams>,
) {
  return withApi(options, handler);
}
export function PUT<TParams extends Record<string, string> = Record<string, string>>(
  options: WithApiOptions<TParams>,
  handler: ApiHandlerFn<TParams>,
) {
  return withApi(options, handler);
}
export function PATCH<TParams extends Record<string, string> = Record<string, string>>(
  options: WithApiOptions<TParams>,
  handler: ApiHandlerFn<TParams>,
) {
  return withApi(options, handler);
}
export function DELETE<TParams extends Record<string, string> = Record<string, string>>(
  options: WithApiOptions<TParams>,
  handler: ApiHandlerFn<TParams>,
) {
  return withApi(options, handler);
}