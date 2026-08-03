import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/storage/database/shared/schema.ts',
  out: './supabase/migrations/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? '',
  },
});
