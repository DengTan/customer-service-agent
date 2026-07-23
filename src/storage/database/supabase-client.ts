import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client factory
 *
 * Environment variables are loaded via Next.js standard .env.local mechanism.
 * All required variables MUST be set before deployment.
 * See .env.example for the full list.
 *
 * Demo mode: When SUPABASE_URL is not set, the app runs in demo mode
 * with mock data, allowing UI testing without database configuration.
 */

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function getSupabaseCredentials(): SupabaseCredentials {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { url: '', anonKey: '' };
  }

  return { url, anonKey };
}

function isDemoMode(): boolean {
  return !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY;
}

function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Cache Supabase client instances to avoid creating new ones on every request
let cachedClient: SupabaseClient | null = null;
let cachedClientKey: string | null = null;

function getSupabaseClient(token?: string): SupabaseClient {
  // Demo mode: return a mock client that returns empty data
  if (isDemoMode()) {
    // Return a mock client with empty responses
    return createClient('https://demo.supabase.co', 'demo-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  const { url, anonKey } = getSupabaseCredentials();

  let key: string;
  if (token) {
    key = anonKey;
  } else {
    const serviceRoleKey = getSupabaseServiceRoleKey();
    key = serviceRoleKey ?? anonKey;
  }

  // Return cached client if same key (no token passed = server-side singleton)
  if (!token && cachedClient && cachedClientKey === key) {
    return cachedClient;
  }

  const globalOptions: Record<string, unknown> = {};
  if (token) {
    globalOptions.headers = { Authorization: `Bearer ${token}` };
  }

  const client = createClient(url, key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Cache the server-side (no token) client
  if (!token) {
    cachedClient = client;
    cachedClientKey = key;
  }

  return client;
}

export { getSupabaseCredentials, getSupabaseServiceRoleKey, getSupabaseClient, isDemoMode };

// ─── Service Role Client ─────────────────────────────────────

/** Returns a Supabase client with service-role key (bypasses RLS). */
export function getServiceRoleClient(): SupabaseClient {
  return getSupabaseClient();
}
