import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';

// Timeout for fetch calls in batch operations (30 seconds)
const FETCH_TIMEOUT_MS = 30000;

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeout));
}

interface BatchTask {
  id: string;
  scripts: string[];
  botId?: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled';
  currentIndex: number;
  total: number;
  successCount: number;
  failCount: number;
  results: Array<{
    script: string;
    success: boolean;
    response?: string;
    confidence?: number;
    error?: string;
  }>;
  createdAt: string;
  completedAt?: string;
}

// In-memory task storage for demo mode
const batchTasks = new Map<string, BatchTask>();

// Clean up old tasks on demand (called on each request)
function cleanupOldTasks() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, task] of batchTasks.entries()) {
    const createdAt = new Date(task.createdAt).getTime();
    if (createdAt < oneHourAgo) {
      batchTasks.delete(id);
    }
  }
}

// POST /api/simulations/batch - Start batch test
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  cleanupOldTasks(); // Clean up old tasks on each request
  const { data: body, error: parseError } = await request.json().catch(() => ({ data: null, error: 'Invalid JSON' }));
  if (parseError) {
    return apiError('Invalid request body', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const scripts = body?.scripts as string[];
  const botId = body?.botId as string | undefined;

  if (!Array.isArray(scripts) || scripts.length === 0) {
    return apiError('scripts is required and must be a non-empty array', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  if (scripts.length > 50) {
    return apiError('Maximum 50 scripts allowed per batch', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  const taskId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const task: BatchTask = {
    id: taskId,
    scripts,
    botId,
    status: 'pending',
    currentIndex: 0,
    total: scripts.length,
    successCount: 0,
    failCount: 0,
    results: [],
    createdAt: new Date().toISOString(),
  };

  batchTasks.set(taskId, task);

  // Start async execution
  executeBatchTask(taskId);

  return apiSuccess({
    task_id: taskId,
    status: task.status,
    total: task.total,
  });
});

// GET /api/simulations/batch?task_id=xxx - Get batch test progress
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  cleanupOldTasks(); // Clean up old tasks on each request
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task_id');

  if (!taskId) {
    return apiError('task_id is required', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const task = batchTasks.get(taskId);

  if (!task) {
    return apiError('Task not found', { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' });
  }

  return apiSuccess({
    task_id: task.id,
    status: task.status,
    progress: {
      current: task.currentIndex,
      total: task.total,
      success_count: task.successCount,
      fail_count: task.failCount,
    },
    results: task.results,
    created_at: task.createdAt,
    completed_at: task.completedAt,
  });
});

// DELETE /api/simulations/batch?task_id=xxx - Cancel batch test
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task_id');

  if (!taskId) {
    return apiError('task_id is required', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const task = batchTasks.get(taskId);

  if (!task) {
    return apiError('Task not found', { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' });
  }

  if (task.status === 'completed' || task.status === 'cancelled') {
    return apiError('Task already finished', { status: HttpStatus.BAD_REQUEST, code: 'INVALID_STATE' });
  }

  task.status = 'cancelled';
  batchTasks.set(taskId, task);

  return apiSuccess({ task_id: taskId, status: 'cancelled' });
});

async function executeBatchTask(taskId: string) {
  const task = batchTasks.get(taskId);
  if (!task) return;

  task.status = 'running';
  batchTasks.set(taskId, task);

  for (let i = 0; i < task.scripts.length; i++) {
    const currentTask = batchTasks.get(taskId);
    if (!currentTask || currentTask.status === 'cancelled') {
      return;
    }

    currentTask.currentIndex = i;
    batchTasks.set(taskId, currentTask);

    try {
      const result = await executeSingleScript(currentTask.scripts[i], currentTask.botId);

      const updatedTask = batchTasks.get(taskId);
      if (!updatedTask) return;

      if (result.success) {
        updatedTask.successCount++;
      } else {
        updatedTask.failCount++;
      }

      updatedTask.results.push(result);
      batchTasks.set(taskId, updatedTask);

    } catch (err) {
      const updatedTask = batchTasks.get(taskId);
      if (updatedTask) {
        updatedTask.failCount++;
        updatedTask.results.push({
          script: currentTask.scripts[i],
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
        batchTasks.set(taskId, updatedTask);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const finalTask = batchTasks.get(taskId);
  if (finalTask && finalTask.status !== 'cancelled') {
    finalTask.status = 'completed';
    finalTask.completedAt = new Date().toISOString();
    batchTasks.set(taskId, finalTask);
  }
}

async function executeSingleScript(script: string, botId?: string): Promise<{
  script: string;
  success: boolean;
  response?: string;
  confidence?: number;
  error?: string;
}> {
  try {
    // Create a new conversation for this test
    const convRes = await fetchWithTimeout('/api/simulations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario_id: 'batch_test',
        scenario_name: '批量测试',
        bot_id: botId,
      }),
    });

    if (!convRes.ok) {
      return { script, success: false, error: 'Failed to create conversation' };
    }

    const convData = await convRes.json();
    const convId = convData.conversation?.id;

    if (!convId) {
      return { script, success: false, error: 'No conversation ID returned' };
    }

    // Send message
    const msgRes = await fetchWithTimeout(`/api/simulations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: script, bot_id: botId }),
    });

    if (!msgRes.ok) {
      return { script, success: false, error: 'Failed to send message' };
    }

    const reader = msgRes.body?.getReader();
    if (!reader) {
      return { script, success: false, error: 'No response body' };
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let lastConfidence: number | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.content) {
              fullContent += parsed.content;
            }
            if (parsed.done) {
              if (parsed.confidence !== undefined) {
                lastConfidence = parsed.confidence;
              }
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    }

    // Cleanup conversation
    fetch(`/api/simulations/${convId}`, { method: 'DELETE' }).catch(() => {});

    return {
      script,
      success: true,
      response: fullContent,
      confidence: lastConfidence || undefined,
    };

  } catch (err) {
    return {
      script,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
