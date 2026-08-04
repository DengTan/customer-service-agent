/**
 * 定时调度任务触发接口
 * GET /api/admin/scheduler/run
 */
import { withApi } from '@/lib/api/with-api';
import { BackgroundSchedulerService } from '@/server/services/background-scheduler-service';

const VALID_TASKS = ['sla_check', 'unassigned_check', 'unhandled_check', 'scheduled_campaigns', 'knowledge_learning_scan'] as const;
type TaskName = (typeof VALID_TASKS)[number];

export const GET = withApi(
  { auth: 'required', perm: { resource: 'settings', action: 'write' } },
  async ({ request }) => {
    const tasksParam = request.nextUrl.searchParams.get('tasks') ?? 'all';
    let tasksToRun: string[];

    if (tasksParam === 'all') {
      tasksToRun = [...VALID_TASKS];
    } else {
      tasksToRun = tasksParam.split(',').map(t => t.trim()).filter(Boolean);
      const invalid = tasksToRun.filter(t => !(VALID_TASKS as readonly string[]).includes(t));
      if (invalid.length > 0) {
        return new Response(JSON.stringify({ error: `无效的 task: ${invalid.join(', ')}，允许的值: ${VALID_TASKS.join(', ')}, all`, code: 'INVALID_TASK' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const scheduler = new BackgroundSchedulerService();
    const results: Record<string, unknown> = {};

    if (tasksToRun.includes('sla_check')) {
      results.sla_check = await scheduler.runSLACheck();
    }
    if (tasksToRun.includes('unassigned_check')) {
      results.unassigned_check = await scheduler.runUnassignedCheck();
    }
    if (tasksToRun.includes('unhandled_check')) {
      results.unhandled_check = await scheduler.runUnhandledReminder();
    }
    if (tasksToRun.includes('scheduled_campaigns')) {
      results.scheduled_campaigns = await scheduler.runScheduledCampaigns();
    }
    if (tasksToRun.includes('knowledge_learning_scan')) {
      results.knowledge_learning_scan = await scheduler.runKnowledgeLearningScan();
    }

    return new Response(JSON.stringify({
      tasks: tasksToRun,
      results,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
