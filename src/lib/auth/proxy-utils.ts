/**
 * Proxy utilities for secure request handling
 *
 * SECURITY NOTE:
 * Never trust X-Forwarded-Proto directly from client requests - it can be spoofed.
 * Instead, either:
 * 1. Set COOKIE_REQUIRE_HTTPS=true in production to force Secure cookie flag
 * 2. Configure TRUSTED_PROXY with your proxy's IP/CIDR prefix
 *
 * In production deployments (behind a reverse proxy like nginx/cloudflare):
 * - The proxy strips and re-adds X-Forwarded-* headers with trusted values
 * - Set COOKIE_REQUIRE_HTTPS=true to ensure Secure flag is always set
 * - This prevents attacks where a malicious actor sends fake X-Forwarded-Proto: https
 */

import { NextRequest } from 'next/server';
import { SECURITY } from '@/lib/constants';

/**
 * Determine if the current request is over HTTPS
 *
 * @param request - Next.js request object
 * @returns true if the request should be considered HTTPS
 */
export function getIsHttps(request: NextRequest): boolean {
  // Production deployments should set COOKIE_REQUIRE_HTTPS=true
  // This forces Secure cookie flag regardless of proxy headers
  if (SECURITY.COOKIE_REQUIRE_HTTPS) {
    return true;
  }

  // Fallback: check actual request URL scheme
  // This only works when there's no proxy in front, or proxy is trusted
  return request.url.startsWith('https://');
}

/**
 * Verify that the Origin header matches the current request host.
 * Used as a lightweight CSRF defense for state-changing endpoints.
 *
 * In production, rely on COOKIE_REQUIRE_HTTPS + SameSite=lax cookie.
 * For defense in depth, reject cross-origin POSTs.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // If no Origin header (e.g., same-origin GET, or non-browser client), allow
  // Browsers always send Origin on cross-origin POSTs; same-origin POSTs may include it
  if (!origin) {
    return true;
  }

  if (!host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}
