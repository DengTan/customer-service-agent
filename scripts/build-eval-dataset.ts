/**
 * Build Eval Dataset Script
 * Phase 1.4 — Executable entry point for the eval dataset build.
 *
 * Usage:
 *   pnpm tsx scripts/build-eval-dataset.ts \
 *     --version-label 2026-07-golden-v1 \
 *     --bot-ids <uuid>,<uuid> \
 *     --operator-id <uuid> \
 *     [--dry-run]
 *
 * Output: JSON result compatible with CI tools.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { DatasetBuildService } from '../src/server/services/eval/dataset-build-service';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  versionLabel: string;
  targetBotIds: string[];
  operatorId: string;
  dryRun: boolean;
} {
  const args: Record<string, unknown> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];

      if (next && !next.startsWith('--')) {
        if (key === 'bot-ids') {
          // Support comma-separated list
          args[key] = next.split(',').map((s) => s.trim()).filter(Boolean);
          i++;
        } else {
          args[key] = next;
          i++;
        }
      } else {
        args[key] = true;
      }
    }
  }

  const versionLabel = (args['version-label'] as string) ?? (args['versionLabel'] as string);
  const operatorId = (args['operator-id'] as string) ?? (args['operatorId'] as string);
  const dryRun = Boolean(args['dry-run'] ?? args['dryRun'] ?? false);
  const botIdsRaw = args['bot-ids'] as string[] | undefined;

  const errors: string[] = [];

  if (!versionLabel) {
    errors.push('--version-label is required');
  }
  if (!operatorId) {
    errors.push('--operator-id is required');
  }

  if (errors.length > 0) {
    process.stderr.write(JSON.stringify({ error: 'Missing required arguments', details: errors }, null, 2) + '\n');
    process.exit(1);
  }

  return {
    versionLabel,
    targetBotIds: botIdsRaw ?? [],
    operatorId,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs();

  // Initialise Supabase client (service role — needed by DatasetBuildService internals)
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Suppress verbose service logs unless DEBUG is set
  // (logger writes to stdout/stderr so CI output remains clean)

  try {
    const service = new DatasetBuildService();
    const result = await service.build({
      versionLabel: parsed.versionLabel,
      targetBotIds: parsed.targetBotIds,
      operatorId: parsed.operatorId,
      dryRun: parsed.dryRun,
    });

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      JSON.stringify({ error: 'Build failed', details: message }, null, 2) + '\n',
    );
    process.exit(1);
  }
}

main();
