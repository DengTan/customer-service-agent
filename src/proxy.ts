/**
 * Next.js middleware for authentication protection and route access control.
 *
 * This file is named proxy.ts but contains the actual middleware implementation.
 * It protects routes that require authentication by checking for a valid JWT token.
 * - Unauthenticated users accessing protected routes are redirected to /login
 * - Authenticated users accessing /login are redirected to /
 *
 * SECURITY MODEL (阶段 A / A4):
 * - L1 Edge (this file): verifies the JWT signature using the Edge secret
 *   injected at build time (EDGE_JWT_SECRET). No "decode without verification"
 *   fallback, no hostname-based bypass, no `x-user-role` header injection.
 * - L2 API Gateway: `src/lib/api/with-api.ts` reads the JWT again (full
 *   verification with the runtime secret) and enforces auth/perm/rateLimit.
 * - L3 Route: business logic only.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const PROTECTED_ROUTES = [
  '/',
  '/simulation',
  '/dashboard',
  '/history',
  '/faq',
  '/team',
  '/customers',
  '/workspace',
  '/quality',
  '/marketing',
  '/tickets',
  '/settings',
];

// Routes that should redirect to / if already authenticated
const AUTH_ROUTES = ['/login'];

// IMPORTANT: This MUST match HTTP.JWT_COOKIE_NAME in src/lib/constants.ts.
// proxy.ts runs in Edge Runtime and cannot import from src/lib/constants.ts
// (no Node-only modules may transitively enter the Edge bundle), so we
// hard-code the cookie name here. If you change one, change the other.
// The two production writers (login/logout routes) read the constant.
const AUTH_COOKIE_NAME = 'auth_token';

/**
 * Edge secret used to verify the JWT signature in the Edge Runtime.
 *
 * The Edge bundle is sealed at build time, so it cannot read runtime env
 * vars unless they are inlined via `process.env.EDGE_JWT_SECRET` in this
 * file. Platforms that need a different secret per preview/deploy must
 * set EDGE_JWT_SECRET before `next build`.
 *
 * When this secret is missing we DO NOT silently fall back to "decode
 * without verification" — the request is treated as unauthenticated and
 * the L2 API Gateway re-verifies the token. This is the strict-fail
 * behaviour required by RC-1 (阶段 A / A4).
 */
function getEdgeJwtSecret(): string | null {
  return process.env.EDGE_JWT_SECRET || null;
}

/**
 * Extract auth_token value from Cookie header string.
 * Edge-runtime safe: no Node-only modules used.
 */
function extractAuthCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match?.[1]?.trim() || null;
}

/**
 * Base64URL-safe decode (handles both standard and URL-safe base64).
 */
function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padNeeded = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padNeeded));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert string to Uint8Array (UTF-8).
 */
function textEncode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Verify JWT signature using Web Crypto API (Edge-compatible).
 *
 * Returns true ONLY when the secret is available AND the signature is
 * valid AND the token has not expired. When the secret is missing the
 * function returns false so the request falls through to the L2 API
 * Gateway which has the full runtime secret.
 */
async function verifyTokenSignature(token: string): Promise<boolean> {
  try {
    const secret = getEdgeJwtSecret();
    if (!secret) {
      // No Edge secret configured — refuse to authenticate here.
      // The L2 API Gateway will re-verify with the runtime secret.
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;

    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const paddedCount = (4 - (padded.length % 4)) % 4;
    const payload = JSON.parse(atob(padded + '='.repeat(paddedCount))) as Record<string, unknown>;

    if (typeof payload.exp === 'number') {
      if (Math.floor(Date.now() / 1000) >= Number(payload.exp)) return false;
    }

    const keyData = textEncode(secret);
    const signingInput = textEncode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlDecode(signatureB64);

    const key = await crypto.subtle.importKey(
      'raw',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Crypto API BufferSource type incompatibility
      keyData as any,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Crypto API BufferSource type incompatibility
      signatureBytes as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Crypto API BufferSource type incompatibility
      signingInput as any
    );
  } catch {
    return false;
  }
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Get token from cookie
  const cookieHeader = request.headers.get('cookie');
  const rawToken = extractAuthCookie(cookieHeader);

  const isProtectedRoute = PROTECTED_ROUTES.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  const isAuthRoute = AUTH_ROUTES.some(route => pathname.startsWith(route));

  // If no token, redirect to login for protected routes
  if (!rawToken) {
    if (isProtectedRoute) {
      const loginUrl = new URL('/login', request.url);
      // Use hash instead of query params to avoid leaking path information
      loginUrl.hash = `/redirect=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // We have a token - verify the signature with the Edge secret.
  // Per RC-1 (阶段 A): we NEVER bypass verification based on hostname
  // and we NEVER inject the role back into the response headers.
  const isAuthenticated = await verifyTokenSignature(rawToken);

  // If user has a valid token, allow through
  if (isAuthenticated) {
    const response = NextResponse.next();
    response.headers.set('x-authenticated', 'true');

    // Redirect authenticated users from login page to home
    if (isAuthRoute) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    return response;
  }

  // Token exists but is invalid or expired - redirect to login
  if (isProtectedRoute) {
    const loginUrl = new URL('/login', request.url);
    // Use hash instead of query params to avoid leaking path information
    loginUrl.hash = `/redirect=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     * - api routes (handled by requireRole in api-utils)
     */
    '/((?!_next/static|_next/image|favicon.ico|public|api).*)',
  ],
};
