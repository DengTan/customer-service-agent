/**
 * Authentication Helper Functions for E2E Tests
 * Phase C2: E2E Authentication Matrix Framework
 * 
 * Manages cookies explicitly per-role to avoid browser context cookie persistence issues.
 * Unauthenticated requests use no cookies, authenticated requests include the correct cookie.
 */

import { type Page } from '@playwright/test';
import { ROLES, type RoleName, getRoleConfig } from './roles';
import { testLogger } from '../logger';

// Cookie storage per role (with successful login cache)
const cookiesByRole: Map<RoleName, string> = new Map();

// Track last login time per role to avoid rate limiting
const lastLoginTime: Map<RoleName, number> = new Map();
const MIN_LOGIN_INTERVAL_MS = 1000; // Minimum 1 second between logins to same role

// Initialize the page for cookie management
let currentPage: Page | null = null;

export function initRequestContext(page: Page): void {
  currentPage = page;
  testLogger.debug('Initialized request context');
}

export function clearAuthState(): void {
  cookiesByRole.clear();
  lastLoginTime.clear();
  currentPage = null;
  testLogger.debug('Auth state cleared');
}

/**
 * Login as a specific role and store the auth cookie
 * Uses cached cookies to avoid server rate limiting
 */
export async function loginAs(
  baseURL: string,
  role: RoleName
): Promise<void> {
  // Check if we already have a valid cookie for this role
  if (cookiesByRole.has(role)) {
    const lastLogin = lastLoginTime.get(role) || 0;
    const timeSinceLastLogin = Date.now() - lastLogin;
    
    // If cookie exists and was obtained recently (within 5 minutes), reuse it
    if (timeSinceLastLogin < 5 * 60 * 1000) {
      testLogger.debug(`Reusing cached cookie for ${role}`);
      return;
    }
  }

  const config = getRoleConfig(role);
  testLogger.info(`Logging in as ${config.displayName}`, { role });

  // Make login request
  const loginResponse = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: config.email,
      password: config.password,
    }),
  });

  if (!loginResponse.ok) {
    const errorText = await loginResponse.text();
    throw new Error(
      `Login failed for ${config.email}: ${loginResponse.status} - ${errorText}`
    );
  }

  // Extract cookies from the login response
  const setCookieHeaders = loginResponse.headers.getSetCookie();
  const authCookie = setCookieHeaders.find(c => c.includes('auth_token='));
  
  if (!authCookie) {
    throw new Error(`No auth_token cookie in response for ${config.email}`);
  }

  // Extract just the cookie name=value pair (without attributes)
  const cookieValue = authCookie.split(';')[0].trim();
  
  testLogger.debug(`Cookie extracted: ${cookieValue.substring(0, 80)}...`);
  
  // Store the cookie value
  cookiesByRole.set(role, cookieValue);
  lastLoginTime.set(role, Date.now());
  testLogger.info(`Logged in as ${config.displayName}, cookie stored`);
}

/**
 * Get the stored cookie for a role
 */
export function getCookieForRole(role: RoleName): string | undefined {
  return cookiesByRole.get(role);
}

/**
 * Make an authenticated API request with the correct cookie
 */
export async function authenticatedFetch(
  baseURL: string,
  path: string,
  options: RequestInit = {},
  role: RoleName = 'admin'
): Promise<Response> {
  // Ensure we're logged in
  if (!cookiesByRole.has(role)) {
    testLogger.debug(`No cookie for role ${role}, logging in...`);
    await loginAs(baseURL, role);
  } else {
    testLogger.debug(`Using cached cookie for role ${role}`);
  }

  const cookie = cookiesByRole.get(role);
  if (!cookie) {
    throw new Error(`No cookie available for role ${role}`);
  }

  const body = options.body && typeof options.body === 'string'
    ? options.body
    : options.body
      ? JSON.stringify(options.body)
      : undefined;

  testLogger.debug(`Sending authenticated request`, { role, path, method: options.method });
    
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    body,
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
      'Cookie': cookie,
    },
  });

  // If we get 401, the cookie might be invalid - clear it so next test doesn't reuse bad cookie
  if (response.status === 401) {
    testLogger.warn(`Got 401 for ${path} with role ${role}, clearing cookie`);
    cookiesByRole.delete(role);
  }

  return response;
}

/**
 * Create an unauthenticated fetch (no cookies)
 */
export async function unauthenticatedFetch(
  baseURL: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const body = options.body && typeof options.body === 'string'
    ? options.body
    : options.body
      ? JSON.stringify(options.body)
      : undefined;

  testLogger.debug(`Sending unauthenticated request`, { path, method: options.method });

  return fetch(`${baseURL}${path}`, {
    ...options,
    body,
    headers: {
      ...options.headers,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * UI Login - navigates to login page and fills the form
 */
export async function doLoginAs(page: Page, role: RoleName): Promise<void> {
  const config = getRoleConfig(role);
  testLogger.info(`Logging in via UI as ${config.displayName}`, { role });

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  const submitButton = page.locator('button[type="submit"]');

  await emailInput.fill(config.email);
  await passwordInput.fill(config.password);
  await submitButton.click();

  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }),
    page.waitForURL('**/login**', { timeout: 5000 }).then(() => {
      throw new Error('Login failed - still on login page');
    }),
  ]);

  // Also store the cookie for programmatic use
  const cookies = await page.context().cookies('http://localhost:5000');
  const authCookie = cookies.find(c => c.name === 'auth_token');
  if (authCookie) {
    cookiesByRole.set(role, `auth_token=${authCookie.value}`);
  }

  testLogger.info(`Successfully logged in via UI as ${config.displayName}`, { role });
}

export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.readyState === 'complete');
}

export async function getCsrfToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    const input = document.querySelector('input[name="_csrf"]');
    if (input) return input.getAttribute('value');
    return null;
  });
}

// Backward compatibility
export const ensureAuthenticated = authenticatedFetch;
export const getAuthToken = authenticatedFetch;
export const authenticateAllRoles = async (baseURL: string) => {
  for (const role of Object.keys(ROLES) as RoleName[]) {
    await loginAs(baseURL, role);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
};
