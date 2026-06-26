/**
 * Centralized configuration with Zod validation.
 * Solves MT-06: environment variables are validated at startup,
 * missing/invalid values cause clear errors instead of runtime surprises.
 *
 * Usage: import { config } from '@/lib/config';
 */
import { z } from 'zod';

const envSchema = z.object({
  // ─── Supabase ──────────────────────────────
  COZE_SUPABASE_URL: z.string().url('COZE_SUPABASE_URL must be a valid URL'),
  COZE_SUPABASE_ANON_KEY: z.string().min(1, 'COZE_SUPABASE_ANON_KEY is required'),
  COZE_SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // ─── Encryption ────────────────────────────
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters for AES-256'),

  // ─── Node Environment ──────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // ─── Coze Project Env ──────────────────────
  COZE_PROJECT_ENV: z.enum(['DEV', 'PROD']).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

// Validate at module load time — fail fast if critical vars are missing
function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `  - ${i.path.join('.')}: ${i.message}`,
    );
    console.error(
      '\n❌ Environment variable validation failed:\n' + errors.join('\n') +
      '\n\nPlease check your .env.local file against .env.example\n',
    );
    // In development, throw to surface the issue immediately
    // In production, we still throw — misconfiguration is critical
    throw new Error('Environment variable validation failed. See server logs for details.');
  }
  return result.data;
}

/** Validated and typed environment configuration */
export const config = validateEnv();

/** Whether we're running in development mode */
export const isDev = config.NODE_ENV === 'development';

/** Whether we're running in production mode */
export const isProd = config.NODE_ENV === 'production';
