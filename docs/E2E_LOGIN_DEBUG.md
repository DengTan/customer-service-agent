# E2E Login Flow Debug Notes

**Date:** 2026-08-04
**Author:** Cursor (Phase C2 fix)
**Status:** Resolved — all 6 UI/Session tests pass

## Summary

The 4 UI Authentication Flow failures reported in
`docs/ROOT_CAUSE_REMEDIATION_PLAN.md` Section 10 had **two** layered causes:

1. **Real bug (root cause)**: `EDGE_JWT_SECRET` was not configured in the
   dev environment, so `src/proxy.ts` strict-failed-closed (RC-1) and
   redirected every protected-route request back to `/login` even after a
   successful login. This looked like "Edge browser cookie/session
   handling differs from Chrome" because Edge + Chrome are nearly
   identical and both sent the cookie correctly.
2. **Test-side bug (secondary)**: `tests/e2e/auth-matrix.spec.ts` used
   `toHaveURL('**/')` and `waitForURL('**/')` as if Playwright supported
   globs in those matchers — but `toHaveURL` only accepts string/RegExp/
   URLPattern/predicate. The login page redirects to `/dashboard`, not
   `/`, so the pattern was a substring that never matched and the 15 s
   timeout was the *visible* symptom, not a real cookie problem.

The first one was the real reason the URL stayed on `/login`. The second
one would have caused a different timeout even after fixing the env var.

## Root cause #1 — `EDGE_JWT_SECRET` missing

`src/proxy.ts` (the Next.js 16 proxy, formerly `middleware.ts`) is the
L1 edge gate. It verifies the JWT signature with the secret read from
`process.env.EDGE_JWT_SECRET`. When the secret is **missing** it returns
`false` and the request is treated as unauthenticated:

```ts
function getEdgeJwtSecret(): string | null {
  return process.env.EDGE_JWT_SECRET || null;
}

async function verifyTokenSignature(token: string): Promise<boolean> {
  const secret = getEdgeJwtSecret();
  if (!secret) {
    // No Edge secret configured — refuse to authenticate here.
    // The L2 API Gateway will re-verify with the runtime secret.
    return false;
  }
  // ... HMAC verify
}
```

The proxy then redirects to `/login#/redirect=<path>`. Browser follows
the redirect, ends up on `/login`, and Playwright sees the URL stall on
`/login` — exactly the symptom in the failing tests.

### Evidence from dev server logs (before fix)

```
POST /api/auth/login 200  ← login API succeeded, Set-Cookie returned
GET  /dashboard?_rsc=...  ← router.push('/dashboard') triggered RSC fetch
RES  307  /dashboard?_rsc=...  ← proxy.ts redirected to /login
GET  /login 200  ← browser followed the redirect
GET  /api/auth/me 401  ← AuthProvider's checkAuth re-ran and failed
```

The `auth_token` cookie *was* set in the browser (Playwright's
`context.cookies()` shows it). The proxy just couldn't verify its
signature, so it bounced every protected route to `/login`.

### Fix

Add `EDGE_JWT_SECRET` to the dev `.env` file. It must match
`JWT_SECRET` (or be a separate key for the L1 proxy, but the project
uses the same secret for both layers):

```env
# ─── JWT 认证 ─────────────────────────────────────────
JWT_SECRET=+j+/rNqvRHyqCxgAfCgtYKko3XXsGQs2q1C2+hlxe80=
# Edge runtime JWT secret — must match JWT_SECRET (or be a separate key) so
# the L1 proxy.ts can verify the signature without bouncing to /login.
# The proxy strict-fails closed (RC-1) when this is missing.
EDGE_JWT_SECRET=+j+/rNqvRHyqCxgAfCgtYKko3XXsGQs2q1C2+hlxe80=
```

Production / preview environments must also export `EDGE_JWT_SECRET` at
build time (Next.js 16 inlines Edge Runtime env vars via
`process.env.EDGE_JWT_SECRET` in `src/proxy.ts`). See
`src/proxy.ts:48-62` for the build-time-injection comment.

### Why it looked like an Edge-vs-Chrome issue

- The login API was succeeding (200 with `Set-Cookie`).
- The browser had the cookie (Playwright's `context.cookies()` confirmed
  it).
- `src/proxy.ts` was redirecting to `/login` regardless of which
  Chromium-family browser was used.
- The 15 s `toHaveURL` timeout made it look like a slow redirect, not a
  config issue.
- In dev, the only environment variable that distinguishes a working
  login from a broken one is `EDGE_JWT_SECRET`, and that var was never
  set in the dev `.env`.

## Root cause #2 — Invalid URL matchers in `auth-matrix.spec.ts`

`page.toHaveURL()` **does not support globs**. It only accepts string,
RegExp, URLPattern, or predicate. The old tests passed `**/` and
`**/dashboard**`, which were treated as literal substrings.

| Old pattern              | What Playwright actually did          | Real match outcome |
|--------------------------|---------------------------------------|--------------------|
| `toHaveURL('**/')`       | literal substring match for `**/`     | never matches `/dashboard` |
| `toHaveURL('**/dashboard**')` | literal substring match           | never matches the bare path |
| `waitForURL('**/')`      | glob match (yes, `waitForURL` *does* accept globs) | matches `<anything>/`, **but `/dashboard` has no trailing slash** so this also fails |

So even after fixing the env var, the tests would still have failed
because:

- `router.push('/dashboard')` lands on `http://localhost:5000/dashboard`
- `toHaveURL('**/')` looks for the literal substring `**/` which is not
  in that URL
- 15 s timeout, same symptom

### Fix

Replace all `**/…` patterns with regex matchers that target the actual
URL the login page navigates to (`/dashboard`):

```ts
// Before
await expect(page).toHaveURL('**/', { timeout: 15_000 });
// After
await expect(page).toHaveURL(/\/dashboard(\?|#|$)/, { timeout: 15_000 });
```

The `(\?|#|$)` covers `/dashboard?foo=1` and `/dashboard#hash` so the
regex is robust to query string / hash without being as loose as the
original glob.

Files changed:

- `tests/e2e/auth-matrix.spec.ts` — all `toHaveURL` / `waitForURL` calls
  in `UI Authentication Flow` and `Session Persistence` describe blocks
- `tests/e2e/helpers/auth.ts` — `loginAs` helper's race-condition wait
  (replaced `waitForURL('**/')` with a predicate that checks
  `!url.pathname.startsWith('/login')`)

## What was NOT changed

- `src/lib/auth.tsx` — Auth context already uses `credentials: 'include'`
  on all auth fetches. Verified by inspecting network calls in the
  debug test.
- `src/lib/auth/jwt.ts` `getTokenCookieOptions()` — cookie attributes are
  already correct for localhost HTTP testing
  (`httpOnly: true`, `secure: false` for non-HTTPS,
  `sameSite: 'lax'`, `path: '/'`, no domain).
- `src/proxy.ts` — JWT verification path is correct. The only fix is
  the env var.
- `src/app/login/page.tsx` — already calls `router.push('/dashboard')`
  on success; this is the intended post-login destination.
- `playwright.config.ts` — Edge channel works fine once both issues
  above are fixed. Headless Chromium is not needed and would change
  coverage semantics (we test against the same browser users actually
  run).

## Verification

Before fix:
- 4 of 5 UI tests time out at 15 s with error like
  `expect(page).toHaveURL(...) failed`, captured URL
  `http://localhost:5000/login`, expected `**/`.
- Dev logs show `POST /api/auth/login 200` followed by `GET /dashboard
  307` (proxy redirect to /login).

After fix:
- All 6 UI/Session tests pass:
  - `should show login page when not authenticated` (1.0 s)
  - `should allow admin login` (2.2 s)
  - `should allow agent login` (2.0 s)
  - `should show error on invalid credentials` (1.7 s)
  - `should logout successfully` (2.0 s, skips when no logout button)
  - `should maintain session across page navigations` (7.8 s)
- Dev logs now show `GET /dashboard 200` after the login POST.

## How to run the UI tests in isolation

```bash
# 1. Make sure EDGE_JWT_SECRET is in .env
grep EDGE_JWT_SECRET .env

# 2. Start the dev server with PLAYWRIGHT=1 (rate-limit + lockout bypass)
$env:PLAYWRIGHT=1
node --require ./scripts/asls-bootstrap.cjs --import tsx --no-warnings src/server.ts

# 3. Run only the UI flow tests
$env:PLAYWRIGHT=1
pnpm test:e2e -- tests/e2e/auth-matrix.spec.ts --grep "UI Authentication Flow|Session Persistence"
```

## Take-aways for future E2E work

1. **`toHaveURL` does not accept globs.** Use RegExp / URLPattern /
   predicate. Glob syntax is reserved for `page.route()` and
   `page.waitForURL()` (which **does** accept globs but still won't
   match `/dashboard` with a `**/` pattern because of the trailing
   slash).
2. **The 15 s timeout masked the real failure** — it looked like a slow
   redirect, but it was either a pattern mismatch *or* a server-side
   307. Capture the actual page URL early (e.g. `page.url()` after
   `goto`, or listen to `framenavigated`) to tell them apart.
3. **Edge vs Chromium parity**: cookies work identically in both
   because `httpOnly: true`, `secure: false` (for non-HTTPS localhost),
   and `sameSite: 'lax'` are Chromium-Edge compatible. No
   browser-specific cookie handling needed.
4. **The L1 proxy strict-fails closed** when `EDGE_JWT_SECRET` is
   missing (RC-1). This is by design — a security feature, not a bug
   — but it bites every dev / preview environment that forgets to set
   the var. Symptom is "login API succeeds but every protected route
   bounces to /login", which is easy to misdiagnose as a cookie or
   browser issue. Add `EDGE_JWT_SECRET` to `.env` (and any CI /
   preview environment) to fix.
5. **Test for the actual destination, not a vague pattern.** The
   login page redirects to `/dashboard`, not `/`, so the assertion
   should target `/dashboard` directly.
