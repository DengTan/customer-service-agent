'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Bot, User, Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { BotConfig } from './bot-selector';
import { SourceItem, parseSSEStream } from '@/lib/sse-parser';

export interface ABResult {
  botId: string;
  botName: string;
  responses: {
    script: string;
    content: string;
    confidence: number | null;
    sources: SourceItem[];
    success: boolean;
    error?: string;
  }[];
  stats: {
    totalResponses: number;
    successfulResponses: number;
    avgConfidence: number;
  };
}

export interface ABComparisonViewProps {
  botIds: string[];
  scripts: string[];
  onComplete: (results: ABResult[]) => void;
  onClose: () => void;
}

interface StreamState {
  botId: string;
  scriptIndex: number;
  content: string;
  confidence: number | null;
  sources: SourceItem[];
  isLoading: boolean;
  error?: string;
  done: boolean;
}

export function ABComparisonView({ botIds, scripts, onComplete, onClose }: ABComparisonViewProps) {
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [botNames, setBotNames] = useState<Record<string, string>>({});
  const [streamStates, setStreamStates] = useState<Record<string, StreamState>>({});
  const [currentScriptIndex, setCurrentScriptIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const abortRef = useRef<Record<string, AbortController>>({});
  const resultsRef = useRef<Record<string, ABResult['responses']>>({});

  useEffect(() => {
    fetchBotNames();
    return () => {
      Object.values(abortRef.current).forEach(c => c.abort());
    };
  }, [botIds]);

  const fetchBotNames = async () => {
    try {
      const res = await fetch('/api/bot-configs?include_sub_agents=false');
      if (!res.ok) return;
      const data = await res.json();
      const botList: BotConfig[] = Array.isArray(data.bots) ? data.bots : [];
      setBots(botList);

      const names: Record<string, string> = {};
      botList.forEach(b => {
        if (botIds.includes(b.id)) {
          names[b.id] = b.name;
        }
      });
      setBotNames(names);
    } catch (err) {
      console.error('Failed to fetch bot names:', err);
    }
  };

  const initStreamStates = useCallback(() => {
    const states: Record<string, StreamState> = {};
    botIds.forEach(botId => {
      states[botId] = {
        botId,
        scriptIndex: 0,
        content: '',
        confidence: null,
        sources: [],
        isLoading: false,
        done: false,
      };
    });
    resultsRef.current = {};
    botIds.forEach(botId => {
      resultsRef.current[botId] = [];
    });
    return states;
  }, [botIds]);

  const runScriptOnBot = async (botId: string, script: string, scriptIndex: number) => {
    const controller = new AbortController();
    abortRef.current[`${botId}-${scriptIndex}`] = controller;

    setStreamStates(prev => ({
      ...prev,
      [botId]: {
        ...prev[botId],
        scriptIndex,
        content: '',
        confidence: null,
        sources: [],
        isLoading: true,
        error: undefined,
        done: false,
      },
    }));

    try {
      const res = await fetch('/api/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: 'ab_test',
          scenario_name: 'A/B测试',
          bot_id: botId,
        }),
      });

      if (!res.ok) throw new Error('创建测试会话失败');

      const convData = await res.json();
      const convId = convData.conversation?.id;
      if (!convId) throw new Error('无法获取会话ID');

      const msgRes = await fetch(`/api/simulations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: script, bot_id: botId }),
        signal: controller.signal,
      });

      if (!msgRes.ok) throw new Error('发送消息失败');

      const reader = msgRes.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const result = await parseSSEStream(reader);

      setStreamStates(prev => ({
        ...prev,
        [botId]: {
          ...prev[botId],
          content: result.content,
          confidence: result.confidence,
          sources: result.sources,
          isLoading: false,
          done: true,
        },
      }));

      if (!resultsRef.current[botId]) resultsRef.current[botId] = [];
      resultsRef.current[botId].push({
        script,
        content: result.content,
        confidence: result.confidence,
        sources: result.sources,
        success: true,
      });

      await fetch(`/api/simulations/${convId}`, { method: 'DELETE' });

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;

      const errorMsg = err instanceof Error ? err.message : '未知错误';
      setStreamStates(prev => ({
        ...prev,
        [botId]: {
          ...prev[botId],
          isLoading: false,
          error: errorMsg,
          done: true,
        },
      }));

      if (!resultsRef.current[botId]) resultsRef.current[botId] = [];
      resultsRef.current[botId].push({
        script,
        content: '',
        confidence: null,
        sources: [],
        success: false,
        error: errorMsg,
      });
    } finally {
      delete abortRef.current[`${botId}-${scriptIndex}`];
    }
  };

  const runAllScripts = async () => {
    setIsRunning(true);
    setStreamStates(initStreamStates());
    setCurrentScriptIndex(0);

    for (let i = 0; i < scripts.length; i++) {
      setCurrentScriptIndex(i);

      const promises = botIds.map(botId => runScriptOnBot(botId, scripts[i], i));
      await Promise.all(promises);

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setIsRunning(false);

    const results: ABResult[] = botIds.map(botId => {
      const responses = resultsRef.current[botId] || [];
      const successfulResponses = responses.filter(r => r.success);
      const totalConfidence = responses
        .filter(r => r.success && r.confidence !== null)
        .reduce((sum, r) => sum + (r.confidence || 0), 0);
      const confidenceCount = responses.filter(r => r.success && r.confidence !== null).length;

      return {
        botId,
        botName: botNames[botId] || botId,
        responses,
        stats: {
          totalResponses: responses.length,
          successfulResponses: successfulResponses.length,
          avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
        },
      };
    });

    onComplete(results);
  };

  const stopExecution = () => {
    Object.values(abortRef.current).forEach(c => c.abort());
    setIsRunning(false);
  };

  const getConfidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'text-muted-foreground';
    if (confidence >= 0.8) return 'text-success';
    if (confidence >= 0.6) return 'text-warning';
    return 'text-error';
  };

  const getConfidenceLabel = (confidence: number | null) => {
    if (confidence === null) return '-';
    if (confidence >= 0.8) return '高';
    if (confidence >= 0.6) return '中';
    return '低';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-xl w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground">多Bot对比测试</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {scripts.length} 个测试脚本 × {botIds.length} 个Bot
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isRunning && Object.keys(streamStates).length === 0 && (
              <button
                onClick={() => setShowDiff(!showDiff)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  showDiff
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {showDiff ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                差异高亮
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Script Progress */}
        <div className="px-6 py-3 border-b border-border/50 bg-muted/20 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground shrink-0">测试进度:</span>
            <div className="flex-1 flex items-center gap-1">
              {scripts.map((script, idx) => (
                <div
                  key={idx}
                  className={`flex-1 h-2 rounded-full transition-colors ${
                    idx < currentScriptIndex
                      ? 'bg-success'
                      : idx === currentScriptIndex
                      ? 'bg-primary animate-pulse'
                      : 'bg-muted'
                  }`}
                  title={script}
                />
              ))}
            </div>
            <span className="text-xs font-medium text-foreground shrink-0">
              {Math.min(currentScriptIndex + 1, scripts.length)}/{scripts.length}
            </span>
          </div>
        </div>

        {/* Bot Headers */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `100px repeat(${botIds.length}, 1fr)` }}>
          <div className="p-3 bg-muted/30" />
          {botIds.map(botId => (
            <div key={botId} className="p-3 border-l border-border text-center bg-muted/30">
              <div className="flex items-center justify-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground truncate">
                  {botNames[botId] || botId}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          {/* Current Script */}
          {scripts.length > 0 && (
            <div className="border-b border-border/50">
              <div className="px-6 py-2 bg-muted/20">
                <span className="text-xs text-muted-foreground">当前测试: </span>
                <span className="text-xs font-medium text-foreground">
                  {scripts[currentScriptIndex] || '等待开始...'}
                </span>
              </div>
            </div>
          )}

          {/* Bot Response Columns */}
          <div className="grid" style={{ gridTemplateColumns: `100px repeat(${botIds.length}, 1fr)` }}>
            {/* Script Column Labels */}
            {scripts.map((script, scriptIdx) => (
              <>
                <div key={`label-${scriptIdx}`} className="p-4 border-b border-border/50 bg-card">
                  <div className="text-xs font-medium text-muted-foreground">
                    #{scriptIdx + 1}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {script.length > 30 ? script.slice(0, 30) + '...' : script}
                  </div>
                </div>

                {/* Bot Responses */}
                {botIds.map(botId => {
                  const state = streamStates[botId];
                  const isCurrentScript = scriptIdx === currentScriptIndex;
                  const result = resultsRef.current[botId]?.[scriptIdx];

                  return (
                    <div
                      key={`${botId}-${scriptIdx}`}
                      className={`p-4 border-b border-l border-border/50 ${
                        showDiff && scriptIdx < (resultsRef.current[botIds[0]]?.length || 0) ? 'relative' : ''
                      }`}
                    >
                      {isCurrentScript && state?.isLoading && (
                        <div className="flex items-center gap-2 text-primary">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-xs">生成中...</span>
                        </div>
                      )}

                      {state?.done && !state.content && state.error && (
                        <div className="flex items-start gap-2 text-error">
                          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span className="text-xs">{state.error}</span>
                        </div>
                      )}

                      {result?.content && (
                        <div className="space-y-2">
                          <div className={`text-sm whitespace-pre-wrap ${
                            showDiff && result.success && result.content.length < 50 ? 'bg-warning/10' : ''
                          }`}>
                            {result.content}
                          </div>

                          {result.confidence !== null && (
                            <div className="flex items-center gap-2">
                              <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                result.confidence >= 0.8
                                  ? 'bg-success/10 text-success'
                                  : result.confidence >= 0.6
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-error/10 text-error'
                              }`}>
                                {result.confidence >= 0.8 ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : result.confidence >= 0.6 ? (
                                  <AlertTriangle className="w-3 h-3" />
                                ) : (
                                  <XCircle className="w-3 h-3" />
                                )}
                                {getConfidenceLabel(result.confidence)} ({result.confidence.toFixed(2)})
                              </div>
                            </div>
                          )}

                          {result.sources && result.sources.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              引用: {result.sources.map(s => s.name || '未知').join(', ')}
                            </div>
                          )}
                        </div>
                      )}

                      {!state?.done && !result && (
                        <div className="text-xs text-muted-foreground/50">
                          等待执行...
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-card">
          <div className="flex items-center gap-4">
            {botIds.map(botId => {
              const results = resultsRef.current[botId] || [];
              const successCount = results.filter(r => r.success).length;
              const totalConfidence = results
                .filter(r => r.success && r.confidence !== null)
                .reduce((sum, r) => sum + (r.confidence || 0), 0);
              const confCount = results.filter(r => r.success && r.confidence !== null).length;

              return (
                <div key={botId} className="flex items-center gap-4 text-xs">
                  <span className="font-medium text-foreground">{botNames[botId]}:</span>
                  <span className="text-muted-foreground">
                    {successCount}/{results.length} 成功
                  </span>
                  {confCount > 0 && (
                    <span className={getConfidenceColor(totalConfidence / confCount)}>
                      平均置信度: {(totalConfidence / confCount).toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {!isRunning && Object.keys(streamStates).length === 0 && (
              <button
                onClick={runAllScripts}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                开始测试
              </button>
            )}
            {isRunning && (
              <button
                onClick={stopExecution}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-error text-error-foreground hover:bg-error/90 transition-colors"
              >
                停止
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
