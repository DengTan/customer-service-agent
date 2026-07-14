'use client';

import { X, BookOpen, Zap, Network, Wrench, FileText, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Ruler, ArrowLeft, Sparkles } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

interface SourceItem {
  type?: string; // optional for backward compatibility, defaults handled in processing
  content?: string;
  score?: number;
  keyword?: string;
  name?: string;
  category?: string;
  knowledge_item_id?: string;
  item_id?: string;
  /**
   * P2: stable chunk identity for citation stability.
   * When chunk_id is present, use it as the stable key; fall back to knowledge_item_id.
   * null chunk_id means parent item was matched directly (no sub-chunk).
   */
  chunk_id?: string | null;
  chunk_index?: number;
  content_hash?: string | null;
  /**
   * Provenance contract version.
   * - 2 = claim-verified by the orchestrator (default for new messages)
   * - 1 = legacy: candidates merged into sources without verification (pre-RAG-fix)
   */
  provenanceVersion?: 1 | 2;
  /** Optional rerank backend tag (e.g. "mock", "bge", "cohere"). */
  rerankBackend?: string;
}

interface SourceMessageItem {
  id: string;
  content: string;
  sources: SourceItem[];
  confidence?: number;
  confidenceBreakdown?: {
    knowledge_score: number;
    tool_score: number;
    llm_self_score: number;
    sub_agent_score: number;
    handoff_intent: boolean;
    no_support: boolean;
    final: number;
  } | null;
}

interface SourcePanelProps {
  sources?: SourceItem[];
  confidence?: number | null;
  confidenceBreakdown?: {
    knowledge_score: number;
    tool_score: number;
    llm_self_score: number;
    sub_agent_score: number;
    handoff_intent: boolean;
    no_support: boolean;
    final: number;
  } | null;
  messageId?: string;
  conversationId?: string;
  /** 消息列表模式：所有带引用的消息 */
  messagesWithSources?: SourceMessageItem[];
  onClose: () => void;
  onSelectMessage?: (msg: SourceMessageItem) => void;
}

function getSourceIcon(type: string | undefined) {
  switch (type) {
    case 'knowledge':
      return <BookOpen className="w-3.5 h-3.5 text-primary" />;
    case 'auto_reply':
      return <Zap className="w-3.5 h-3.5 text-amber-500" />;
    case 'sub_agent_delegation':
      return <Network className="w-3.5 h-3.5 text-blue-500" />;
    case 'tool':
      return <Wrench className="w-3.5 h-3.5 text-emerald-500" />;
    case 'size_chart':
      return <Ruler className="w-3.5 h-3.5 text-purple-500" />;
    default:
      return <FileText className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function getSourceLabel(type: string | undefined) {
  switch (type) {
    case 'knowledge':
      return '知识库';
    case 'auto_reply':
      return '自动回复';
    case 'sub_agent_delegation':
      return '子Agent';
    case 'tool':
      return '工具调用';
    case 'size_chart':
      return '尺码表';
    default:
      return '引用';
  }
}

function getScoreColor(score: number): string {
  if (score >= 0.85) return 'bg-emerald-500';
  if (score >= 0.75) return 'bg-primary';
  if (score >= 0.5) return 'bg-amber-500';
  return 'bg-red-500';
}

function getScoreTextColor(score: number): string {
  if (score >= 0.85) return 'text-emerald-600';
  if (score >= 0.75) return 'text-primary';
  if (score >= 0.5) return 'text-amber-600';
  return 'text-red-600';
}

export function SourcePanel({
  sources = [],
  confidence,
  confidenceBreakdown,
  messageId,
  conversationId,
  messagesWithSources,
  onClose,
  onSelectMessage,
}: SourcePanelProps) {
  // 源列表展开状态（使用数字索引）
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  // 置信度详情展开状态（独立状态）
  const [confidenceExpanded, setConfidenceExpanded] = useState(false);
  const [feedbackStates, setFeedbackStates] = useState<Record<number, 'submitting' | 'submitted' | 'rejected'>>({});
  // 消息列表模式：当前选中的消息
  const [selectedMessage, setSelectedMessage] = useState<SourceMessageItem | null>(null);
  // 是否显示消息列表
  const isMessageListMode = messagesWithSources && messagesWithSources.length > 0;

  // 当传入 messagesWithSources 时，自动显示消息列表
  const [showList, setShowList] = useState(!!isMessageListMode);

  // Sync showList when messagesWithSources changes
  useEffect(() => {
    setShowList(!!isMessageListMode);
    if (!isMessageListMode) {
      setSelectedMessage(null);
    }
  }, [isMessageListMode]);

  // 处理消息选择
  const handleSelectMessage = (msg: SourceMessageItem) => {
    setSelectedMessage(msg);
    setShowList(false);
    onSelectMessage?.(msg);
  };

  // 处理返回列表
  const handleBackToList = () => {
    setSelectedMessage(null);
    setShowList(true);
  };

  // 当前显示的 sources 和 confidence（优先使用选中的消息，否则使用 props）
  const currentSources = selectedMessage?.sources || sources;
  const currentConfidence = selectedMessage?.confidence ?? confidence;
  const currentBreakdown = selectedMessage?.confidenceBreakdown ?? confidenceBreakdown;
  const currentMessageId = selectedMessage?.id || messageId;

  // Group sources by type for summary
  const sourceTypeCounts = sources.reduce<Record<string, number>>((acc, s) => {
    const type = s.type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const submitSourceFeedback = useCallback(async (
    index: number,
    source: SourceItem,
    feedbackType: 'adopted' | 'rejected',
  ) => {
    // P2: use stable chunk identity as the primary key; fall back to item id
    const stableId = source.chunk_id ?? source.knowledge_item_id ?? source.item_id;
    if (!stableId) {
      toast.error('无法定位知识条目');
      return;
    }
    setFeedbackStates((prev) => ({ ...prev, [index]: 'submitting' }));
    try {
      const res = await fetch('/api/knowledge/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          conversation_id: conversationId,
          // P2: prefer chunk_id as stable key; include full identity for audit
          knowledge_item_id: source.knowledge_item_id ?? source.item_id,
          chunk_id: source.chunk_id ?? null,
          chunk_index: source.chunk_index ?? 0,
          content_hash: source.content_hash ?? null,
          knowledge_name: source.name,
          knowledge_score: source.score,
          feedback_type: feedbackType,
          reason: 'user_rejected',
        }),
      });
      if (!res.ok) throw new Error('提交失败');
      setFeedbackStates((prev) => ({ ...prev, [index]: 'submitted' }));
      toast.success(feedbackType === 'adopted' ? '已记录为有用' : '已记录为不准确');
    } catch (e) {
      logger.error('feedback error', { error: e });
      setFeedbackStates((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      toast.error('反馈提交失败，请稍后重试');
    }
  }, [messageId, conversationId]);

  return (
    <div className="w-80 border-l border-border bg-card shrink-0 flex flex-col overflow-hidden animate-slide-in-right">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          {showList && isMessageListMode ? (
            <>
              <BookOpen className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground leading-tight">选择消息</span>
              <span className="text-xs text-muted-foreground leading-tight">({messagesWithSources.length})</span>
            </>
          ) : selectedMessage ? (
            <>
              <button
                onClick={handleBackToList}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-foreground leading-tight">消息引用详情</span>
            </>
          ) : (
            <>
              <BookOpen className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground leading-tight">AI 引用溯源</span>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 消息列表模式 */}
        {showList && isMessageListMode ? (
          <div className="py-2">
            {messagesWithSources.map((msg, index) => (
              <button
                key={msg.id || index}
                onClick={() => handleSelectMessage(msg)}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-b-0"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {/* 消息内容预览 */}
                    <div className="text-xs text-foreground line-clamp-2 mb-1">
                      {msg.content}
                    </div>
                    {/* 引用统计 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {msg.sources.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          <BookOpen className="w-2.5 h-2.5" />
                          {msg.sources.length}条引用
                        </span>
                      )}
                      {msg.confidence !== undefined && msg.confidence !== null && (
                        <span className="text-[10px] text-muted-foreground">
                          置信度 {Math.round(msg.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 mt-1" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Confidence overview */}
            {currentConfidence !== null && currentConfidence !== undefined && (
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">综合置信度</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${getScoreTextColor(currentConfidence)}`}>
                  {Math.round(currentConfidence * 100)}%
                </span>
                {currentBreakdown && (
                  <button
                    onClick={() => setConfidenceExpanded(!confidenceExpanded)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {confidenceExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getScoreColor(currentConfidence)}`}
                style={{ width: `${Math.round(currentConfidence * 100)}%` }}
              />
            </div>
            {/* Confidence breakdown - expandable */}
            {confidenceExpanded && currentBreakdown && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <BookOpen className="w-3 h-3 text-primary" />
                  <span>知识库匹配</span>
                  <span className="ml-auto">{currentBreakdown.knowledge_score > 0 ? `${Math.round(currentBreakdown.knowledge_score * 100)}%` : '-'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Wrench className="w-3 h-3 text-emerald-500" />
                  <span>工具调用</span>
                  <span className="ml-auto">{currentBreakdown.tool_score > 0 ? `${Math.round(currentBreakdown.tool_score * 100)}%` : '-'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>LLM 自评</span>
                  <span className="ml-auto">{currentBreakdown.llm_self_score > 0 ? `${Math.round(currentBreakdown.llm_self_score * 100)}%` : '-'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Network className="w-3 h-3 text-blue-500" />
                  <span>子Agent</span>
                  <span className="ml-auto">{currentBreakdown.sub_agent_score > 0 ? `${Math.round(currentBreakdown.sub_agent_score * 100)}%` : '-'}</span>
                </div>
                {currentBreakdown.no_support && (
                  <div className="text-[10px] text-amber-600 mt-1">⚠️ 无知识库/工具支撑</div>
                )}
                {currentBreakdown.handoff_intent && (
                  <div className="text-[10px] text-red-500">⚠️ 检测到转人工意图</div>
                )}
              </div>
            )}
          </div>
        )}

                {/* Source list */}
        {currentSources.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-5 h-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">该回复未引用知识库内容</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">AI 基于通用知识生成此回复</p>
          </div>
        ) : (
          <div className="py-2">
            {currentSources.map((source, index) => (
              <div key={index} className="px-3 mb-1">
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                >
                  <div className={`flex items-start gap-2.5 px-2 py-2.5 rounded-lg transition-colors hover:bg-muted/50 ${expandedIndex === index ? 'bg-muted/50' : ''}`}>
                    {/* Icon */}
                    <div className="shrink-0 mt-0.5">
                      {getSourceIcon(source.type)}
                    </div>
                    {/* Content preview */}
                    <div className="flex-1 min-w-0">
                      {/* Header row: type badge, score, category */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {getSourceLabel(source.type)}
                        </span>
                        {/* Legacy provenance marker — only show for v1 citations to help
                            UI consumers distinguish pre-fix messages from claim-verified ones. */}
                        {source.provenanceVersion === 1 && (
                          <span
                            className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            title="Legacy retrieval source — claim support was not verified"
                          >
                            未核验引用
                          </span>
                        )}
                        {source.rerankBackend === 'mock' && source.provenanceVersion !== 1 && (
                          <span
                            className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            title="Heuristic rerank (mock fallback) — not a cross-encoder"
                          >
                            启发式打分
                          </span>
                        )}
                        {source.score !== undefined && source.score > 0 && (
                          <span className={`inline-flex items-center text-[10px] font-medium px-1 py-0.5 rounded ${getScoreTextColor(source.score).replace('text-', 'bg-').replace('-600', '-100')}`}>
                            <span className={getScoreTextColor(source.score)}>{Math.round(source.score * 100)}%</span>
                          </span>
                        )}
                        {source.category && (
                          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[80px]">
                            {source.category}
                          </span>
                        )}
                      </div>
                      {/* Name */}
                      {source.name && (
                        <div className="text-xs font-medium text-foreground truncate mb-0.5" title={source.name}>
                          {source.name}
                        </div>
                      )}
                      {/* Content preview */}
                      {source.content && (
                        <div className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {source.content}
                        </div>
                      )}
                      {source.keyword && (
                        <div className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                          <span className="bg-amber-100 dark:bg-amber-900/30 px-1 py-0.5 rounded">
                            关键词：{source.keyword}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Expand indicator */}
                    <div className="shrink-0 mt-1 text-muted-foreground/40">
                      {expandedIndex === index ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </div>
                </button>
                {/* Expanded detail */}
                {expandedIndex === index && source.content && (
                  <div className="mt-1 px-2 py-2 bg-surface-container rounded-lg border border-border/50">
                    <div className="text-[10px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <FileText className="w-3 h-3" />
                      原文内容
                    </div>
                    <div className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                      {source.content}
                    </div>
                    {/* Score bar */}
                    {source.score !== undefined && source.score > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">相关度</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getScoreTextColor(source.score).replace('text-', 'bg-').replace('-600', '-100')}`}>
                            <span className={getScoreTextColor(source.score)}>{Math.round(source.score * 100)}%</span>
                          </span>
                        </div>
                        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getScoreColor(source.score)}`}
                            style={{ width: `${Math.round(source.score * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {/* Feedback row */}
                    {source.knowledge_item_id && currentMessageId && (
                      <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between gap-2">
                        {feedbackStates[index] === 'submitted' ? (
                          <span className="text-[10px] text-muted-foreground">已记录反馈，感谢</span>
                        ) : feedbackStates[index] === 'submitting' ? (
                          <span className="text-[10px] text-muted-foreground">提交中...</span>
                        ) : (
                          <>
                            <span className="text-[10px] text-muted-foreground">这条引用对你有帮助吗？</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  submitSourceFeedback(index, source, 'adopted');
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                title="这条引用是有用的"
                              >
                                <ThumbsUp className="w-3 h-3" />
                                有用
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  submitSourceFeedback(index, source, 'rejected');
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="这条引用不准确 / 不相关"
                              >
                                <ThumbsDown className="w-3 h-3" />
                                不准确
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
