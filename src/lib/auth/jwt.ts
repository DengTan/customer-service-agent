/**
 * JWT utilities for authentication
 * 
 * Security notes:
 * - JWT_SECRET environment variable is REQUIRED in production
 * - Falls back to COZE_SUPABASE_SERVICE_ROLE_KEY if available
 * - Uses a weak default only for development (with warning)
 */

import jwt from 'jsonwebtoken';
import type { UserRole } from '@/lib/types';
import { logger as loggerCollection } from '@/lib/logger';
const authLogger = loggerCollection.auth;

export interface JWTPayload {
  sub: string;       // User ID
  email: string;
  name: string;
  role: UserRole;
  avatar: string | null;
  iat?: number;      // Issued at
  exp?: number;      // Expiration time
}

// ─── Secret Management ──────────────────────────────────────

const DEV_DEFAULT_SECRET = 'dev-secret-change-in-production';
let _resolvedSecret: string | null = null;
let _secretWarnings: string[] = [];

/**
 * Check if running in production mode
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COZE_PROJECT_ENV === 'PROD';
}

/**
 * Resolve and validate JWT secret.
 * In production, this will throw if no proper secret is configured.
 */
function getResolvedSecret(): string {
  if (_resolvedSecret) return _resolvedSecret;

  const envSecret = process.env.JWT_SECRET || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';
  const isProd = isProduction();
  _secretWarnings = [];

  if (!envSecret) {
    if (isProd) {
      // Production without secret: FATAL ERROR
      throw new Error(
        '[Auth] FATAL: No JWT_SECRET or COZE_SUPABASE_SERVICE_ROLE_KEY configured in production.\n' +
        '         Please set JWT_SECRET environment variable to a strong random value (min 32 chars).\n' +
        '         Generate with: node -e "console.log(require("crypto").randomBytes(32).toString("hex"))"'
      );
    }
    // Development: warn and use default
    authLogger.warn('No JWT_SECRET set, using development default secret. DO NOT use in production!');
    _secretWarnings.push('Using development default secret (production requires JWT_SECRET)');
    _resolvedSecret = DEV_DEFAULT_SECRET;
    return _resolvedSecret;
  }

  // Check if using the weak default explicitly
  if (envSecret === DEV_DEFAULT_SECRET) {
    if (isProd) {
      // Production with default secret: FATAL ERROR
      throw new Error(
        '[Auth] FATAL: Using default development secret in production!\n' +
        '         This is a critical security vulnerability.\n' +
        '         Set JWT_SECRET to a strong random value (min 32 chars).'
      );
    }
    authLogger.warn('Using default development secret. DO NOT use in production!');
    _secretWarnings.push('Using default development secret');
  }

  // Check secret length
  if (envSecret.length < 32) {
    if (isProd) {
      // Production with short secret: FATAL ERROR
      throw new Error(
        `[Auth] FATAL: JWT secret is only ${envSecret.length} characters.\n` +
        '         Production secrets must be at least 32 characters.\n' +
        '         Generate with: node -e "console.log(require("crypto").randomBytes(32).toString("hex"))"'
      );
    }
    authLogger.warn('JWT secret is too short', {
      length: envSecret.length,
      recommended: 32,
    });
    _secretWarnings.push(`Weak secret length (${envSecret.length} chars, recommended: 32+)`);
  }

  _resolvedSecret = envSecret;
  return _resolvedSecret;
}

/** Get current JWT secret (validated) */
export function getJWTSecret(): string {
  return getResolvedSecret();
}

/**
 * Check if using a strong secret
 */
export function hasStrongSecret(): boolean {
  const secret = _resolvedSecret || process.env.JWT_SECRET || process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';
  return secret !== DEV_DEFAULT_SECRET && secret.length >= 32;
}

/**
 * Get authentication warnings (for health checks)
 */
export function getAuthWarnings(): string[] {
  // Trigger secret resolution to capture warnings
  try {
    getResolvedSecret();
  } catch {
    // Fatal errors are handled separately
  }
  return [..._secretWarnings];
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';  // Configurable via env

// ─── Token Operations ───────────────────────────────────────

/**
 * Generate a JWT token for a user
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const secret = getResolvedSecret();
  // Parse expiresIn: support formats like "8h", "30m", "1d", or numeric seconds
  const envExpiresIn = process.env.JWT_EXPIRES_IN || '8h';
  
  return jwt.sign(
    payload, 
    secret, 
    { expiresIn: envExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

/**
 * Verify and decode a JWT token
 * Returns decoded payload or null if invalid/expired
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const secret = getResolvedSecret();
    const decoded = jwt.verify(token, secret) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Decode token without verification (for debugging only)
 * Returns payload without checking signature/expiry
 */
export function decodeTokenUnsafe(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload | null;
  } catch {
    return null;
  }
}

// ─── Cookie Helpers ──────────────────────────────────────────

/**
 * Extract auth_token value from Cookie header string
 */
export function extractTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, ...rest] = cookie.trim().split('=');
    acc[key] = rest.join('=');  // Handle values containing '='
    return acc;
  }, {} as Record<string, string>);
  
  return cookies['auth_token'] || null;
}

/**
 * Generate HTTP-only cookie options for JWT token storage
 * @param isHttps - Whether the request is over HTTPS
 */
export function getTokenCookieOptions(isHttps: boolean = false, expiresInSeconds: number = 8 * 60 * 60) {
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  
  // Secure cookies are only sent over HTTPS
  // If we're on HTTPS, always use secure=true for security
  const shouldSecure = isHttps;
  
  return {
    httpOnly: true,
    secure: shouldSecure,
    sameSite: 'lax' as const,
    path: '/',
    domain: cookieDomain,
    maxAge: expiresInSeconds,
  };
}

/**
 * Parse Authorization header for Bearer token
 * Used for API clients that can't use cookies (e.g., mobile apps)
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
