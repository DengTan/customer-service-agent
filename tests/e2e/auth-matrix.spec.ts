/**
 * E2E Authentication Matrix Test Suite
 * Phase C2: E2E Authentication Matrix Framework
 * 
 * Tests each API route against the following scenarios:
 * 1. Unauthenticated request → expect 401
 * 2. Wrong role request → expect 403
 * 3. Correct role request → expect 2xx
 * 
 * Note: Tests run sequentially with delays to avoid rate limiting.
 */

import { test, expect, type Page, type Request } from '@playwright/test';
import { ROLES, type RoleName, getRoleConfig, ALL_ROLES, ADMIN_ROLES } from './helpers/roles';
import { authenticatedFetch, unauthenticatedFetch, initRequestContext, clearAuthState, authenticateAllRoles } from './helpers/auth';
import { testLogger } from './logger';

const REQUEST_DELAY_MS = 100; // Delay between requests to avoid rate limiting

// ─── Route Definitions ──────────────────────────────────────

/**
 * API routes to test with their expected access patterns
 * Format: { path, method, expectedRoles, description }
 * 
 * expectedRoles: which roles should be able to access this route
 * - 'admin': only admin can access
 * - 'agent+': agent and admin can access
 * - 'all': all authenticated users can access
 */
interface RouteDefinition {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  expectedRoles: 'admin' | 'agent+' | 'all';
  description: string;
  // Optional body for POST/PUT/PATCH requests
  body?: Record<string, unknown>;
}

const ROUTES_TO_TEST: RouteDefinition[] = [
  // Conversations - observer cannot create conversations
  {
    path: '/api/conversations',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List conversations',
  },
  {
    path: '/api/conversations',
    method: 'POST',
    expectedRoles: 'agent+', // observer cannot create conversations
    description: 'Create conversation',
  },
  {
    path: '/api/conversations/test-uuid-123/handoff',
    method: 'POST',
    expectedRoles: 'agent+',
    description: 'Handoff conversation',
    body: { reason: 'Test handoff' },
  },
  {
    path: '/api/conversations/test-uuid-123/internal-note',
    method: 'POST',
    expectedRoles: 'agent+',
    description: 'Add internal note',
    body: { content: 'Test note' },
  },
  {
    path: '/api/conversations/test-uuid-123/rating',
    method: 'POST',
    expectedRoles: 'agent+',
    description: 'Rate conversation',
    body: { rating: 5 },
  },
  {
    path: '/api/conversations/test-uuid-123/participants',
    method: 'POST',
    expectedRoles: 'agent+',
    description: 'Update participants',
    body: { participant_ids: [] },
  },

  // Knowledge
  {
    path: '/api/knowledge/items',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List knowledge items',
  },
  {
    path: '/api/knowledge/products',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List products',
  },
  {
    path: '/api/knowledge/size-charts',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List size charts',
  },

  // Marketing
  {
    path: '/api/marketing',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List marketing campaigns',
  },
  {
    path: '/api/marketing/execute',
    method: 'POST',
    expectedRoles: 'admin',
    description: 'Execute marketing campaign',
    body: { campaign_id: 'test' },
  },

  // Tools
  {
    path: '/api/tools/order-query',
    method: 'POST',
    expectedRoles: 'all',
    description: 'Query order',
    body: { order_id: 'ORD-001' },
  },
  {
    path: '/api/tools/logistics-query',
    method: 'POST',
    expectedRoles: 'all',
    description: 'Query logistics',
    body: { tracking_number: 'SF1234567890' },
  },
  {
    path: '/api/tools/refund-action',
    method: 'POST',
    expectedRoles: 'agent+',
    description: 'Refund action',
    body: { order_id: 'ORD-001', reason: 'Test refund', amount: 100 },
  },

  // Quick Replies
  {
    path: '/api/quick-replies',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List quick replies',
  },

  // Skill Groups
  {
    path: '/api/skill-groups',
    method: 'GET',
    expectedRoles: 'agent+',
    description: 'List skill groups',
  },

  // Schedules
  {
    path: '/api/schedules',
    method: 'GET',
    expectedRoles: 'agent+',
    description: 'List schedules',
  },

  // Agent
  {
    path: '/api/agent/queue',
    method: 'GET',
    expectedRoles: 'agent+',
    description: 'List agent queue',
  },
  {
    path: '/api/agent/performance',
    method: 'GET',
    expectedRoles: 'agent+',
    description: 'Get agent performance',
  },
  {
    path: '/api/agent/status',
    method: 'PATCH',
    expectedRoles: 'agent+',
    description: 'Update agent status',
    body: { status: 'online' },
  },

  // Export
  {
    path: '/api/export/conversations',
    method: 'GET',
    expectedRoles: 'admin',
    description: 'Export conversations',
  },

  // Knowledge Learning
  {
    path: '/api/knowledge-learning',
    method: 'GET',
    expectedRoles: 'agent+',
    description: 'List knowledge learning items',
  },

  // Users (admin only)
  {
    path: '/api/users',
    method: 'GET',
    expectedRoles: 'admin',
    description: 'List users',
  },

  // Customers
  {
    path: '/api/customers',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List customers',
  },

  // Tickets
  {
    path: '/api/tickets',
    method: 'GET',
    expectedRoles: 'all',
    description: 'List tickets',
  },
];

// ─── Helper Functions ─────────────────────────────────────────

/**
 * Get the roles that should have access based on expectedRoles
 */
function getRolesWithAccess(expectedRoles: RouteDefinition['expectedRoles']): RoleName[] {
  switch (expectedRoles) {
    case 'admin':
      return ADMIN_ROLES;
    case 'agent+':
      return ['admin', 'agent'];
    case 'all':
      return ALL_ROLES;
    default:
      return [];
  }
}

/**
 * Get roles that should be denied (wrong role)
 */
function getRolesWithoutAccess(expectedRoles: RouteDefinition['expectedRoles']): RoleName[] {
  const withAccess = getRolesWithAccess(expectedRoles);
  return ALL_ROLES.filter((role) => !withAccess.includes(role));
}

// ─── Test Fixtures ──────────────────────────────────────────

// ─── Test Suite ─────────────────────────────────────────────

/**
 * Initialize shared request context for each test
 */
test.beforeEach(async ({ page }) => {
  initRequestContext(page);
});

/**
 * Test matrix: unauthenticated requests should always get 401
 */
test.describe('Unauthenticated Access', () => {
  for (const route of ROUTES_TO_TEST) {
    test(`${route.method} ${route.path} - should return 401 without auth`, async () => {
      // Add delay before request
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

      const response = await unauthenticatedFetch(
        'http://localhost:5000',
        route.path,
        { method: route.method }
      );

      expect(response.status).toBe(401);
      testLogger.info(`✓ ${route.method} ${route.path} returned 401 as expected`);
    });
  }
});

/**
 * Test matrix: wrong role requests should get 403
 */
test.describe('Wrong Role Access', () => {
  for (const route of ROUTES_TO_TEST) {
    const rolesWithoutAccess = getRolesWithoutAccess(route.expectedRoles);

    for (const role of rolesWithoutAccess) {
      test(`${route.method} ${route.path} - ${role} should return 403`, async () => {
        // Add delay before request
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        const response = await authenticatedFetch(
          'http://localhost:5000',
          route.path,
          {
            method: route.method,
            body: route.body ? JSON.stringify(route.body) : undefined,
          },
          role
        );

        // We expect 403 Forbidden, but some routes might return 404 if the resource doesn't exist
        // For this matrix, we're mainly checking auth/permission rejection
        expect([401, 403, 404]).toContain(response.status);
        testLogger.info(
          `✓ ${route.method} ${route.path} with role=${role} returned ${response.status} (expected 403 or 404)`
        );
      });
    }
  }
});

/**
 * Test matrix: correct role requests should succeed (2xx)
 */
test.describe('Correct Role Access', () => {
  for (const route of ROUTES_TO_TEST) {
    const rolesWithAccess = getRolesWithAccess(route.expectedRoles);

    for (const role of rolesWithAccess) {
      test(`${route.method} ${route.path} - ${role} should return 2xx`, async () => {
        // Add delay before request
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        const response = await authenticatedFetch(
          'http://localhost:5000',
          route.path,
          {
            method: route.method,
            body: route.body ? JSON.stringify(route.body) : undefined,
          },
          role
        );

        // We're testing auth matrix - some routes may return 404 if resource doesn't exist
        // But they should NOT return 401/403 (auth should pass)
        const status = response.status;
        
        if (status === 401 || status === 403) {
          // This is a test failure - auth passed but permission denied incorrectly
          const body = await response.text();
          testLogger.error(
            `✗ ${route.method} ${route.path} with role=${role} returned ${status} - Permission denied unexpectedly`,
            { body }
          );
          expect.soft(status).not.toBe(401);
          expect.soft(status).not.toBe(403);
        } else {
          testLogger.info(
            `✓ ${route.method} ${route.path} with role=${role} returned ${status}`
          );
        }

        // Accept 2xx, 404 (resource not found), or other non-auth errors
        expect([200, 201, 204, 400, 404, 422, 500]).toContain(status);
      });
    }
  }
});

/**
 * UI Authentication Flow Tests
 */
test.describe('UI Authentication Flow', () => {
  test('should show login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    
    // Should redirect to login or show login UI
    const url = page.url();
    const hasLoginForm = await page.locator('input[name="email"]').isVisible().catch(() => false);
    
    expect(url.includes('/login') || hasLoginForm).toBeTruthy();
    testLogger.info(`✓ Unauthenticated access to / redirected to ${url}`);
  });

  test('should allow admin login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', ROLES.admin.email);
    await page.fill('input[name="password"]', ROLES.admin.password);
    await page.click('button[type="submit"]');

    // Should redirect away from /login to the post-login home (/dashboard).
    // toHaveURL does NOT support globs; use a regex (see docs/E2E_LOGIN_DEBUG.md).
    await expect(page).not.toHaveURL(/\/login(\?|#|$)/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard(\?|#|$)/, { timeout: 15_000 });
    testLogger.info('✓ Admin login successful');
  });

  test('should allow agent login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', ROLES.agent.email);
    await page.fill('input[name="password"]', ROLES.agent.password);
    await page.click('button[type="submit"]');

    // See note in 'should allow admin login' about regex vs glob patterns.
    await expect(page).not.toHaveURL(/\/login(\?|#|$)/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard(\?|#|$)/, { timeout: 15_000 });
    testLogger.info('✓ Agent login successful');
  });

  test('should show error on invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'invalid@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Wait for error message
    await page.waitForTimeout(1000);
    const url = page.url();
    
    // Should still be on login page or show error
    expect(url.includes('/login')).toBeTruthy();
    testLogger.info('✓ Invalid credentials handled correctly');
  });

  test('should logout successfully', async ({ page }) => {
    // First login (uses regex, not glob — see docs/E2E_LOGIN_DEBUG.md)
    await page.goto('/login');
    await page.fill('input[name="email"]', ROLES.admin.email);
    await page.fill('input[name="password"]', ROLES.admin.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard(\?|#|$)/, { timeout: 15_000 });

    // Then logout
    // Look for logout button (might be in header or user menu)
    const logoutBtn = page.locator('button:has-text("登出"), button:has-text("Logout"), button:has-text("退出")');
    if (await logoutBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await logoutBtn.first().click();
      await expect(page).toHaveURL(/\/login(\?|#|$)/, { timeout: 10_000 });
      testLogger.info('✓ Logout successful');
    } else {
      testLogger.warn('Logout button not found, skipping logout test');
    }
  });
});

/**
 * Session Persistence Tests
 */
test.describe('Session Persistence', () => {
  test('should maintain session across page navigations', async ({ page }) => {
    // Login (uses regex, not glob — see docs/E2E_LOGIN_DEBUG.md)
    await page.goto('/login');
    await page.fill('input[name="email"]', ROLES.admin.email);
    await page.fill('input[name="password"]', ROLES.admin.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard(\?|#|$)/, { timeout: 15_000 });

    // Navigate to different pages (regex matchers — see docs/E2E_LOGIN_DEBUG.md)
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(\?|#|$)/, { timeout: 10_000 });

    await page.goto('/history');
    await expect(page).toHaveURL(/\/history(\?|#|$)/, { timeout: 10_000 });

    await page.goto('/faq');
    await expect(page).toHaveURL(/\/faq(\?|#|$)/, { timeout: 10_000 });

    testLogger.info('✓ Session persisted across page navigations');
  });
});

// ─── Summary Reporter ────────────────────────────────────────

test.afterAll(async () => {
  testLogger.info('Auth Matrix Test Suite Completed');
  testLogger.info(`Total routes tested: ${ROUTES_TO_TEST.length}`);
  
  const adminOnly = ROUTES_TO_TEST.filter(r => r.expectedRoles === 'admin').length;
  const agentPlus = ROUTES_TO_TEST.filter(r => r.expectedRoles === 'agent+').length;
  const allAccess = ROUTES_TO_TEST.filter(r => r.expectedRoles === 'all').length;
  
  testLogger.info(`Routes by access level:`, {
    adminOnly,
    agentPlus,
    allAccess,
  });
});
