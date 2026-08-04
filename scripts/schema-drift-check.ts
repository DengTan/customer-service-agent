/**
 * Schema Drift Check Script (RC-3).
 *
 * Compares the TypeScript schema definitions in schema.ts against the actual
 * Supabase database tables to detect drift.
 *
 * Checks performed:
 *   1. Tables defined in schema.ts but missing from the database (missing_in_db)
 *   2. Tables in the database but not defined in schema.ts (missing_in_schema)
 *   3. Column-level mismatch for tables that exist in both (column_mismatch)
 *
 * Usage:
 *   pnpm schema:drift        # exit 0 if clean, exit 1 + report if drift found
 *   pnpm schema:drift:report  # always exit 0, print report regardless of drift
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../src/lib/logger';

const REPO_ROOT = process.cwd();
const SCHEMA_FILE = join(REPO_ROOT, 'src', 'storage', 'database', 'shared', 'schema.ts');

// ─── Types ────────────────────────────────────────────────────────────────────

interface DriftResult {
  table: string;
  driftType: 'missing_in_db' | 'missing_in_schema' | 'column_mismatch';
  details: string;
}

interface SchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
}

interface DbColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

// ─── Schema Parser ────────────────────────────────────────────────────────────

/**
 * Extract table names from schema.ts by finding all pgTable(...) calls.
 * Handles both `pgTable("name", ...)` and `pgTable('name', ...)` syntax.
 */
function extractTableNames(schemaContent: string): string[] {
  // Match pgTable("table_name", ...) or pgTable('table_name', ...)
  const matcher = /pgTable\s*\(\s*["']([a-z_]+)["']\s*,/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(schemaContent)) !== null) {
    names.push(match[1]);
  }

  return names;
}

/**
 * Extract column definitions for a given table from schema.ts.
 * Returns a simplified map of column name -> type info.
 */
function extractColumnsForTable(
  schemaContent: string,
  tableName: string,
): Map<string, { dataType: string; nullable: boolean }> {
  const columns = new Map<string, { dataType: string; nullable: boolean }>();

  // Find the table definition block
  // Pattern: export const tableName = pgTable("tableName", { ...fields }, ...)
  // We need to find the object literal with field definitions

  // Escape for regex
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match the table definition and extract the fields object
  const tableDefRegex = new RegExp(
    `export\\s+const\\s+${escapedTableName}\\s*=\\s*pgTable\\s*\\(\\s*["']${escapedTableName}["']\\s*,[\\s\\S]*?\\{[\\s\\S]*?\\}(?:\\s*,\\s*\\([^)]*\\)\\s*)?\\s*\\)`,
    'g',
  );

  const tableMatch = tableDefRegex.exec(schemaContent);
  if (!tableMatch) return columns;

  const fieldsBlock = tableMatch[0];

  // Extract column definitions within the fields block
  // Pattern: columnName: typeBuilder("column_name", options).notNull().default(...),
  // We simplify by just extracting the field names
  const fieldMatcher = /^\s{2,4}(\w+)\s*:/gm;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldMatcher.exec(fieldsBlock)) !== null) {
    const fieldName = fieldMatch[1];

    // Check if this field has .notNull() or is optional
    const fieldStart = fieldMatch.index;
    const fieldEnd = fieldsBlock.indexOf(',', fieldStart);
    const fieldSlice = fieldsBlock.slice(fieldStart, fieldEnd > 0 ? fieldEnd : undefined);

    // Simple heuristic: if it has .notNull() right after the type builder, it's not nullable
    const nullable = !/.notNull\(\)/.test(fieldSlice);

    // Infer data type from the type builder
    let dataType = 'unknown';
    if (/\.varchar\(/.test(fieldSlice)) dataType = 'character varying';
    else if (/\.text\(\)/.test(fieldSlice)) dataType = 'text';
    else if (/\.integer\(\)/.test(fieldSlice)) dataType = 'integer';
    else if (/\.boolean\(\)/.test(fieldSlice)) dataType = 'boolean';
    else if (/\.timestamp\(/.test(fieldSlice)) dataType = 'timestamp with time zone';
    else if (/\.jsonb\(\)/.test(fieldSlice)) dataType = 'jsonb';
    else if (/\.serial\(\)/.test(fieldSlice)) dataType = 'integer'; // serial maps to int
    else if (/\.doublePrecision\(\)/.test(fieldSlice)) dataType = 'double precision';
    else if (/\.decimal\(/.test(fieldSlice)) dataType = 'numeric';

    columns.set(fieldName, { dataType, nullable });
  }

  return columns;
}

// ─── Database Client ──────────────────────────────────────────────────────────

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    logger.error('Missing Supabase credentials', {
      hasUrl: !!url,
      hasKey: !!key,
      env: Object.keys(process.env).filter(k => k.startsWith('SUPABASE')),
    });
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required',
    );
  }

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${key}` } },
  });
}

// ─── Drift Detection ──────────────────────────────────────────────────────────

async function getDbTableNames(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('pg_tables')
    .select('tablename')
    .eq('schemaname', 'public')
    .in('tablename', [
      // Only fetch application tables (exclude system/helper tables)
      'pg_tables',
      'spatial_ref_sys',
    ]);

  if (error) {
    // pg_tables might not be accessible via the REST API — fall back to raw SQL RPC
    logger.warn('pg_tables REST query failed, trying raw SQL', { error: error.message });
    const { data: rawData, error: rawError } = await supabase.rpc('exec', {
      query: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma_%' AND tablename NOT LIKE '%_drizzle_%' AND tablename NOT LIKE 'pg_%' AND tablename NOT LIKE 'sql_%'",
    });

    if (rawError || !rawData) {
      logger.error('Raw SQL fallback also failed', { error: rawError });
      throw new Error(`Failed to fetch DB tables: ${error?.message ?? rawError}`);
    }

    return new Set((rawData as Array<{ tablename: string }>).map((r) => r.tablename));
  }

  // pg_tables REST response is the system catalog itself — use it to get application tables
  const { data: appTables, error: appError } = await supabase.rpc('exec', {
    query: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma_%' AND tablename NOT LIKE '%_drizzle_%' AND tablename NOT LIKE 'pg_%' AND tablename NOT LIKE 'sql_%'",
  });

  if (appError) {
    throw new Error(`Failed to fetch application tables: ${appError.message}`);
  }

  return new Set((appTables as Array<{ tablename: string }>).map((r) => r.tablename));
}

async function getDbColumns(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
): Promise<Map<string, DbColumn>> {
  const { data, error } = await supabase.rpc('exec', {
    query: `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
    params: [tableName],
  });

  if (error) {
    logger.warn(`Failed to fetch columns for table "${tableName}"`, { error: error.message });
    return new Map();
  }

  const map = new Map<string, DbColumn>();
  for (const row of data as DbColumn[]) {
    map.set(row.column_name, row);
  }
  return map;
}

async function checkDrift(): Promise<DriftResult[]> {
  const results: DriftResult[] = [];
  const supabase = createSupabaseClient();

  // ── Step 1: Parse schema.ts ──────────────────────────────────────────────
  let schemaContent: string;
  try {
    schemaContent = readFileSync(SCHEMA_FILE, 'utf-8');
  } catch {
    logger.error('Failed to read schema.ts', { path: SCHEMA_FILE });
    throw new Error(`Cannot read schema file: ${SCHEMA_FILE}`);
  }

  const schemaTableNames = extractTableNames(schemaContent);
  logger.info('Parsed schema tables', { count: schemaTableNames.length, tables: schemaTableNames });

  if (schemaTableNames.length === 0) {
    logger.warn('No table definitions found in schema.ts — check the regex pattern');
  }

  // ── Step 2: Fetch DB table list ─────────────────────────────────────────
  let dbTableNames: Set<string>;
  try {
    dbTableNames = await getDbTableNames(supabase);
  } catch (err) {
    logger.error('Failed to connect to Supabase or query tables', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  logger.info('Database tables', { count: dbTableNames.size, tables: [...dbTableNames] });

  // ── Step 3: Table-level drift ────────────────────────────────────────────
  // 3a. Tables in schema but missing in DB
  for (const table of schemaTableNames) {
    if (!dbTableNames.has(table)) {
      results.push({
        table,
        driftType: 'missing_in_db',
        details: `Table '${table}' is defined in schema.ts but not found in the database`,
      });
    }
  }

  // 3b. Tables in DB but missing in schema (exclude drizzle-internal tables)
  const internalPatterns = /^_prisma_|_drizzle_|pg_|sql_/;
  for (const table of dbTableNames) {
    if (!schemaTableNames.includes(table) && !internalPatterns.test(table)) {
      results.push({
        table,
        driftType: 'missing_in_schema',
        details: `Table '${table}' exists in the database but is not defined in schema.ts`,
      });
    }
  }

  // ── Step 4: Column-level drift (for tables in both schema and DB) ────────
  for (const table of schemaTableNames) {
    if (!dbTableNames.has(table)) continue; // Already flagged as missing_in_db

    const schemaColumns = extractColumnsForTable(schemaContent, table);
    const dbColumns = await getDbColumns(supabase, table);

    // 4a. Columns in schema but missing in DB
    for (const [colName, colInfo] of schemaColumns) {
      if (!dbColumns.has(colName)) {
        results.push({
          table,
          driftType: 'column_mismatch',
          details: `Column '${colName}' (${colInfo.dataType}) defined in schema.ts but missing in DB table '${table}'`,
        });
      }
    }

    // 4b. Columns in DB but missing in schema
    for (const [colName, dbCol] of dbColumns) {
      if (!schemaColumns.has(colName)) {
        results.push({
          table,
          driftType: 'column_mismatch',
          details: `Column '${colName}' (${dbCol.data_type}) exists in DB table '${table}' but is not defined in schema.ts`,
        });
      }
    }
  }

  return results;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printMarkdownReport(driftResults: DriftResult[], exitCode = 0): void {
  const timestamp = new Date().toISOString();

  console.log('\n# Schema Drift Report');
  console.log(`Generated: ${timestamp}`);
  console.log(`Exit code: ${exitCode}`);
  console.log(`\n## Summary`);
  console.log(`Total drift items: ${driftResults.length}`);

  const byType = {
    missing_in_db: driftResults.filter((r) => r.driftType === 'missing_in_db'),
    missing_in_schema: driftResults.filter((r) => r.driftType === 'missing_in_schema'),
    column_mismatch: driftResults.filter((r) => r.driftType === 'column_mismatch'),
  };

  console.log(`- Missing in Database: ${byType.missing_in_db.length}`);
  console.log(`- Missing in Schema:   ${byType.missing_in_schema.length}`);
  console.log(`- Column Mismatch:     ${byType.column_mismatch.length}`);

  if (driftResults.length === 0) {
    console.log('\n**No schema drift detected.**');
    return;
  }

  if (byType.missing_in_db.length > 0) {
    console.log('\n## Missing in Database (schema → DB)');
    console.log('| Table | Details |');
    console.log('|-------|---------|');
    for (const r of byType.missing_in_db) {
      console.log(`| \`${r.table}\` | ${r.details} |`);
    }
  }

  if (byType.missing_in_schema.length > 0) {
    console.log('\n## Missing in Schema (DB → schema)');
    console.log('| Table | Details |');
    console.log('|-------|---------|');
    for (const r of byType.missing_in_schema) {
      console.log(`| \`${r.table}\` | ${r.details} |`);
    }
  }

  if (byType.column_mismatch.length > 0) {
    console.log('\n## Column Mismatch');
    console.log('| Table | Details |');
    console.log('|-------|---------|');
    for (const r of byType.column_mismatch) {
      console.log(`| \`${r.table}\` | ${r.details} |`);
    }
  }

  console.log('\n---\n*Schema drift report generated by schema-drift-check.ts*');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Support --report flag to always print report (exit 0)
  const reportOnly = process.argv.includes('--report') || process.argv.includes('--report-only');

  logger.info('Starting schema drift check', { schemaFile: SCHEMA_FILE, reportOnly });

  try {
    const driftResults = await checkDrift();

    if (driftResults.length === 0) {
      logger.info('No schema drift detected');
      printMarkdownReport(driftResults, 0);
      process.exit(0);
    }

    logger.warn('Schema drift detected', {
      count: driftResults.length,
      results: driftResults,
    });

    printMarkdownReport(driftResults, 1);

    // Exit 1 if drift found (unless --report)
    process.exit(reportOnly ? 0 : 1);
  } catch (error) {
    logger.error('Drift check failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    printMarkdownReport([], 1);
    process.exit(1);
  }
}

main();
