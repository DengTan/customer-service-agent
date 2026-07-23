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
