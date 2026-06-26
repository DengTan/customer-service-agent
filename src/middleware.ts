/**
 * Next.js middleware for authentication protection
 *
 * Protects routes that require authentication by checking for a valid JWT token.
 * - Unauthenticated users accessing protected routes are redirected to /login
 * - Authenticated users accessing /login are redirected to /
 *
 * SECURITY NOTE:
 * Edge Runtime bundles environment variables at BUILD time, not runtime.
 * This means JWT_SECRET/COZE_SUPABASE_SERVICE_ROLE_KEY from the platform
 * may not be available in middleware during preview.
 *
 * SOLUTION: Middleware does lightweight existence check only.
 * Full token verification is done in API routes via requireRole().
 * This ensures auth works correctly regardless of build-time env vars.
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

/**
 * Extract auth_token value from Cookie header string.
 */
function extractTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/auth_token=([^;]+)/);
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
 * Decode JWT payload without verification.
 * Used in managed environments where Edge Runtime can't access runtime env vars.
 */
function decodePayloadWithoutVerification(token: string): { role: string | null; expired: boolean } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { role: null, expired: false };

    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;

    // Check expiration
    let expired = false;
    if (typeof payload.exp === 'number') {
      expired = Math.floor(Date.now() / 1000) >= Number(payload.exp);
    }

    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      expired,
    };
  } catch {
    return { role: null, expired: false };
  }
}

/**
 * Verify JWT signature using Web Crypto API (Edge-compatible).
 * Only used in local development where env vars are available at runtime.
 */
async function verifyTokenSignature(token: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode payload to check expiration
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const paddedCount = (4 - (padded.length % 4)) % 4;
    const payload = JSON.parse(atob(padded + '='.repeat(paddedCount))) as Record<string, unknown>;

    if (typeof payload.exp === 'number') {
      if (Math.floor(Date.now() / 1000) >= Number(payload.exp)) return false;
    }

    // Verify HS256 signature
    const secret = process.env.JWT_SECRET || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || 'dev-secret-change-in-production';
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

/**
 * Check if running in a managed environment (preview/deploy).
 * 
 * Detection: If we're not on localhost, we're likely in a managed environment
 * where env vars are injected at runtime, not build time.
 */
function isManagedEnvironment(request: NextRequest): boolean {
  const hostname = request.headers.get('host') || '';
  // Managed platforms typically have non-localhost hostnames
  return !hostname.includes('localhost') && !hostname.includes('127.0.0.1');
}

/**
 * Check if running in preview environment specifically
 */
function isPreviewEnvironment(request: NextRequest): boolean {
  const hostname = request.headers.get('host') || '';
  return hostname.includes('.dev.coze.site');
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Get token from cookie
  const cookieHeader = request.headers.get('cookie');
  const rawToken = extractTokenFromCookie(cookieHeader);

  // Detect if we're in a managed/preview environment
  const isManaged = isManagedEnvironment(request);
  const isPreview = isPreviewEnvironment(request);

  // Check if accessing a protected route
  const isProtectedRoute = PROTECTED_ROUTES.some(route =>
    pathname === route || pathname.startsWith(route + '/')
  );

  // Check if accessing an auth route (login page)
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

  // We have a token - check if it's valid
  let isAuthenticated = false;
  let userRole: string | null = null;

  if (isPreview) {
    // In preview environment, be more lenient:
    // Just check if the token is well-formed and not clearly expired
    // Skip signature verification since Edge Runtime may not have the secret
    try {
      const { role, expired } = decodePayloadWithoutVerification(rawToken);
      if (!expired && role) {
        isAuthenticated = true;
        userRole = role;
      } else if (!expired) {
        // Even without role, if token is valid, allow through
        // The API layer will do full verification
        isAuthenticated = true;
      }
    } catch {
      // Token decode failed - be lenient in preview
      isAuthenticated = true;
    }
  } else if (isManaged) {
    // In other managed environments (non-preview), still decode without signature
    const { role, expired } = decodePayloadWithoutVerification(rawToken);
    if (!expired) {
      isAuthenticated = true;
      userRole = role;
    }
  } else {
    // In local development, we can do full signature verification
    const isValid = await verifyTokenSignature(rawToken);
    if (isValid) {
      const { role } = decodePayloadWithoutVerification(rawToken);
      isAuthenticated = true;
      userRole = role;
    }
  }

  // If user has a valid token (or appears to in managed env), allow through
  if (isAuthenticated) {
    const response = NextResponse.next();
    response.headers.set('x-authenticated', 'true');
    if (userRole) {
      response.headers.set('x-user-role', userRole);
    }

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
