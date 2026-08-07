/**
 * scripts/migrate-external-kb-key.ts
 *
 * One-shot migration to encrypt the `external_knowledge_api_key` setting row.
 *
 * Background:
 *   The external knowledge base module historically stored the FastGPT API
 *   key in plaintext inside `settings.value`. P0-1 of the security audit
 *   changes that — the API is now expected to write an AES-256-GCM
 *   ciphertext. This script rewrites any legacy plaintext value so that the
 *   read path (which still falls back to plaintext as a safety net) can be
 *   phased out.
 *
 * Idempotency:
 *   - Values that already pass `isEncrypted(value)` are skipped (no rewrite).
 *   - Empty values are skipped (no key to encrypt).
 *   - The script never decrypts existing ciphertext — only fresh-encrypts
 *     plaintext. Running it twice is safe.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-external-kb-key.ts [--dry-run] [--key=external_knowledge_api_key]
 *
 * Exit codes:
 *   0 — no work needed or migration succeeded
 *   1 — fatal error (env missing, DB unavailable)
 *   2 — partial failure (some rows failed to encrypt; inspect logs)
 */
import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { encrypt, isEncrypted } from '@/lib/crypto';
import { logger } from '@/lib/logger';

config({ path: resolve(process.cwd(), '.env') });

const DEFAULT_TARGET_KEY = 'external_knowledge_api_key';

interface CliOptions {
  dryRun: boolean;
  targetKey: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx + 1);
      args[key] = val;
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }

  return {
    dryRun: Boolean(args['dry-run']),
    targetKey: (args.key as string) || DEFAULT_TARGET_KEY,
  };
}

function printHelp(): void {
  console.log(`
External Knowledge API Key Migration
====================================

Encrypts the legacy plaintext API key for the external knowledge base module.

Usage:
  pnpm tsx scripts/migrate-external-kb-key.ts [options]

Options:
  --dry-run                  Inspect what would be changed without writing.
  --key=<setting_key>        Override the setting key (default: ${DEFAULT_TARGET_KEY}).

Examples:
  pnpm tsx scripts/migrate-external-kb-key.ts --dry-run
  pnpm tsx scripts/migrate-external-kb-key.ts
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(argv);

  if (isDemoMode()) {
    console.error('[FATAL] Demo mode — Supabase not configured. Nothing to migrate.');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  External KB API Key Migration');
  console.log('========================================');
  console.log(`  Target setting: ${options.targetKey}`);
  console.log(`  Dry run:        ${options.dryRun}`);
  console.log('========================================\n');

  const client = getSupabaseClient();

  // 1. Fetch the target row.
  const { data: rows, error: fetchError } = await client
    .from('settings')
    .select('key, value, updated_at')
    .eq('key', options.targetKey)
    .maybeSingle();

  if (fetchError) {
    console.error(`[FATAL] Failed to read settings row: ${fetchError.message}`);
    process.exit(1);
  }

  if (!rows || !rows.value) {
    console.log('[INFO] No value found for the target key. Nothing to migrate.');
    process.exit(0);
  }

  const currentValue: string = rows.value;

  // 2. Skip if already encrypted.
  if (isEncrypted(currentValue)) {
    console.log('[OK] Stored value is already encrypted. No action needed.');
    process.exit(0);
  }

  // 3. Show a tail of the plaintext so the operator can sanity-check.
  //    Never log the full key, never log its length (length narrows the
  //    search space and is a derived secret metric).
  const tail = currentValue.length > 4 ? currentValue.slice(-4) : currentValue;
  console.log(`[INFO] Found plaintext API key (tail: ****${tail}).`);

  if (options.dryRun) {
    console.log('[DRY-RUN] Would encrypt and rewrite the row. No DB writes performed.');
    process.exit(0);
  }

  // 4. Encrypt and persist.
  let ciphertext: string;
  try {
    ciphertext = encrypt(currentValue);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FATAL] Encryption failed: ${msg}`);
    console.error(
      '        This usually means ENCRYPTION_KEY is missing or too short in production.',
    );
    process.exit(1);
  }

  const { error: writeError } = await client
    .from('settings')
    .update({
      value: ciphertext,
      updated_at: new Date().toISOString(),
    })
    .eq('key', options.targetKey);

  if (writeError) {
    console.error(`[FATAL] Failed to write encrypted value: ${writeError.message}`);
    process.exit(1);
  }

  console.log('[OK] Encrypted and rewrote the API key. Verify with:');
  console.log(`     pnpm tsx scripts/migrate-external-kb-key.ts --dry-run`);
  logger.security.info('[migrate-external-kb-key] encryption succeeded', {
    targetKey: options.targetKey,
    encryptedLength: ciphertext.length,
  });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] Unhandled error: ${msg}`);
  logger.error('[migrate-external-kb-key] unhandled error', { error: err });
  process.exit(1);
});
