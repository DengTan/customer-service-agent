/**
 * Policy inventory check (B1).
 *
 * For every pgTable declared in `src/storage/database/shared/schema.ts`
 * there MUST be a matching `supabase/policies/<table>.sql` file. The
 * inventory fails the build if there is a mismatch.
 *
 * Run via vitest: `pnpm policies:inventory` or simply part of `pnpm test:run`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Use process.cwd() to avoid import.meta.url resolution quirks under vitest/ts-node.
const REPO_ROOT = process.cwd();
const POLICIES_DIR = join(REPO_ROOT, 'supabase', 'policies');
const SCHEMA_PATH = join(REPO_ROOT, 'src', 'storage', 'database', 'shared', 'schema.ts');

function listPolicyTables(): Set<string> {
  if (!existsSync(POLICIES_DIR)) return new Set();
  return new Set(
    readdirSync(POLICIES_DIR)
      .filter((f) => f.endsWith('.sql') && f !== '.snapshot.sql')
      .map((f) => basename(f, '.sql'))
  );
}

function listSchemaTables(): Set<string> {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  // Matches `export const <name> = pgTable(\n  "<tableName>"` declarations.
  const matches = text.matchAll(/export const \w+ = pgTable\(\s*"([a-zA-Z0-9_]+)"/g);
  const tables = new Set<string>();
  for (const m of matches) {
    if (m[1]) tables.add(m[1]);
  }
  return tables;
}

describe('RLS policy inventory (B1)', () => {
  it('every schema.ts table has a policy file', () => {
    const policyTables = listPolicyTables();
    const schemaTables = listSchemaTables();
    const missing: string[] = [];
    for (const t of schemaTables) {
      if (!policyTables.has(t)) missing.push(t);
    }
    expect(
      missing,
      `missing policy files for tables: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('no orphan policy files (every policy file matches a schema table)', () => {
    const policyTables = listPolicyTables();
    const schemaTables = listSchemaTables();
    const orphans: string[] = [];
    for (const t of policyTables) {
      if (!schemaTables.has(t)) orphans.push(t);
    }
    expect(
      orphans,
      `orphan policy files (no matching schema.ts table): ${orphans.join(', ')}`
    ).toEqual([]);
  });
});
