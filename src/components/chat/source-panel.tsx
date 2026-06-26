'use client';

import { X, BookOpen, Zap, Network, Wrench, FileText, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Ruler } from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

interface SourceItem {
  type: string;
  content?: string;
  score?: number;
  keyword?: string;
  name?: string;
  category?: string;
  knowledge_item_id?: string;
  item_id?: string;
}

interface SourcePanelProps {
  sources: SourceItem[];
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
  onClose: () => void;
}

function getSourceIcon(type: string) {
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

function getSourceLabel(type: string) {
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

export function SourcePanel({ sources, confidence, confidenceBreakdown, messageId, conversationId, onClose }: SourcePanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [feedbackStates, setFeedbackStates] = useState<Record<number, 'submitting' | 'submitted' | 'rejected'>>({});

  // Group sources by type for summary
  const sourceTypeCounts = sources.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {});

  const submitSourceFeedback = useCallback(async (
    index: number,
    source: SourceItem,
    feedbackType: 'adopted' | 'rejected',
  ) => {
    const itemId = source.knowledge_item_id || source.item_id;
    if (!itemId) {
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
          knowledge_item_id: itemId,
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
      console.error('feedback error', e);
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">AI 引用溯源</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Confidence overview */}
        {confidence !== null && confidence !== undefined && (
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">综合置信度</span>
              <span className={`text-sm font-semibold ${getScoreTextColor(confidence)}`}>
                {Math.round(confidence * 100)}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getScoreColor(confidence)}`}
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            {/* Confidence breakdown */}
            {confidenceBreakdown && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>知识库匹配</span>
                  <span>{confidenceBreakdown.knowledge_score > 0 ? `${Math.round(confidenceBreakdown.knowledge_score * 100)}%` : '-'}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>工具调用</span>
                  <span>{confidenceBreakdown.tool_score > 0 ? `${Math.round(confidenceBreakdown.tool_score * 100)}%` : '-'}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>LLM 自评</span>
                  <span>{confidenceBreakdown.llm_self_score > 0 ? `${Math.round(confidenceBreakdown.llm_self_score * 100)}%` : '-'}</span>
                </div>
                {confidenceBreakdown.sub_agent_score > 0 && (
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>子Agent</span>
                    <span>{Math.round(confidenceBreakdown.sub_agent_score * 100)}%</span>
                  </div>
                )}
                {confidenceBreakdown.no_support && (
                  <div className="text-[10px] text-amber-600 mt-1">无知识库/工具支撑</div>
                )}
                {confidenceBreakdown.handoff_intent && (
                  <div className="text-[10px] text-red-500">检测到转人工意图</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Source type summary */}
        {Object.keys(sourceTypeCounts).length > 0 && (
          <div className="px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(sourceTypeCounts).map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {getSourceIcon(type)}
                  {getSourceLabel(type)} {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Source list */}
        {sources.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-5 h-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">该回复未引用知识库内容</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">AI 基于通用知识生成此回复</p>
          </div>
        ) : (
          <div className="py-2">
            {sources.map((source, index) => (
              <div key={index} className="px-3">
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
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {getSourceLabel(source.type)}
                        </span>
                        {source.score !== undefined && source.score > 0 && (
                          <span className={`text-[10px] font-medium ${getScoreTextColor(source.score)}`}>
                            {Math.round(source.score * 100)}%
                          </span>
                        )}
                        {source.category && (
                          <span className="text-[10px] px-1 py-0 rounded bg-primary/8 text-primary">
                            {source.category}
                          </span>
                        )}
                      </div>
                      {source.name && (
                        <div className="text-xs font-medium text-foreground truncate mb-0.5">
                          {source.name}
                        </div>
                      )}
                      {source.content && (
                        <div className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {source.content}
                        </div>
                      )}
                      {source.keyword && (
                        <div className="text-[10px] text-amber-600 mt-0.5">
                          关键词：{source.keyword}
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
                  <div className="ml-7 mr-2 mb-2 p-3 bg-surface-container rounded-lg border border-border/50">
                    <div className="text-[10px] font-medium text-muted-foreground mb-1.5">原文内容</div>
                    <div className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                      {source.content}
                    </div>
                    {/* Score bar */}
                    {source.score !== undefined && source.score > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">相关度</span>
                          <span className={`text-[10px] font-medium ${getScoreTextColor(source.score)}`}>
                            {Math.round(source.score * 100)}%
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
                    {source.knowledge_item_id && messageId && (
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
      </div>
    </div>
  );
}
