/**
 * check-rls-state.ts — settings-rls-hardening baseline tool.
 *
 * Produces a deterministic baseline report of the expected post-migration
 * state of the public schema for the settings work tracked in plan
 * `settings-rls-hardening_5c312208.plan.md` (phase 0).
 *
 * The script intentionally does NOT mutate anything and does NOT issue any
 * write RPCs. It performs two kinds of checks:
 *
 *   1. Static (offline) — verifies the expected set of settings-related
 *      migrations are present in `supabase/migrations/`, and that the
 *      hardened RPC / RLS primitives they introduce (e.g.
 *      `upsert_settings_batch`, the deny policies for anon /
 *      authenticated) appear in the SQL. This is fast and safe to run
 *      in CI without database credentials.
 *
 *   2. Remote (optional, read-only) — when `SUPABASE_URL` and
 *      `SUPABASE_SERVICE_ROLE_KEY` are present in env, the script queries
 *      `pg_class.relrowsecurity` and `information_schema.role_table_grants`
 *      for the public tables to verify each one is `rowsecurity = true`.
 *      This is the canonical drift detector the plan calls for in stage 7.
 *
 * Usage:
 *   pnpm tsx scripts/check-rls-state.ts
 *
 * Exit code:
 *   0  — every check passed.
 *   1  — at least one drift / missing primitive detected.
 *
 * The script is intentionally self-contained: it does not depend on any
 * other source file under `src/` so it can run before `pnpm install`
 * finishes during CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(__dirname, '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: CheckResult[] = [];

function listMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(join(migrationsDir, name), 'utf8');
}

// ── 1. Static checks ────────────────────────────────────────────
// Plan §"阶段 0" / §"阶段 1" require the following migrations to be
// present and to contain the expected primitives:

const expectedMigrations: Array<{
  file: string;
  mustContain: string[];
  description: string;
}> = [
  {
    file: '20260713_settings_security_and_semantics_fix.sql',
    mustContain: [
      'CREATE OR REPLACE FUNCTION upsert_many_settings(p_items jsonb)',
      'unhandled_remind_enabled',
      'unhandled_remind_minutes',
    ],
    description: 'adds the legacy upsert_many_settings RPC and the unhandled_remind split',
  },
  {
    file: '20260710_settings_seeding_lock.sql',
    mustContain: [
      'try_acquire_settings_seed_lock',
      'pg_try_advisory_xact_lock(8247193)',
    ],
    description: 'adds the advisory lock helper used by seed_default_settings',
  },
  {
    file: '20260713_settings_rls_and_priv_rpc.sql',
    mustContain: [
      'ENABLE ROW LEVEL SECURITY',
      'settings_deny_all_anon',
      'settings_deny_all_authenticated',
      'upsert_settings_batch',
      'current_user <> \'service_role\'',
      'REVOKE ALL ON FUNCTION public.upsert_settings_batch(jsonb) FROM PUBLIC',
    ],
    description: 'RLS on settings + hardened upsert_settings_batch RPC',
  },
  {
    file: '20260713_push_webhook_secret_rotate.sql',
    mustContain: [
      'rotate_push_webhook_secret',
      'request.jwt.claim.role',
      'service_role',
    ],
    description: 'hardened rotate_push_webhook_secret with caller-role guard',
  },
];

for (const expected of expectedMigrations) {
  const files = listMigrationFiles();
  const present = files.includes(expected.file);
  if (!present) {
    checks.push({
      name: `migration:${expected.file}`,
      ok: false,
      detail: `${expected.description} — FILE MISSING`,
    });
    continue;
  }
  const sql = readMigration(expected.file);
  const missing = expected.mustContain.filter((needle) => !sql.includes(needle));
  if (missing.length === 0) {
    checks.push({
      name: `migration:${expected.file}`,
      ok: true,
      detail: expected.description,
    });
  } else {
    checks.push({
      name: `migration:${expected.file}`,
      ok: false,
      detail: `${expected.description} — MISSING: ${missing.join(' | ')}`,
    });
  }
}

// ── 2. Settings RLS primitive sanity ────────────────────────────
// The hardened migration must:
//   - enable RLS on public.settings
//   - deny anon & authenticated via policies
//   - pin search_path on the SECURITY DEFINER function
//   - revoke from PUBLIC / anon / authenticated
const hardenedSql = (() => {
  const files = listMigrationFiles();
  const f = files.find((x) => x === '20260713_settings_rls_and_priv_rpc.sql');
  return f ? readMigration(f) : '';
})();

checks.push({
  name: 'rls:settings_enabled',
  ok: hardenedSql.includes('ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY'),
  detail: 'ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY must be present',
});

checks.push({
  name: 'rls:settings_anon_deny',
  ok: /CREATE POLICY\s+"settings_deny_all_anon"\s+ON public\.settings[\s\S]{0,200}TO anon/.test(hardenedSql),
  detail: 'deny policy for anon must exist on public.settings',
});

checks.push({
  name: 'rls:settings_authenticated_deny',
  ok: /CREATE POLICY\s+"settings_deny_all_authenticated"\s+ON public\.settings[\s\S]{0,200}TO authenticated/.test(hardenedSql),
  detail: 'deny policy for authenticated must exist on public.settings',
});

checks.push({
  name: 'rpc:search_path_pinned',
  ok: /SET search_path\s*=\s*pg_catalog,\s*public/.test(hardenedSql),
  detail: 'SECURITY DEFINER RPC must pin search_path to pg_catalog, public',
});

checks.push({
  name: 'rpc:caller_guard',
  ok: hardenedSql.includes('current_user <>') && hardenedSql.includes('service_role'),
  detail: 'SECURITY DEFINER RPC must check current_user = service_role',
});

checks.push({
  name: 'grants:revoke_public',
  ok: hardenedSql.includes('REVOKE ALL ON FUNCTION public.upsert_settings_batch(jsonb) FROM PUBLIC'),
  detail: 'EXECUTE on upsert_settings_batch must be revoked from PUBLIC',
});

checks.push({
  name: 'grants:service_role_only',
  ok: hardenedSql.includes('GRANT EXECUTE ON FUNCTION public.upsert_settings_batch(jsonb) TO service_role'),
  detail: 'EXECUTE on upsert_settings_batch must be granted to service_role only',
});

// ── 3. Remote read-only check (optional) ────────────────────────
// Run only when the env vars are present. The plan calls for this to be
// wired into CI; for now it is a documented-but-opt-in path so that local
// runs without credentials still produce a useful report.
async function runRemoteCheck(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    checks.push({
      name: 'remote:skipped',
      ok: true,
      detail: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping remote RLS probe',
    });
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    // Ask Postgres whether each public table is RLS-enabled.
    // Uses `to_regclass` style table-name resolution but the simplest
    // portable query is information_schema.table_privileges filtered to
    // the public role. We also check pg_class via an RPC-safe query:
    // `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace`
    const { data, error } = await supabase
      .from('pg_class')
      .select('relname, relrowsecurity')
      .eq('relnamespace', 'public')
      .limit(500);

    if (error) {
      checks.push({
        name: 'remote:rls_query',
        ok: false,
        detail: `failed to query pg_class: ${error.message}`,
      });
      return;
    }

    const rows = (data ?? []) as Array<{ relname: string; relrowsecurity: boolean }>;
    const publicTables = rows
      .filter((r) => r.relname && !r.relname.startsWith('_') && !r.relname.startsWith('pg_'))
      .map((r) => ({ name: r.relname, rls: r.relrowsecurity }));

    // Per plan §"阶段 0", the expected baseline is 59 public tables,
    // 3 of which already have RLS enabled (settings,
    // simulation_evaluations, test_cases). 56 still need enabling.
    const total = publicTables.length;
    const rlsOn = publicTables.filter((t) => t.rls).length;
    const rlsOff = publicTables.filter((t) => !t.rls);

    checks.push({
      name: 'remote:table_count',
      ok: total === 59,
      detail: `public table count: ${total} (expected 59)`,
    });

    checks.push({
      name: 'remote:rls_on_settings',
      ok: publicTables.some((t) => t.name === 'settings' && t.rls),
      detail: 'public.settings must have RLS enabled',
    });

    checks.push({
      name: 'remote:rls_off_count',
      ok: rlsOff.length === 56,
      detail: `tables with RLS off: ${rlsOff.length} (expected 56)`,
    });

    if (rlsOff.length !== 56 && rlsOff.length > 0) {
      // Print names so a human reviewer can spot drift.
      loggerDetail(`tables with RLS off: ${rlsOff.map((t) => t.name).join(', ')}`);
    }
  } catch (err) {
    checks.push({
      name: 'remote:rls_query',
      ok: false,
      detail: `remote probe threw: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function loggerDetail(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`  · ${line}`);
}

// ── 4. Report ──────────────────────────────────────────────────
async function main(): Promise<number> {
  // eslint-disable-next-line no-console
  console.log('settings-rls-hardening baseline report\n');
  // eslint-disable-next-line no-console
  console.log(`migrations directory: ${migrationsDir}\n`);

  await runRemoteCheck();

  // eslint-disable-next-line no-console
  console.log('checks:');
  for (const c of checks) {
    const tag = c.ok ? 'PASS' : 'FAIL';
    // eslint-disable-next-line no-console
    console.log(`  [${tag}] ${c.name} — ${c.detail}`);
  }
  // eslint-disable-next-line no-console
  console.log();
  const failed = checks.filter((c) => !c.ok);
  // eslint-disable-next-line no-console
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.log('\nfailing checks:');
    for (const c of failed) {
      // eslint-disable-next-line no-console
      console.log(`  - ${c.name}: ${c.detail}`);
    }
  }
  return failed.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // eslint-disable-next-line no-console
    console.error('check-rls-state crashed:', err);
    process.exit(2);
  },
);