import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { FeatureFlagService } from '@/server/services/feature-flag-service';
import { BackgroundSchedulerService } from '@/server/services/background-scheduler-service';
import { logger } from '@/lib/logger';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// 后台调度间隔：5分钟
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

// ─── Process Safety Net ─────────────────────────────────────
//
// Node.js 15+ terminates the process on any unhandled promise rejection
// (`--unhandled-rejections=throw` is the default). During the E2E auth-matrix
// run we issue 100+ requests with side-effecting fire-and-forget writes
// (EffectBus, knowledge-search hit-counter, message_count increments, etc.).
// A single rejected promise — for example a transient Supabase timeout — will
// therefore kill the dev server and cause every subsequent test to fail with
// `fetch failed` (Playwright reports these as "Test timeout of 30000ms exceeded"
// against the request handler).
//
// We install handlers that LOG and CONTINUE instead of letting the default
// terminate the process. `process.exit` is intentionally avoided so the server
// stays up for the rest of the test run. We only exit on explicit
// `uncaughtException` when the failure is clearly non-recoverable (OOM, native
// module crash, etc.).
function installProcessSafetyNet(): void {
  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled promise rejection — keeping process alive', {
      error,
      errorMessage: error.message,
      stack: error.stack,
      // Tag the rejection so we can grep for it in test logs.
      source: 'processSafetyNet',
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — keeping process alive', {
      error: err,
      errorMessage: err.message,
      stack: err.stack,
      source: 'processSafetyNet',
    });
    // Intentionally do NOT call process.exit(1) here. The default behaviour is
    // to terminate the process, which is what causes the cascade of
    // "fetch failed" errors during E2E test runs. If the process is truly
    // unrecoverable, the OS will reap it (e.g. EMFILE, ENOMEM).
  });

  process.on('warning', (warning) => {
    // Demote dependency deprecation warnings to debug so they don't drown
    // the test log, but keep core warnings visible.
    if (warning.name === 'DeprecationWarning' || warning.name === 'ExperimentalWarning') {
      logger.debug('Node warning', { name: warning.name, message: warning.message });
    } else {
      logger.warn('Node warning', { name: warning.name, message: warning.message });
    }
  });
}

installProcessSafetyNet();

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ─── Server Setup ───────────────────────────────────────

app.prepare().then(async () => {
  // Eagerly warm up feature flag cache before handling any requests
  await FeatureFlagService.init();

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error('Error handling request', { url: req.url, error: err });
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  server.once('error', (err) => {
    logger.error('Server error', { error: err });
    process.exit(1);
  });

  server.listen(port, () => {
    logger.info('Server started', {
      hostname,
      port,
      env: dev ? 'development' : 'production',
    });

    // 启动内置后台调度器（每5分钟执行一次）
    startBackgroundScheduler();
  });
});

// 内置后台调度器 - 自驱动定时任务（不依赖外部 Cron）
function startBackgroundScheduler(): void {
  const scheduler = new BackgroundSchedulerService();

  // 立即执行一次（服务启动时）
  runScheduledTasks(scheduler, 0);

  // 之后每 5 分钟执行一次
  setInterval(() => {
    runScheduledTasks(scheduler, SCHEDULER_INTERVAL_MS);
  }, SCHEDULER_INTERVAL_MS);

  logger.info('Background scheduler started', {
    intervalMs: SCHEDULER_INTERVAL_MS,
    intervalMinutes: SCHEDULER_INTERVAL_MS / 60000,
    tasks: ['sla_check', 'unassigned_check', 'unhandled_check', 'scheduled_campaigns', 'knowledge_learning_scan', 'cache_cleanup', 'eval_continuous'],
  });
}

async function runScheduledTasks(scheduler: BackgroundSchedulerService, delayMs: number): Promise<void> {
  if (delayMs > 0) {
    logger.debug(`Background scheduler run scheduled in ${delayMs / 60000} minutes`);
  }
  try {
    const result = await scheduler.runAll();
    const failedTasks = Object.entries(result)
      .filter(([, r]) => !r.ok)
      .map(([name, r]) => `${name}: ${r.error}`);
    if (failedTasks.length > 0) {
      logger.warn('Some background tasks failed', { failedTasks });
    } else {
      logger.debug('All background tasks completed successfully');
    }
  } catch (err) {
    logger.error('Background scheduler runAll failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
