'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Play, Pause, Square, CheckCircle2, XCircle, AlertCircle,
  Loader2, RotateCcw, TrendingUp, Clock, BarChart3, PieChart,
  Minus, Plus, Download, Layers,
} from 'lucide-react';
import { parseSSEStream } from '@/lib/sse-parser';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { SSE, HTTP } from '@/lib/constants';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

// Default and range for concurrency
const DEFAULT_CONCURRENCY = 1;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

export type ResponseSource = 'auto_reply' | 'knowledge' | 'llm' | 'handoff' | 'error';

export interface BatchResult {
  scriptIndex: number;
  groupIndex: number; // which group (worker) this result belongs to
  script: string;
  success: boolean;
  response?: string;
  confidence?: number;
  error?: string;
  duration?: number;
  sources?: Array<{ name?: string; score?: number }>;
  reason?: string;
  source?: ResponseSource;
}

export interface BatchTestPanelProps {
  scripts: string[];
  botId?: string;
  onProgress: (progress: { current: number; total: number; successCount: number; failCount: number }) => void;
  onComplete: (results: BatchResult[]) => void;
  onClose: () => void;
}

type TestStatus = 'idle' | 'running' | 'paused' | 'completed' | 'stopped';

interface ScriptResult extends BatchResult {
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime?: number;
  endTime?: number;
}

interface WorkerGroupAssignment {
  groupIndex: number;
  name: string;
  completedCount: number;
  totalCount: number;
  isRunning: boolean;
}

// P2-13: SSE stream timeout - sourced from constants
const SSE_TIMEOUT_MS = SSE.STREAM_TIMEOUT_MS;

interface ReasonDistribution {
  reason: string;
  count: number;
  source: ResponseSource;
}

function SummaryStatsPanel({ results, groupCount }: { results: ScriptResult[]; groupCount: number }) {
  const completed = useMemo(() => results.filter(r => r.status === 'success' || r.status === 'failed'), [results]);

  const successCount = useMemo(() => completed.filter(r => r.status === 'success').length, [completed]);
  const failCount = useMemo(() => completed.filter(r => r.status === 'failed').length, [completed]);
  const total = completed.length;
  const successRate = total > 0 ? successCount / total : 0;

  const avgConfidence = useMemo(() => {
    const withConfidence = completed.filter(r => r.status === 'success' && r.confidence != null);
    if (withConfidence.length === 0) return null;
    return withConfidence.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / withConfidence.length;
  }, [completed]);

  const avgDuration = useMemo(() => {
    const withDuration = completed.filter(r => r.duration != null);
    if (withDuration.length === 0) return null;
    return withDuration.reduce((sum, r) => sum + (r.duration ?? 0), 0) / withDuration.length;
  }, [completed]);

  const reasonDistribution = useMemo<ReasonDistribution[]>(() => {
    const map = new Map<string, ReasonDistribution>();
    for (const r of completed) {
      if (r.status === 'failed' || r.source === 'error') {
        const reason = r.reason ?? r.error ?? '未知错误';
        const source = r.source ?? 'error';
        const key = `${reason}|${source}`;
        if (!map.has(key)) {
          map.set(key, { reason, source, count: 0 });
        }
        map.get(key)!.count++;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [completed]);

  const successRateColor = successRate >= 0.8 ? 'text-success' : successRate >= 0.5 ? 'text-warning' : 'text-error';
  const successRateBg = successRate >= 0.8 ? 'bg-success/10' : successRate >= 0.5 ? 'bg-warning/10' : 'bg-error/10';
  const maxReasonCount = reasonDistribution.length > 0 ? reasonDistribution[0].count : 0;

  const sourceLabel: Record<ResponseSource, string> = {
    auto_reply: '自动回复',
    knowledge: '知识库',
    llm: 'LLM',
    handoff: '转人工',
    error: '异常',
  };
  const sourceColor: Record<ResponseSource, string> = {
    auto_reply: 'bg-blue-500',
    knowledge: 'bg-violet-500',
    llm: 'bg-teal-500',
    handoff: 'bg-amber-500',
    error: 'bg-red-500',
  };

  return (
    <div className="px-6 py-4 border-b border-border/50 bg-card shrink-0">
      {/* Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {/* Success Rate */}
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-success/10">
            <TrendingUp className="w-4 h-4 text-success" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">成功率</p>
            <p className={`text-lg font-semibold ${successRateColor}`}>
              {total > 0 ? `${(successRate * 100).toFixed(1)}%` : '-'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {successCount}/{total} 条成功 ({groupCount}组)
            </p>
          </div>
        </div>

        {/* Average Confidence */}
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-primary/10">
            <BarChart3 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">平均置信度</p>
            <p className="text-lg font-semibold text-foreground">
              {avgConfidence != null ? avgConfidence.toFixed(2) : '-'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {avgConfidence != null ? `${(avgConfidence * 100).toFixed(0)}%` : '无数据'}
            </p>
          </div>
        </div>

        {/* Average Duration */}
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-amber-500/10">
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">平均响应</p>
            <p className="text-lg font-semibold text-foreground">
              {avgDuration != null ? (
                avgDuration < 1000
                  ? `${Math.round(avgDuration)}ms`
                  : `${(avgDuration / 1000).toFixed(1)}s`
              ) : '-'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {avgDuration != null ? `共 ${total} 条` : '无数据'}
            </p>
          </div>
        </div>

        {/* Failures */}
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-error/10">
            <AlertCircle className="w-4 h-4 text-error" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">失败数</p>
            <p className="text-lg font-semibold text-error">{failCount}</p>
            <p className="text-[10px] text-muted-foreground">
              {reasonDistribution.length > 0 ? `${reasonDistribution.length} 类原因` : '无失败'}
            </p>
          </div>
        </div>
      </div>

      {/* Failure Reason Distribution */}
      {reasonDistribution.length > 0 && (
        <div className="p-3 rounded-lg border border-border/50 bg-muted/10">
          <div className="flex items-center gap-1.5 mb-2">
            <PieChart className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">失败原因分布</span>
          </div>
          <div className="space-y-1.5">
            {reasonDistribution.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sourceColor[item.source]}`} />
                <span className="text-xs text-muted-foreground truncate flex-1 min-w-0" title={item.reason}>
                  {item.reason}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${successRateBg}`}>
                  {item.count}次
                </span>
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                  <div
                    className={`h-full rounded-full ${sourceColor[item.source]}`}
                    style={{ width: `${(item.count / maxReasonCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border/30">
            {(Object.entries(sourceLabel) as [ResponseSource, string][]).map(([src, label]) => (
              <div key={src} className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${sourceColor[src]}`} />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function BatchTestPanel({ scripts, botId, onProgress, onComplete, onClose }: BatchTestPanelProps) {
  const { confirm } = useConfirmDialog();
  const [status, setStatus] = useState<TestStatus>('idle');
  const [results, setResults] = useState<ScriptResult[]>([]);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const abortRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(false);
  const resultsRef = useRef<BatchResult[]>([]);
  const concurrencyRef = useRef(DEFAULT_CONCURRENCY);

  // Keep concurrencyRef in sync with concurrency state
  useEffect(() => {
    concurrencyRef.current = concurrency;
  }, [concurrency]);

  const total = scripts.length * concurrency;
  const completedCount = useMemo(
    () => results.filter(r => r.status === 'success' || r.status === 'failed').length,
    [results]
  );
  const successCount = useMemo(() => results.filter(r => r.status === 'success').length, [results]);
  const failCount = useMemo(() => results.filter(r => r.status === 'failed').length, [results]);

  // Build per-worker group state from results each render
  const workerGroups = useMemo<WorkerGroupAssignment[]>(() => {
    if (status === 'idle') return [];
    const groups: WorkerGroupAssignment[] = [];
    const wc = concurrencyRef.current;
    for (let g = 0; g < wc; g++) {
      const groupResults = results.filter(r => r.groupIndex === g);
      const completed = groupResults.filter(r => r.status === 'success' || r.status === 'failed').length;
      const running = groupResults.some(r => r.status === 'running');
      groups.push({
        groupIndex: g,
        name: `组${g + 1}`,
        completedCount: completed,
        totalCount: scripts.length,
        isRunning: running,
      });
    }
    return groups;
  }, [results, status, scripts.length]);

  useEffect(() => {
    onProgress({ current: completedCount, total, successCount, failCount });
  }, [completedCount, total, successCount, failCount, onProgress]);

  const runSingleScript = async (
    script: string,
    scriptIndex: number,
    groupIndex: number,
    onUpdate: (result: BatchResult) => void
  ): Promise<BatchResult> => {
    const startTime = Date.now();

    // P1-2/P0-2: Per-script AbortController for SSE timeout (does NOT touch global abortRef)
    const scriptAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
      scriptAbortController.abort(new Error('SSE timeout'));
      logger.warn('[BatchTestPanel] SSE stream timeout', { scriptIndex });
    }, SSE_TIMEOUT_MS);

    // Bridge global abort into local controller (so stop button can interrupt this script too)
    const onGlobalAbort = () => scriptAbortController.abort();
    abortRef.current?.signal.addEventListener('abort', onGlobalAbort, { once: true });

    // Combined signal: both global and local (script timeout) must fire for this script
    const combinedSignal = scriptAbortController.signal;

    try {
      const convRes = await fetch('/api/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: 'batch_test',
          scenario_name: '批量测试',
          bot_id: botId,
        }),
        signal: combinedSignal,
      });

      if (!convRes.ok) throw new Error('创建会话失败');

      const convData = await convRes.json();
      const convId = convData.conversation?.id;
      if (!convId) throw new Error('无法获取会话ID');

      const msgRes = await fetch(`/api/simulations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: script, bot_id: botId }),
        signal: combinedSignal,
      });

      if (!msgRes.ok) {
        let errorMsg = '发送消息失败';
        try {
          const errorData = await msgRes.json();
          errorMsg = errorData.message || errorData.error || errorMsg;
          if (errorData.code) {
            errorMsg = `[${errorData.code}] ${errorMsg}`;
          }
        } catch {
          // ignore parse error
        }
        throw new Error(errorMsg);
      }

      const reader = msgRes.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      // P0-2: Pass script-local signal so parseSSEStream throws AbortError on timeout/stop
      const result = await parseSSEStream(reader, undefined, combinedSignal);

      clearTimeout(timeoutId);

      // Cleanup abort bridge
      abortRef.current?.signal.removeEventListener('abort', onGlobalAbort);

      // P0-2: Handle cleanup with error handling
      try {
        const deleteRes = await fetch(`/api/simulations/${convId}`, { method: 'DELETE' });
        if (!deleteRes.ok) {
          logger.warn('[BatchTestPanel] Failed to cleanup test conversation', { convId, status: deleteRes.status });
        }
      } catch (deleteErr) {
        logger.warn('[BatchTestPanel] Cleanup failed', { error: deleteErr, convId });
      }

      const batchResult: BatchResult = {
        scriptIndex,
        groupIndex,
        script,
        success: true,
        response: result.content,
        confidence: result.confidence ?? undefined,
        sources: result.sources,
        reason: result.reason,
        source: (result.source as ResponseSource) ?? undefined,
        duration: Date.now() - startTime,
      };
      onUpdate(batchResult);
      return batchResult;

    } catch (err) {
      clearTimeout(timeoutId);
      // Cleanup abort bridge on any exit path
      abortRef.current?.signal.removeEventListener('abort', onGlobalAbort);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      const batchResult: BatchResult = {
        scriptIndex,
        groupIndex,
        script,
        success: false,
        error: err instanceof Error ? err.message : '未知错误',
        duration: Date.now() - startTime,
      };
      onUpdate(batchResult);
      return batchResult;
    }
  };

  /**
   * Worker: processes a list of script indices serially.
   * Reports results through onUpdate (thread-safe setResults) and returns the list.
   * Throws AbortError on cancellation.
   */
  const runWorker = async (
    groupIndex: number,
    onUpdate: (result: BatchResult) => void
  ): Promise<BatchResult[]> => {
    const workerResults: BatchResult[] = [];

    for (let scriptIdx = 0; scriptIdx < scripts.length; scriptIdx++) {
      // Check abort signal before starting this script
      if (abortRef.current?.signal.aborted) {
        onUpdate({
          scriptIndex: scriptIdx,
          groupIndex,
          script: scripts[scriptIdx],
          success: false,
          error: '已中止',
          duration: 0,
        });
        continue;
      }

      // Check pause (abort-aware)
      while (isPausedRef.current) {
        if (abortRef.current?.signal.aborted) break;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 100);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          abortRef.current?.signal.addEventListener('abort', onAbort);
        });
      }

      if (abortRef.current?.signal.aborted) {
        onUpdate({
          scriptIndex: scriptIdx,
          groupIndex,
          script: scripts[scriptIdx],
          success: false,
          error: '已中止',
          duration: 0,
        });
        continue;
      }

      try {
        const result = await runSingleScript(scripts[scriptIdx], scriptIdx, groupIndex, onUpdate);
        workerResults.push(result);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          onUpdate({
            scriptIndex: scriptIdx,
            groupIndex,
            script: scripts[scriptIdx],
            success: false,
            error: '已中止',
            duration: 0,
          });
          return workerResults;
        }
        const failedResult: BatchResult = {
          scriptIndex: scriptIdx,
          groupIndex,
          script: scripts[scriptIdx],
          success: false,
          error: err instanceof Error ? err.message : '未知错误',
          duration: 0,
        };
        onUpdate(failedResult);
        workerResults.push(failedResult);
      }

      // Inter-script delay (only between scripts, not after the last)
      if (scriptIdx < scripts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return workerResults;
  };

  const runAllScripts = useCallback(async () => {
    // Validate script length before running (reuse HTTP.MAX_MESSAGE_LENGTH)
    for (const script of scripts) {
      if (script.length > HTTP.MAX_MESSAGE_LENGTH) {
        toast.error(`脚本 "${script.substring(0, 30)}..." 超过最大长度限制 (${HTTP.MAX_MESSAGE_LENGTH} 字符)`);
        return;
      }
    }

    setStatus('running');
    isPausedRef.current = false;
    abortRef.current = new AbortController();
    resultsRef.current = [];

    const workerConcurrency = concurrencyRef.current;

    // Create initial results: each group (worker) runs all scripts
    // group 0 runs [0,1,2,...], group 1 runs [0,1,2,...], etc.
    const initialResults: ScriptResult[] = [];
    for (let g = 0; g < workerConcurrency; g++) {
      for (let idx = 0; idx < scripts.length; idx++) {
        initialResults.push({
          script: scripts[idx],
          scriptIndex: idx,
          groupIndex: g,
          success: false,
          status: 'pending',
        });
      }
    }
    setResults(initialResults);

    // Each worker runs ALL scripts sequentially, in parallel with other workers
    const updateCallback = (result: BatchResult) => {
      const target = result.scriptIndex;
      const targetGroup = result.groupIndex;
      if (target == null || targetGroup == null) return;
      setResults(prev => prev.map((r) =>
        r.scriptIndex === target && r.groupIndex === targetGroup
          ? {
              ...r,
              ...result,
              status: result.success ? 'success' as const : 'failed' as const,
              startTime: result.duration != null ? Date.now() - result.duration : Date.now(),
              endTime: Date.now(),
            }
          : r
      ));
    };

    const workers: Promise<BatchResult[]>[] = [];
    for (let g = 0; g < workerConcurrency; g++) {
      workers.push(runWorker(g, updateCallback));
    }

    const workerResults = await Promise.all(workers);

    // Collect all worker results
    resultsRef.current = workerResults.flat();

    const wasAborted = abortRef.current?.signal.aborted ?? false;
    if (wasAborted) {
      setStatus('stopped');
    } else {
      setStatus('completed');
      onComplete(resultsRef.current);
    }
  }, [scripts, botId]);

  const pauseTest = () => {
    isPausedRef.current = true;
    setStatus('paused');
  };

  const resumeTest = () => {
    isPausedRef.current = false;
    setStatus('running');
  };

  const stopTest = () => {
    abortRef.current?.abort();
    setStatus('stopped');
  };

  const resetTest = () => {
    setStatus('idle');
    setResults([]);
    resultsRef.current = [];
  };

  const handleExport = async () => {
    const data = resultsRef.current.length > 0 ? resultsRef.current : results.map(r => ({
      scriptIndex: r.scriptIndex,
      groupIndex: r.groupIndex,
      script: r.script,
      success: r.status === 'success',
      response: r.response,
      confidence: r.confidence,
      source: r.source,
      duration: r.duration,
      error: r.error,
      sources: r.sources,
    }));

    try {
      const res = await fetch('/api/simulations/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: data }),
      });
      if (!res.ok) {
        let msg = '导出失败';
        try {
          const err = await res.json();
          msg = err.error || msg;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `批量测试报告_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch (err) {
      logger.error('导出失败', { error: err });
      toast.error(String(err) || '导出失败，请重试');
    }
  };

  const getStatusIcon = (resultStatus: ScriptResult['status']) => {
    switch (resultStatus) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-error" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />;
    }
  };

  const getDuration = (start?: number, end?: number) => {
    if (!start) return '-';
    const duration = (end || Date.now()) - start;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 batch-panel-overlay">
      <div className="bg-background rounded-xl shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col overflow-hidden" style={{ animation: 'panelContentIn 0.25s ease-out both' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-gradient-to-b from-muted/20 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Layers className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">批量测试</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {total} 个测试脚本
                {botId && <span className="ml-2 text-primary/70">指定Bot</span>}
              </p>
            </div>
          </div>

          {/* Concurrency control */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">并发数</span>
              <div className="flex items-center border border-border rounded-lg overflow-hidden shadow-sm">
                <button
                  onClick={() => setConcurrency(c => Math.max(MIN_CONCURRENCY, c - 1))}
                  disabled={status !== 'idle' || concurrency <= MIN_CONCURRENCY}
                  className="px-2.5 py-1.5 hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                  title="减少并发数"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="px-3 py-1.5 text-sm font-semibold text-foreground min-w-[2.5rem] text-center border-x border-border bg-muted/30">
                  {concurrency}
                </span>
                <button
                  onClick={() => setConcurrency(c => Math.min(MAX_CONCURRENCY, c + 1))}
                  disabled={status !== 'idle' || concurrency >= MAX_CONCURRENCY}
                  className="px-2.5 py-1.5 hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
                  title="增加并发数"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground/60">
                最多 {MAX_CONCURRENCY}
              </span>
            </div>

            <button
              onClick={async () => {
                if (status === 'running' || status === 'paused') {
                  const confirmed = await confirm({
                    title: '确认退出',
                    description: '测试正在执行中，退出将中止所有测试，是否确定退出？',
                    confirmText: '退出',
                    destructive: true,
                  });
                  if (!confirmed) return;
                  stopTest();
                }
                onClose();
              }}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary Stats — always visible after first result */}
        {results.length > 0 && (
          <SummaryStatsPanel results={results} groupCount={concurrency} />
        )}

        {/* Overall progress bar */}
        {(status === 'running' || status === 'paused') && (
          <div className="px-6 py-3 border-b border-border/50 bg-gradient-to-r from-primary/5 via-transparent to-transparent shrink-0 animate-fade-in">
            <div className="flex items-center gap-4">
              {/* Overall progress */}
              <div className="flex-1 flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  {status === 'paused' ? '已暂停' : '执行中'}
                </span>
                {/* Animated progress bar */}
                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden shadow-inner relative">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                    style={{ width: `${total > 0 ? (completedCount / total) * 100 : 0}%` }}
                  >
                    {/* Color based on progress */}
                    <div className={`absolute inset-0 rounded-full ${
                      successCount > 0 && completedCount === successCount
                        ? 'bg-success'
                        : failCount > 0
                        ? 'bg-gradient-to-r from-success to-warning'
                        : 'bg-primary'
                    }`} />
                    {/* Shimmer effect while running */}
                    {status === 'running' && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer rounded-full" />
                    )}
                  </div>
                </div>
                {/* Counts */}
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  <span className="font-medium text-foreground">{completedCount}</span>
                  <span className="mx-0.5">/</span>
                  <span>{total}</span>
                  {successCount > 0 && (
                    <span className="ml-2 text-success">
                      <CheckCircle2 className="w-3 h-3 inline align-text-bottom mr-0.5" />
                      {successCount}
                    </span>
                  )}
                  {failCount > 0 && (
                    <span className="ml-1.5 text-error">
                      <XCircle className="w-3 h-3 inline align-text-bottom mr-0.5" />
                      {failCount}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Per-worker group progress — compact row */}
            {workerGroups.length > 1 && (
              <div className="flex items-center gap-4 mt-2">
                {workerGroups.map((group) => (
                  <div key={group.groupIndex} className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground shrink-0 w-8 truncate">
                      {group.name}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-300 relative overflow-hidden ${
                          group.isRunning ? 'bg-primary' : 'bg-muted-foreground/40'
                        }`}
                        style={{ width: `${group.totalCount > 0 ? (group.completedCount / group.totalCount) * 100 : 0}%` }}
                      >
                        {/* Shimmer effect while running */}
                        {group.isRunning && (
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer rounded-full" />
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                      {group.completedCount}/{group.totalCount}
                    </span>
                    {group.isRunning && (
                      <Loader2 className="w-2.5 h-2.5 text-primary animate-spin shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Script List */}
        <div className="flex-1 overflow-auto p-4">
          {results.length === 0 && status === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Play className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">准备开始批量测试</p>
              <p className="text-xs text-muted-foreground/60">
                点击下方「开始测试」按钮启动
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-200 result-item-enter ${
                    result.status === 'running'
                      ? 'border-primary bg-primary/5 result-item-running'
                      : result.status === 'success'
                      ? 'border-success/20 bg-success/5'
                      : result.status === 'failed'
                      ? 'border-error/20 bg-error/5'
                      : 'border-border bg-card'
                  }`}
                  style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                >
                  <div className="mt-0.5 shrink-0">
                    {getStatusIcon(result.status)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        组{result.groupIndex + 1} #{result.scriptIndex + 1}
                      </span>
                      <span className="text-sm text-foreground truncate">
                        {result.script}
                      </span>
                    </div>

                    {result.status === 'success' && result.response && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {result.response}
                      </div>
                    )}

                    {/* Source badge */}
                    {result.status === 'success' && result.source && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          result.source === 'auto_reply' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                          result.source === 'knowledge' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' :
                          result.source === 'handoff' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                          result.source === 'llm' ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {result.source === 'auto_reply' ? '自动回复' :
                           result.source === 'knowledge' ? '知识库' :
                           result.source === 'handoff' ? '转人工' :
                           result.source === 'llm' ? 'LLM' : result.source}
                        </span>
                        {result.reason && (
                          <span className="text-[10px] text-muted-foreground/60">{result.reason}</span>
                        )}
                      </div>
                    )}

                    {result.status === 'failed' && result.error && (
                      <div className="flex items-center gap-1 text-xs text-error">
                        <AlertCircle className="w-3 h-3" />
                        {result.error}
                      </div>
                    )}

                    {result.status === 'running' && (
                      <div className="flex items-center gap-1 text-xs text-primary">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        执行中...
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground shrink-0">
                    {getDuration(result.startTime, result.endTime)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 px-6 py-4 border-t border-border bg-gradient-to-t from-muted/30 to-transparent">
          <div className="flex items-center justify-between">
            {/* Left: status + primary actions */}
            <div className="flex items-center gap-1">
              {/* Status indicator pill */}
              {status === 'running' && (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mr-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs font-medium text-primary">执行中</span>
                </div>
              )}
              {status === 'paused' && (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning/10 border border-warning/20 mr-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                  <span className="text-xs font-medium text-warning">已暂停</span>
                </div>
              )}
              {status === 'completed' && (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-success/10 border border-success/20 mr-3">
                  <CheckCircle2 className="w-3 h-3 text-success" />
                  <span className="text-xs font-medium text-success">已完成</span>
                </div>
              )}
              {status === 'stopped' && (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted border border-border mr-3">
                  <Square className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">已停止</span>
                </div>
              )}

              {/* Divider */}
              {(status === 'running' || status === 'paused') && (
                <div className="w-px h-6 bg-border mx-2" />
              )}

              {/* Primary action buttons */}
              {status === 'idle' && (
                <button
                  onClick={runAllScripts}
                  className="group flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm hover:shadow-md"
                >
                  <Play className="w-4 h-4" />
                  <span className="text-sm font-medium">开始测试</span>
                </button>
              )}

              {status === 'running' && (
                <>
                  <button
                    onClick={pauseTest}
                    className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-warning text-warning-foreground hover:bg-warning/90 active:scale-[0.98] transition-all"
                  >
                    <Pause className="w-4 h-4" />
                    <span className="text-sm font-medium">暂停</span>
                  </button>
                  <button
                    onClick={stopTest}
                    className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 active:scale-[0.98] transition-all"
                  >
                    <Square className="w-4 h-4" />
                    <span className="text-sm font-medium">停止</span>
                  </button>
                </>
              )}

              {status === 'paused' && (
                <>
                  <button
                    onClick={resumeTest}
                    className="group flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm hover:shadow-md"
                  >
                    <Play className="w-4 h-4" />
                    <span className="text-sm font-medium">继续</span>
                  </button>
                  <button
                    onClick={stopTest}
                    className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-error/10 text-error border border-error/20 hover:bg-error/20 active:scale-[0.98] transition-all"
                  >
                    <Square className="w-4 h-4" />
                    <span className="text-sm font-medium">停止</span>
                  </button>
                </>
              )}

              {(status === 'completed' || status === 'stopped') && resultsRef.current.length > 0 && (
                <button
                  onClick={handleExport}
                  className="group flex items-center gap-2 px-5 py-2 rounded-lg bg-success text-success-foreground hover:bg-success/90 active:scale-[0.98] transition-all shadow-sm hover:shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-sm font-medium">导出 Excel</span>
                </button>
              )}

              {(status === 'completed' || status === 'stopped') && (
                <button
                  onClick={resetTest}
                  className="group flex items-center gap-2 px-4 py-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-sm font-medium">重新开始</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
