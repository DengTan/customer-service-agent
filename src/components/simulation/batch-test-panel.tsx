'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play, Pause, Square, CheckCircle2, XCircle, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { parseSSEStream } from '@/lib/sse-parser';

export interface BatchResult {
  script: string;
  success: boolean;
  response?: string;
  confidence?: number;
  error?: string;
  duration?: number;
  sources?: Array<{ name?: string; score?: number }>;
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
  scriptIndex: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime?: number;
  endTime?: number;
}

export function BatchTestPanel({ scripts, botId, onProgress, onComplete, onClose }: BatchTestPanelProps) {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [results, setResults] = useState<ScriptResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(false);
  const resultsRef = useRef<BatchResult[]>([]);

  const total = scripts.length;
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status === 'failed').length;
  const successRate = total > 0 ? (successCount / total * 100).toFixed(1) : '0';

  useEffect(() => {
    onProgress({ current: currentIndex, total, successCount, failCount });
  }, [currentIndex, total, successCount, failCount, onProgress]);

  const runSingleScript = async (script: string, scriptIndex: number): Promise<BatchResult> => {
    const startTime = Date.now();

    try {
      const convRes = await fetch('/api/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: 'batch_test',
          scenario_name: '批量测试',
          bot_id: botId,
        }),
      });

      if (!convRes.ok) throw new Error('创建会话失败');

      const convData = await convRes.json();
      const convId = convData.conversation?.id;
      if (!convId) throw new Error('无法获取会话ID');

      const msgRes = await fetch(`/api/simulations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: script, bot_id: botId }),
        signal: abortRef.current?.signal,
      });

      if (!msgRes.ok) throw new Error('发送消息失败');

      const reader = msgRes.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const result = await parseSSEStream(reader);

      await fetch(`/api/simulations/${convId}`, { method: 'DELETE' }).catch(() => {});

      return {
        script,
        success: true,
        response: result.content,
        confidence: result.confidence ?? undefined,
        sources: result.sources,
        duration: Date.now() - startTime,
      };

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }

      return {
        script,
        success: false,
        error: err instanceof Error ? err.message : '未知错误',
        duration: Date.now() - startTime,
      };
    }
  };

  const runAllScripts = useCallback(async () => {
    setStatus('running');
    isPausedRef.current = false;
    abortRef.current = new AbortController();

    const initialResults: ScriptResult[] = scripts.map((script, idx) => ({
      script,
      scriptIndex: idx,
      success: false,
      status: idx === 0 ? 'running' : 'pending',
    }));
    setResults(initialResults);
    resultsRef.current = [];

    for (let i = 0; i < scripts.length; i++) {
      if (abortRef.current.signal.aborted || status === 'stopped') {
        break;
      }

      while (isPausedRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (abortRef.current?.signal.aborted) break;
      }

      if (abortRef.current.signal.aborted) break;

      setCurrentIndex(i);
      setResults(prev => prev.map((r, idx) =>
        idx === i ? { ...r, status: 'running' as const, startTime: Date.now() } : r
      ));

      try {
        const result = await runSingleScript(scripts[i], i);

        setResults(prev => prev.map((r, idx) =>
          idx === i ? {
            ...r,
            ...result,
            status: result.success ? 'success' as const : 'failed' as const,
            endTime: Date.now(),
          } : r
        ));
        resultsRef.current.push(result);

      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatus('stopped');
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    setStatus('completed');
    onComplete(resultsRef.current);
  }, [scripts, botId, status]);

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
    setCurrentIndex(0);
    resultsRef.current = [];
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground">批量测试</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {total} 个测试脚本
              {botId && <span className="ml-2">（指定Bot）</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-6 px-6 py-4 border-b border-border/50 bg-muted/20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">进度:</span>
            <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${total > 0 ? (currentIndex / total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs font-medium text-foreground">
              {currentIndex}/{total}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="text-xs text-success font-medium">{successCount}</span>
          </div>

          <div className="flex items-center gap-1">
            <XCircle className="w-4 h-4 text-error" />
            <span className="text-xs text-error font-medium">{failCount}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">成功率:</span>
            <span className={`text-xs font-medium ${
              Number(successRate) >= 80 ? 'text-success' :
              Number(successRate) >= 60 ? 'text-warning' : 'text-error'
            }`}>
              {successRate}%
            </span>
          </div>
        </div>

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
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                    result.status === 'running'
                      ? 'border-primary bg-primary/5'
                      : result.status === 'success'
                      ? 'border-success/20 bg-success/5'
                      : result.status === 'failed'
                      ? 'border-error/20 bg-error/5'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {getStatusIcon(result.status)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        #{idx + 1}
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-card">
          <div className="flex items-center gap-2">
            {status === 'idle' && (
              <button
                onClick={runAllScripts}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Play className="w-4 h-4" />
                开始测试
              </button>
            )}

            {status === 'running' && (
              <button
                onClick={pauseTest}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-warning text-warning-foreground hover:bg-warning/90 transition-colors"
              >
                <Pause className="w-4 h-4" />
                暂停
              </button>
            )}

            {status === 'paused' && (
              <button
                onClick={resumeTest}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Play className="w-4 h-4" />
                继续
              </button>
            )}

            {(status === 'running' || status === 'paused') && (
              <button
                onClick={stopTest}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-error text-error-foreground hover:bg-error/90 transition-colors"
              >
                <Square className="w-4 h-4" />
                停止
              </button>
            )}

            {(status === 'completed' || status === 'stopped') && (
              <button
                onClick={resetTest}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                重新开始
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
