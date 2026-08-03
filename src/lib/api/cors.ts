/**
 * CORS preflight short-circuit + access-control headers.
 *
 * Stage A / A5b introduces OPTIONS short-circuiting so that browsers' CORS
 * preflights do NOT touch auth / rate-limit / idempotency logic. The same
 * applies to HEAD: it returns headers only, no business handler is invoked.
 *
 * Stage A / A5c also pipes `application/problem+json` responses through here
 * so error responses carry the same allow-origin / allow-methods headers.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const DEFAULT_ALLOW_ORIGIN = '*';
const DEFAULT_ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD';
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization, x-request-id';
const DEFAULT_MAX_AGE_SECONDS = '86400';

/**
 * Read the configured allowed origin from the incoming request. Allows
 * environment overrides via `CORS_ALLOW_ORIGIN` (single value or comma-list).
 */
function resolveAllowOrigin(request: NextRequest): string {
  const env = process.env.CORS_ALLOW_ORIGIN;
  if (env && env.trim()) return env.trim();
  const origin = request.headers.get('origin');
  return origin || DEFAULT_ALLOW_ORIGIN;
}

export interface CorsPreflightResult {
  response: NextResponse;
}

/**
 * Build a 204 preflight response with the standard CORS allow-* headers.
 * IMPORTANT: This response is produced WITHOUT invoking auth, rate-limit,
 * or idempotency checks (RC-1 / Q2 decision A).
 */
export function handleCorsPreflight(request: NextRequest): CorsPreflightResult {
  const allowOrigin = resolveAllowOrigin(request);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': process.env.CORS_ALLOW_METHODS ?? DEFAULT_ALLOW_METHODS,
    'Access-Control-Allow-Headers': process.env.CORS_ALLOW_HEADERS ?? DEFAULT_ALLOW_HEADERS,
    'Access-Control-Max-Age': process.env.CORS_MAX_AGE ?? DEFAULT_MAX_AGE_SECONDS,
    Vary: 'Origin',
  };
  return {
    response: new NextResponse(null, { status: 204, headers }),
  };
}

/**
 * Attach CORS headers to an existing response (used by `problemResponse`
 * and the L2 gateway wrapper so that error bodies also pass preflights).
 */
export function attachCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const allowOrigin = resolveAllowOrigin(request);
  response.headers.set('Access-Control-Allow-Origin', allowOrigin);
  response.headers.set('Vary', 'Origin');
  return response;
}

/**
 * Build a HEAD response mirroring the CORS headers without invoking the
 * business handler. We return 200 with an empty body so caches/clients see
 * the same access-control contract as a real GET.
 */
export function handleHeadShortCircuit(request: NextRequest): NextResponse {
  const allowOrigin = resolveAllowOrigin(request);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    Vary: 'Origin',
  };
  return new NextResponse(null, { status: 200, headers });
}