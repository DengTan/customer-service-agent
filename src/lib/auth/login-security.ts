/**
 * Login Security Service
 * 
 * Handles:
 * - Login attempt tracking (in-memory, per-process)
 * - Account lockout after N consecutive failures
 * - Login event logging
 * 
 * Note: In a multi-instance deployment, this should use Redis or database.
 */

import crypto from 'crypto';
import { getIPFromRequest } from './ip-utils';
import { logger as loggerCollection } from '@/lib/logger';
import { AUTH } from '@/lib/constants';

const securityLogger = loggerCollection.security;

// ─── Helpers ────────────────────────────────────────────────

/**
 * Hash email for logging purposes to avoid storing PII in logs
 */
function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

// ─── Types ──────────────────────────────────────────────────

interface LoginAttempt {
  count: number;
  lastAttempt: number;      // timestamp
  lockedUntil: number | null; // timestamp when lockout expires
}

interface LoginEvent {
  userId: string;
  email: string;
  success: boolean;
  ip: string;
  userAgent: string;
  reason?: string;          // failure reason code
  timestamp: string;
}

// ─── In-Memory Store ────────────────────────────────────────

const MAX_LOGIN_ATTEMPTS = 10000;

const loginAttempts = new Map<string, LoginAttempt>();
const recentLoginEvents: LoginEvent[] = [];  // Keep last 100 events for debugging
/** Periodically clean up old entries (every minute) */
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    const expiry = AUTH.LOGIN_LOCKOUT_MINUTES * 60 * 1000;

    // Remove expired entries
    for (const [email, attempt] of loginAttempts) {
      if (!attempt.lockedUntil && now - attempt.lastAttempt > expiry && attempt.count === 0) {
        loginAttempts.delete(email);
      } else if (attempt.lockedUntil && now > attempt.lockedUntil) {
        // Lockout expired - reset but keep the record
        attempt.lockedUntil = null;
        attempt.count = 0;
      }
    }
  }, 60_000);
}

// ─── Public API ─────────────────────────────────────────────

export class LoginSecurityService {
  /**
   * Check if an email is currently locked out due to too many failed attempts
   */
  static isLockedOut(email: string): { locked: boolean; remainingSeconds: number; attemptsLeft: number } {
    const normalizedEmail = email.toLowerCase().trim();
    const attempt = loginAttempts.get(normalizedEmail);

    if (!attempt || !attempt.lockedUntil) {
      return { 
        locked: false, 
        remainingSeconds: 0,
        attemptsLeft: AUTH.LOGIN_MAX_ATTEMPTS - (attempt?.count ?? 0)
      };
    }

    const now = Date.now();
    if (now > attempt.lockedUntil) {
      // Lockout has expired
      attempt.lockedUntil = null;
      attempt.count = 0;
      return { locked: false, remainingSeconds: 0, attemptsLeft: AUTH.LOGIN_MAX_ATTEMPTS };
    }

    const remainingSeconds = Math.ceil((attempt.lockedUntil - now) / 1000);
    return { 
      locked: true, 
      remainingSeconds,
      attemptsLeft: 0
    };
  }

  /**
   * Record a successful login attempt
   */
  static recordSuccess(email: string, userId: string, request: Request): void {
    const normalizedEmail = email.toLowerCase().trim();

    // Reset failure counter on success
    const attempt = loginAttempts.get(normalizedEmail);
    if (attempt) {
      attempt.count = 0;
      attempt.lockedUntil = null;
    }

    // Log event
    this._logEvent({
      userId,
      email: normalizedEmail,
      success: true,
      ip: getIPFromRequest(request),
      userAgent: request.headers.get('user-agent') || 'unknown',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a failed login attempt
   * Returns true if the user should be locked out after this attempt
   */
  static recordFailure(email: string, reason: string, request: Request): void {
    const normalizedEmail = email.toLowerCase().trim();

    // Enforce size limit to prevent memory exhaustion
    if (loginAttempts.size >= MAX_LOGIN_ATTEMPTS) {
      const oldestKey = loginAttempts.keys().next().value;
      if (oldestKey) loginAttempts.delete(oldestKey);
    }

    let attempt = loginAttempts.get(normalizedEmail);
    if (!attempt) {
      attempt = { count: 0, lastAttempt: Date.now(), lockedUntil: null };
      loginAttempts.set(normalizedEmail, attempt);
    }

    attempt.count += 1;
    attempt.lastAttempt = Date.now();

    // Check if should lock out
    if (attempt.count >= AUTH.LOGIN_MAX_ATTEMPTS && !attempt.lockedUntil) {
      attempt.lockedUntil = Date.now() + AUTH.LOGIN_LOCKOUT_MINUTES * 60 * 1000;
      
      securityLogger.warn(
        `Account locked: ${normalizedEmail}`, { failedAttempts: attempt.count }
      );
    }

    // Log event (anonymize for failures)
    this._logEvent({
      userId: '',
      email: normalizedEmail,
      success: false,
      ip: getIPFromRequest(request),
      userAgent: request.headers.get('user-agent') || 'unknown',
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get current attempt info (for admin/debugging)
   */
  static getAttemptInfo(email: string): LoginAttempt | undefined {
    return loginAttempts.get(email.toLowerCase().trim());
  }

  /**
   * Manually unlock an account (admin action)
   */
  static unlockAccount(email: string): boolean {
    const normalizedEmail = email.toLowerCase().trim();
    const attempt = loginAttempts.get(normalizedEmail);
    
    if (attempt) {
      attempt.count = 0;
      attempt.lockedUntil = null;
      return true;
    }
    
    return false;
  }

  /**
   * Get recent login events (for admin dashboard)
   */
  static getRecentEvents(limit: number = 20): LoginEvent[] {
    return recentLoginEvents.slice(-limit).reverse(); // Most recent first
  }

  // ─── Private Methods ───────────────────────────────────────

  private static _logEvent(event: LoginEvent): void {
    recentLoginEvents.push(event);

    // Trim log if too long
    while (recentLoginEvents.length > AUTH.LOGIN_MAX_LOG_EVENTS) {
      recentLoginEvents.shift();
    }

    // Hash email for logging to avoid storing PII
    const emailHash = hashEmail(event.email);

    // Also log to structured logger for server-side visibility
    if (event.success) {
      securityLogger.info('Login success', {
        emailHash,
        ip: event.ip,
        userAgent: event.userAgent,
      });
    } else {
      securityLogger.warn('Login failed', {
        emailHash,
        ip: event.ip,
        reason: event.reason,
        userAgent: event.userAgent,
      });
    }
  }
}
