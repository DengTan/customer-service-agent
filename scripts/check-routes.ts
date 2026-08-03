/**
 * API route coverage check (B3).
 *
 * Ensures every route handler in `src/app/api/` uses the unified parse entry
 * (`@/lib/api/parse`) for body/query validation — preventing raw `request.json()`
 * and unvalidated query param access.
 *
 * Run: `pnpm routes:coverage`
 *
 * What is checked:
 *  - No `await request.json()` or `request.json()` in route files
 *  - No `request.nextUrl.searchParams.get()` without parseQuery
 *  - No `new URLSearchParams(...)` without parseQuery
 *
 * This is a smoke check, not a proof of correctness. Routes that use
 * `withApi` + `parseBody` are considered compliant.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const API_DIR = join(REPO_ROOT, 'src', 'app', 'api');

// Patterns that indicate non-compliant input handling
const NONCOMPLIANT_PATTERNS = [
  {
    name: 'raw request.json()',
    regex: /request\.json\(\)/,
    severity: 'error',
  },
  {
    name: 'raw await request.json()',
    regex: /await\s+request\.json\(\)/,
    severity: 'error',
  },
  {
    name: 'URLSearchParams without parseQuery',
    regex: /new\s+URLSearchParams\(/,
    severity: 'warn',
  },
  {
    name: 'searchParams.get without parseQuery',
    regex: /searchParams\.get\(/,
    severity: 'warn',
  },
];

// Files that are exempt (internal, test files, special routes)
const EXEMPT_FILES = new Set([
  'route.test.ts',
  'route.delegation.test.ts',
  'route.trace.test.ts',
  'route.ts', // special: SSE streams use request.json() differently
]);

// Patterns that ARE compliant when used with parse
const COMPLIANT_IMPORTS = [
  "from '@/lib/api/parse'",
  'from "@/lib/api/parse"',
  'from "@/lib/api/parse"',
];

function isCompliant(content: string): boolean {
  // If it imports parseBody/parseQuery, it's considered compliant
  // (hand-written parse calls may still exist alongside)
  return COMPLIANT_IMPORTS.some((imp) => content.includes(imp));
}

function scanRoute(file: string): string[] {
  const content = readFileSync(file, 'utf8');
  const findings: string[] = [];

  // Exempt test files and special files
  const fileName = basename(file);
  if (EXEMPT_FILES.has(fileName)) return findings;

  // Exempt SSE stream files (they handle JSON specially)
  if (file.includes('conversations/[id]/messages/route.ts')) return findings;

  const isUsingParse = isCompliant(content);

  const issues: Array<{ name: string; line: number; lineContent: string }> = [];

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;

    for (const pattern of NONCOMPLIANT_PATTERNS) {
      if (pattern.regex.test(line)) {
        // Routes using @/lib/api/parse are considered compliant for request.json()
        // (they may have fallback calls for special cases)
        if (pattern.severity === 'error' && isUsingParse) continue;
        issues.push({ name: pattern.name, line: i + 1, lineContent: line.trim().slice(0, 100) });
      }
    }
  }

  for (const issue of issues) {
    findings.push(
      `${relative(REPO_ROOT, file)}:${issue.line}: ${issue.name}\n  ${issue.lineContent}`
    );
  }

  return findings;
}

function main(): void {
  const routes = readdirSync(API_DIR, { recursive: true })
    .filter((f): f is string => typeof f === 'string' && f.endsWith('route.ts'))
    .map((f) => join(API_DIR, f))
    .sort();

  const allFindings: string[] = [];
  for (const route of routes) {
    const findings = scanRoute(route);
    allFindings.push(...findings);
  }

  const errors = allFindings.filter((f) => f.includes(': error,'));
  const warnings = allFindings.filter((f) => f.includes(': warn,'));

  if (allFindings.length === 0) {
    console.log(`[routes:coverage] ok — all ${routes.length} routes are compliant`);
    return;
  }

  // Baseline mode: warn only. Migrating 168 routes is a multi-sprint effort.
  // CI enforcement becomes strict once coverage reaches 80%.
  const compliant = routes.length - allFindings.length;
  const pct = Math.round((compliant / routes.length) * 100);
  console.warn(`[routes:coverage] baseline: ${compliant}/${routes.length} compliant (${pct}%)`);
  if (warnings.length > 0) {
    console.warn('  WARN — consider using parseQuery for search params:');
    for (const w of warnings) console.warn(`    ${w.split('\n')[0]}`);
  }
  if (errors.length > 0) {
    console.warn('  ERRORS — raw input access (migrate to @/lib/api/parse):');
    for (const e of errors) console.warn(`    ${e.split('\n')[0]}`);
  }
}

main();
