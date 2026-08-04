# E2E Authentication Matrix Tests

## Overview

This directory contains end-to-end tests for the SmartAssist customer service agent, focusing on authentication and authorization testing.

## Phase C2: E2E Authentication Matrix Framework

The auth matrix tests verify that:

1. **Unauthenticated requests** return 401 Unauthorized
2. **Wrong role requests** return 403 Forbidden
3. **Correct role requests** return 2xx Success (or resource-specific errors like 404)

## Quick Start

### Prerequisites

1. Start the development server:
   ```bash
   pnpm dev:win
   ```

2. Install Playwright browsers (one-time):
   ```bash
   npx playwright install chromium --with-deps
   ```

### Running Tests

```bash
# Run all E2E tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test file
npx playwright test auth-matrix.spec.ts

# Run with headed browser
npx playwright test --headed

# Run tests in CI mode
npx playwright test --reporter=github-actions
```

## Test Structure

```
tests/e2e/
├── auth-matrix.spec.ts      # Main auth matrix tests
├── helpers/
│   ├── index.ts             # Helper exports
│   ├── auth.ts              # Authentication helpers
│   └── roles.ts             # Role definitions
├── utils/
│   ├── index.ts             # Utility exports
│   └── server-status.ts     # Server health check
└── logger.ts                # Test logging utility
```

## Role Definitions

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| admin | admin@smartassist.com | Admin123456 | Full access |
| agent | agent@smartassist.com | Agent123456 | Limited access |
| observer | observer@smartassist.com | Observer123456 | Read-only access |

## Test Coverage

The auth matrix covers these API routes:

### Conversations
- `GET /api/conversations` - all authenticated
- `POST /api/conversations` - all authenticated
- `POST /api/conversations/:id/handoff` - agent+
- `POST /api/conversations/:id/internal-note` - agent+
- `POST /api/conversations/:id/rating` - all authenticated
- `POST /api/conversations/:id/participants` - agent+

### Knowledge
- `GET /api/knowledge/items` - all authenticated
- `GET /api/knowledge/products` - all authenticated
- `GET /api/knowledge/size-charts` - all authenticated

### Marketing
- `GET /api/marketing` - all authenticated
- `POST /api/marketing/execute` - admin only

### Tools
- `POST /api/tools/order-query` - all authenticated
- `POST /api/tools/logistics-query` - all authenticated
- `POST /api/tools/refund-action` - agent+

### Agent
- `GET /api/agent/queue` - agent+
- `GET /api/agent/performance` - agent+
- `PATCH /api/agent/status` - agent+

### Export
- `GET /api/export/conversations` - admin only

### Users & Customers
- `GET /api/users` - admin only
- `GET /api/customers` - all authenticated
- `GET /api/tickets` - all authenticated

## Test Suites

### 1. Unauthenticated Access
Tests that unauthenticated requests to all routes return 401.

### 2. Wrong Role Access
Tests that users without the required role receive 403 (or 404 for non-existent resources).

### 3. Correct Role Access
Tests that users with the correct role can access their authorized routes.

### 4. UI Authentication Flow
- Login page visibility for unauthenticated users
- Admin login
- Agent login
- Invalid credential handling
- Logout functionality

### 5. Session Persistence
Tests that authenticated sessions persist across page navigation.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_BASE_URL` | http://localhost:5000 | Base URL for tests |
| `E2E_LOG_LEVEL` | info | Logging level (debug/info/warn/error) |

## Troubleshooting

### Server Not Running
```
Error: connect ECONNREFUSED
```
Make sure the dev server is running: `pnpm dev:win`

### Login Failed
```
Error: Login failed for admin@smartassist.com: 401
```
Check that the test users exist in the database. Run:
```bash
node scripts/db-admin.js init
```

### Tests Timeout
Increase timeout in `playwright.config.ts`:
```typescript
timeout: 60_000, // 60 seconds
```

## Extending Tests

### Adding New Routes

1. Add the route to `ROUTES_TO_TEST` array in `auth-matrix.spec.ts`:

```typescript
{
  path: '/api/your/new-route',
  method: 'POST',
  expectedRoles: 'agent+', // or 'admin', 'all'
  description: 'Your route description',
  body: { /* request body if needed */ },
}
```

2. Run the tests to verify:
   ```bash
   npx playwright test auth-matrix.spec.ts
   ```

### Adding New Roles

1. Update `helpers/roles.ts`:

```typescript
export const ROLES = {
  // ... existing roles
  custom_role: {
    email: 'custom@example.com',
    password: 'Custom123456',
    displayName: 'Custom Role',
  },
} as const;
```

2. Update role arrays if needed:
```typescript
export const ADMIN_ROLES: RoleName[] = ['admin'];
export const LIMITED_ROLES: RoleName[] = ['agent', 'observer'];
```

## Reports

Test reports are generated in HTML format. After running tests:

- Open `playwright-report/index.html` for interactive report
- GitHub Actions generates `test-results/` artifacts

## CI Integration

Example GitHub Actions workflow:

```yaml
- name: Run E2E Tests
  run: npx playwright test --reporter=github-actions
```

## Notes

- Tests run in parallel by default (Chromium only)
- Set `CI=true` for CI environments to enable retries and sequential execution
- The auth matrix is designed to catch auth/permission bugs early in development
