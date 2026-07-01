/**
 * Direct PostgreSQL connection for tables not yet in PostgREST schema cache
 * 
 * This is a workaround for Coze-hosted Supabase where PostgREST schema cache
 * cannot be manually refreshed when new tables are created.
 */

import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

function getPgPool(): Pool {
  if (!pool) {
    // Use environment variables for PostgreSQL connection
    const host = process.env.COZE_PG_HOST;
    const port = parseInt(process.env.COZE_PG_PORT || '5432', 10);
    const database = process.env.COZE_PG_DATABASE || 'postgres';
    const user = process.env.COZE_PG_USER || 'postgres';
    const password = process.env.COZE_PG_PASSWORD;

    // Throw error if required credentials are missing
    if (!host || !password) {
      throw new Error('Missing required environment variables: COZE_PG_HOST, COZE_PG_PASSWORD');
    }

    pool = new Pool({
      host,
      port,
      database,
      user,
      password,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[pg-pool] Unexpected error on idle client:', err);
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pgPool = getPgPool();
  const client = await pgPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params?: unknown[]
): Promise<number> {
  const pgPool = getPgPool();
  const client = await pgPool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pgPool = getPgPool();
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
