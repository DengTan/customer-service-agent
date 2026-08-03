/**
 * Outbox Replay CLI (B4b).
 *
 * Thin wrapper around OutboxReplayWorker for cron/scheduled execution.
 * Usage:
 *   pnpm replay:outbox          # process one batch
 *   node --import tsx scripts/replay-outbox.ts  # alternative
 *
 * Workers should be triggered via external cron (e.g., GitHub Actions scheduled
 * workflow, external cron service) rather than in-process setInterval,
 * to avoid memory leaks and to survive app restarts.
 *
 * Recommended cron: every 1 minute.
 */

import { OutboxReplayWorker } from '../src/lib/effects/outbox-replay';
import { logger } from '../src/lib/logger';

async function main(): Promise<void> {
  const worker = new OutboxReplayWorker();

  // Placeholder: in production, register actual effect handlers here.
  // For now, the worker runs but has no handlers (it will mark items as failed).
  // Real handlers are registered in the application bootstrap.

  let total = 0;
  let processed = 0;

  while (true) {
    const n = await worker.processBatch(10);
    processed += n;
    total++;
    if (n === 0) break;
    if (total > 100) {
      logger.agent.warn('[replay-outbox] exceeded 100 iterations, bailing out');
      break;
    }
  }

  logger.agent.info('[replay-outbox] done', { batches: total, items: processed });
}

main().catch((err) => {
  logger.agent.error('[replay-outbox] fatal error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
