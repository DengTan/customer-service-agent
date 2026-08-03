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
let cachedServiceClient: SupabaseClient | null = null;
let cachedServiceClientKey: string | null = null;

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

// ─── Service Client ───────────────────────────────────────────

/**
 * Returns a Supabase client authenticated with the service role key.
 *
 * This client MUST be used whenever an API path needs to bypass RLS for
 * legitimate reasons (admin actions, cross-tenant migrations, system tasks).
 * The service role key is required; when it is missing the function throws
 * instead of silently falling back to the anon key — that fallback was the
 * root cause of RC-7 (`getServiceRoleClient` being a literal alias for the
 * anon client in production).
 */
export function getServiceClient(): SupabaseClient {
  if (isDemoMode()) {
    // Allow demo mode for unit tests / local UI walkthroughs.
    return getSupabaseClient();
  }

  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for getServiceClient(). ' +
        'Set the env var or call this function only from admin/system paths.',
    );
  }

  if (cachedServiceClient && cachedServiceClientKey === serviceRoleKey) {
    return cachedServiceClient;
  }

  const { url } = getSupabaseCredentials();

  const client = createClient(url, serviceRoleKey, {
    db: { timeout: 60000 },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  cachedServiceClient = client;
  cachedServiceClientKey = serviceRoleKey;

  return client;
}
