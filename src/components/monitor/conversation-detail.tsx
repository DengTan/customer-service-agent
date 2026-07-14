'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Headphones,
  PhoneOff,
  Send,
  FileText,
  AlertTriangle,
  Bot,
  User,
  BookOpen,
  Copy,
  Check,
  Network,
  RotateCcw,
  Ticket,
  StickyNote,
  AtSign,
  Globe,
  ImageIcon,
  Loader2,
  Paperclip,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import type { Conversation, Message, CardAction } from '@/lib/types';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import { RichMessageCard } from '@/components/chat/rich-message-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMessageTime, shouldShowTimeDivider } from '@/lib/chat-utils';
import { useThemeSettings } from '@/lib/theme-settings-context';
import { logger } from '@/lib/logger';

interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

/** Skeleton for message loading state */
function MessageSkeletonList() {
  return (
    <div className="space-y-5 max-w-3xl mx-auto px-6">
      {Array.from({ length: 4 }).map((_, i) => {
        const isUser = i % 2 === 0;
        return (
          <div key={i} className="flex gap-2 animate-skeleton-pulse" style={{ animationDelay: `${i * 80}ms` }}>
            {!isUser && <Skeleton className="w-7 h-7 rounded-full shrink-0 mt-0.5" />}
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-3 w-20 rounded" />
              <div className={`space-y-1 ${isUser ? 'ml-auto' : ''}`}>
                <Skeleton className={`h-9 rounded-lg ${isUser ? 'w-2/3 ml-auto' : 'w-3/4'}`} />
                {(i === 1 || i === 3) && (
                  <Skeleton className={`h-9 rounded-lg ${isUser ? 'w-1/2 ml-auto' : 'w-5/6'}`} />
                )}
              </div>
            </div>
            {isUser && <Skeleton className="w-7 h-7 rounded-full shrink-0 mt-0.5" />}
          </div>
        );
      })}
    </div>
  );
}

interface ConversationDetailProps {
  conversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  onTakeover: (id: string) => void;
  onEnd: (id: string) => void;
  onReopen: (id: string) => void;
  onSendMessage: (convId: string, content: string) => void;
  onSendInternalNote: (convId: string, content: string, mentions: string[]) => void;
  onCreateTicket: (convId: string) => void;
}

export function ConversationDetail({
  conversation,
  messages,
  isLoading,
  onTakeover,
  onEnd,
  onReopen,
  onSendMessage,
  onSendInternalNote,
  onCreateTicket,
}: ConversationDetailProps) {
  const [inputText, setInputText] = useState('');
  const [noteMode, setNoteMode] = useState(false);
  const [mentionInput, setMentionInput] = useState('');
  const [showMentionList, setShowMentionList] = useState(false);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedConfMsgId, setExpandedConfMsgId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<Array<{ title: string; content: string; category: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user: currentUser } = useAuth();

  // Get current user ID from auth context (fallback for backward compatibility)
  const currentAgentId = currentUser?.id || process.env.NEXT_PUBLIC_CURRENT_AGENT_ID || '';

  // Theme settings for appearance preferences
  const { settings: themeSettings } = useThemeSettings();

  // Handle card action button clicks (refund confirmation, etc.)
  const handleCardAction = useCallback((action: CardAction) => {
    // For monitor view, show info toast and optionally copy data
    switch (action.type) {
      case 'confirm_refund': {
        const refundId = String(action.data?.refund_id || '');
        toast.success(`退款申请已确认提交 (单号: ${refundId})`);
        break;
      }
      case 'cancel_refund': {
        toast.info('退款申请已取消');
        break;
      }
      case 'view_order_detail': {
        const orderId = String(action.data?.order_id || '');
        if (orderId) {
          navigator.clipboard.writeText(orderId);
          toast.success('订单号已复制');
        }
        break;
      }
      case 'view_logistics': {
        const trackingNo = String(action.data?.tracking_number || action.data?.order_id || '');
        toast.info(`物流查询: ${trackingNo}`);
        break;
      }
      default:
        toast.info(`操作: ${action.label}`);
    }
  }, []);

  // Reset input state when conversation changes
  useEffect(() => {
    setNoteMode(false);
    setInputText('');
    setAttachments([]);
  }, [conversation?.id]);

  // Load agents for @mention
  useEffect(() => {
    async function loadAgents() {
      try {
        const res = await fetch('/api/users?role=agent&status=active');
        if (res.ok) {
          const data = await res.json();
          setAgents(
            (data.users || [])
              .filter((u: { id: string }) => u.id !== currentAgentId)
              .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))
          );
        }
      } catch { /* ignore */ }
    }
    loadAgents();
  }, []);

  // Fetch quick replies
  useEffect(() => {
    fetch('/api/quick-replies')
      .then(res => res.ok ? res.json() : { replies: [] })
      .then(data => setQuickReplies(data.replies || []))
      .catch((err) => logger.error('[ConversationDetail] Failed to fetch quick replies', { error: err }));
  }, []);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Get last assistant confidence
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastConfidence = lastAssistantMsg?.confidence ?? null;
  const isLowConfidence = lastConfidence !== null && lastConfidence < 0.4;

  const handleTakeover = () => {
    if (!conversation) return;
    onTakeover(conversation.id);
    // UI updates are driven by conversation.status changing to 'handoff' via parent
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
      if (!validTypes.includes(file.type)) {
        toast.error(`不支持的文件格式: ${file.name}`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`文件过大: ${file.name}，最大支持 10MB`);
        continue;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        const newAttachment: Attachment = {
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          name: file.name,
          url: data.url || data.file_url,
          type: file.type,
          size: file.size,
        };
        setAttachments(prev => [...prev, newAttachment]);
        toast.success(`已添加附件: ${file.name}`);
      } catch {
        toast.error(`上传失败: ${file.name}`);
      } finally {
        setUploading(false);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSend = () => {
    if (!conversation || (!inputText.trim() && attachments.length === 0)) return;

    if (noteMode) {
      const mentions = agents
        .filter((a) => inputText.includes(`@${a.name}`))
        .map((a) => a.id);
      onSendInternalNote(conversation.id, inputText.trim(), mentions);
    } else {
      onSendMessage(conversation.id, inputText.trim());
    }
    setInputText('');
    setAttachments([]);
  };

  const handleCopy = async (content: string, msgId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  // Empty state
  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8">
        <div className="text-center max-w-md animate-fade-in-up">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Globe className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">对话监控</h1>
          <p className="text-sm text-muted-foreground mb-6">
            选择左侧对话查看详情，支持实时查看 AI 对话过程、接管对话、转人工、转工单
          </p>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="/simulation"
              className="bg-card shadow-card rounded-lg p-4 hover:shadow-float hover:-translate-y-0.5 transition-all duration-200 text-center"
            >
              <Bot className="w-6 h-6 text-primary mx-auto mb-2" />
              <span className="text-sm font-medium text-foreground block">模拟测试</span>
              <span className="text-[11px] text-muted-foreground">手动测试AI回复</span>
            </a>
            <a
              href="/dashboard"
              className="bg-card shadow-card rounded-lg p-4 hover:shadow-float hover:-translate-y-0.5 transition-all duration-200 text-center"
            >
              <FileText className="w-6 h-6 text-primary mx-auto mb-2" />
              <span className="text-sm font-medium text-foreground block">数据看板</span>
              <span className="text-[11px] text-muted-foreground">全局态势感知</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const isEnded = conversation.status === 'ended';
  const isHandoff = conversation.status === 'handoff';
  const isActive = conversation.status === 'active';
  const convTitle = conversation.title;
  const convSource = conversation.source;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Conversation info bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 bg-card/50">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
            isEnded ? 'bg-muted text-muted-foreground'
              : isHandoff ? 'bg-amber-500/15 text-amber-600'
              : 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
          }`}>
            {convTitle.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{convTitle}</span>
              {convSource && (
                <span className={`text-[10px] font-medium ${
                  convSource === '千牛' ? 'text-blue-600' : convSource === '抖店' ? 'text-emerald-700' : 'text-gray-600'
                }`}>
                  {convSource}
                </span>
              )}
              {conversation.priority === 'urgent' && (
                <span className="inline-flex items-center px-1.5 py-0 rounded-sm text-[10px] font-medium bg-red-500/10 text-red-600">
                  <AlertTriangle className="w-3 h-3 mr-0.5" />紧急
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {isActive && (
                <span className="flex items-center gap-1 text-emerald-700">
                  <Bot className="w-3 h-3" />AI处理中
                </span>
              )}
              {isHandoff && (
                <span className="flex items-center gap-1 text-primary">
                  <User className="w-3 h-3" />已接管
                </span>
              )}
              {isEnded && (
                <span className="text-muted-foreground">已结束</span>
              )}
              <span>· {conversation.message_count}轮</span>
              {lastConfidence !== null && (
                <span className={isLowConfidence ? 'text-red-500 font-medium' : ''}>
                  · 置信度 {Math.round(lastConfidence * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {isActive && (
            <button
              onClick={handleTakeover}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Headphones className="w-3.5 h-3.5" />
              接管对话
            </button>
          )}
          {!isEnded && (
            <button
              onClick={() => onEnd(conversation.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              结束
            </button>
          )}
          {isEnded && (
            <button
              onClick={() => onReopen(conversation.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重新开启
            </button>
          )}
          <button
            onClick={() => onCreateTicket(conversation.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Ticket className="w-3.5 h-3.5" />
            转工单
          </button>
        </div>
      </div>

      {/* Low confidence warning */}
      {isLowConfidence && isActive && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/5 border-b border-red-500/10 shrink-0">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-xs text-red-600 font-medium">
            AI 置信度较低（{Math.round(lastConfidence! * 100)}%），建议立即接管对话
          </span>
          <button
            onClick={handleTakeover}
            className="ml-auto text-xs font-medium text-red-600 hover:text-red-700 underline"
          >
            立即接管
          </button>
        </div>
      )}

      {/* Summary bar for handoff conversations */}
      {isHandoff && conversation.summary && (
        <div className="px-4 py-2 bg-primary/5 border-b border-primary/10 shrink-0">
          <div className="flex items-start gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <div>
              <span className="text-[11px] font-medium text-primary">对话摘要</span>
              <p className="text-xs text-foreground/70 leading-relaxed mt-0.5">{conversation.summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Messages - read only view */}
      <div className="flex-1 overflow-y-auto py-4 min-h-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <MessageSkeletonList />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <Bot className="w-8 h-8 mb-2 text-muted-foreground/40" />
            暂无消息
          </div>
        ) : (
          <div className={`space-y-${themeSettings.compactMode ? '1' : '3'} max-w-3xl mx-auto`}>
            {messages.map((msg, idx) => {
              const prevMsg = idx > 0 ? messages[idx - 1] : undefined;
              const showTimeDivider = shouldShowTimeDivider(msg, prevMsg);
              const isUser = msg.role === 'user';
              const isInternalNote = msg.message_type === 'internal_note';
              const isAssistant = msg.role === 'assistant';
              const isAgent = msg.role === 'agent';

              return (
                <div key={msg.id}>
                  {showTimeDivider && themeSettings.showTimestamps && (
                    <div className="flex items-center justify-center my-4 animate-fade-in">
                      <span className="text-xs text-muted-foreground/60 bg-muted/50 px-3 py-1 rounded-full">
                        {formatMessageTime(msg.created_at)}
                      </span>
                    </div>
                  )}

                  {/* Internal note */}
                  {isInternalNote ? (
                    <div className="flex gap-2 pl-0 pr-3">
                      <div className="w-7 h-7 bg-amber-500/15 rounded-full flex items-center justify-center text-[11px] font-semibold text-amber-600 shrink-0 mt-0.5">
                        <StickyNote className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 text-left">
                          {(msg as { author_name?: string }).author_name && (
                            <span className="text-[10px] font-medium text-amber-600 mb-1 block">
                              @{(msg as { author_name?: string }).author_name}
                            </span>
                          )}
                          <div className="text-sm text-foreground leading-relaxed">{msg.content}</div>
                          {msg.mentions && msg.mentions.length > 0 && (
                            <div className="mt-1 flex items-center gap-1">
                              <AtSign className="w-3 h-3 text-amber-500" />
                              {msg.mentions.map((m, i) => (
                                <span key={i} className="text-[10px] text-amber-600">{m}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {themeSettings.showTimestamps && (
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            {formatMessageTime(msg.created_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Normal message */
                    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                      {!isUser && (
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5 ${
                          isAssistant ? 'bg-primary/15 text-primary' : isAgent ? 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                        }`}>
                          {isAssistant ? 'AI' : isAgent ? '坐' : 'S'}
                        </div>
                      )}
                      <div className={isUser ? 'text-right' : ''}>
                        <div className={`${isUser ? 'bg-blue-100 dark:bg-blue-900 text-foreground' : 'bg-card text-foreground'} rounded-lg px-3 py-2 text-left`}>
                          {/* Image */}
                          {msg.image_url && (
                            <div className="mb-2">
                              <img
                                src={msg.image_url}
                                alt="用户上传的图片"
                                className="max-w-[280px] max-h-[200px] rounded-md object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setPreviewImage(msg.image_url!)}
                              />
                            </div>
                          )}
                          {isUser ? (
                            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</div>
                          ) : (
                            <>
                              {msg.message_type && msg.message_type !== 'text' && msg.rich_content && (
                                <RichMessageCard type={msg.message_type} content={msg.rich_content} onAction={handleCardAction} />
                              )}
                              {msg.content && <MarkdownRenderer content={msg.content} />}
                              {msg.message_type === 'knowledge_images' && msg.rich_content?.images && msg.rich_content.images.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  {msg.rich_content.images.map((img, imgIdx) => (
                                    <div key={imgIdx} className="relative group">
                                      <img
                                        src={img.url}
                                        alt={img.alt || '知识库图片'}
                                        className="max-w-[280px] max-h-[200px] rounded-md object-cover cursor-pointer hover:opacity-90 transition-opacity border border-border/30"
                                        onClick={() => setPreviewImage(img.url)}
                                      />
                                      {img.alt && (
                                        <div className="text-[10px] text-muted-foreground mt-0.5">{img.alt}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          {/* Sources */}
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-border/30 space-y-1">
                              {msg.sources.map((s, i) => (
                                <div key={i} className="text-[10px]">
                                  <span className="inline-flex items-center gap-1 text-primary mr-1">
                                    <BookOpen className="w-2.5 h-2.5" />
                                    {s.type === 'knowledge' ? '知识库' : s.type === 'auto_reply' ? '自动回复' : '引用'}
                                  </span>
                                  {s.score !== undefined && s.score > 0 && (
                                    <span className={`ml-1 ${s.score >= 0.75 ? 'text-emerald-600' : s.score >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>
                                      {Math.round(s.score * 100)}%
                                    </span>
                                  )}
                                  {s.name && (
                                    <span className="ml-1 text-muted-foreground">· {s.name}</span>
                                  )}
                                  {s.category && (
                                    <span className="ml-1 px-1 rounded bg-primary/8 text-primary">{s.category}</span>
                                  )}
                                  {s.content && s.type === 'knowledge' && (
                                    <div className="mt-0.5 text-muted-foreground line-clamp-2 leading-relaxed">{s.content}</div>
                                  )}
                                  {s.keyword && (
                                    <span className="ml-1 text-amber-600">关键词：{s.keyword}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Sub-Agent delegation */}
                          {msg.delegations && msg.delegations.length > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-border/30">
                              {msg.delegations.map((d, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-[10px] text-blue-600">
                                  <Network className="w-3 h-3" />
                                  <span>由 {d.child_bot_name} 处理</span>
                                  {d.intent && <span className="text-blue-500">· {d.intent}</span>}
                                  {d.confidence > 0 && <span className="text-blue-500">· {Math.round(d.confidence * 100)}%</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Confidence badge with breakdown */}
                          {isAssistant && msg.confidence !== null && msg.confidence !== undefined && (
                            <div className="mt-1.5">
                              <div
                                className={`inline-flex items-center gap-1 text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${
                                  msg.confidence < 0.4 ? 'text-red-600' : msg.confidence < 0.7 ? 'text-amber-600' : 'text-emerald-600'
                                }`}
                                title="点击查看置信度详情"
                                onClick={() => setExpandedConfMsgId(expandedConfMsgId === msg.id ? null : msg.id)}
                              >
                                <span>置信度 {Math.round(msg.confidence * 100)}%</span>
                                {msg.confidence_breakdown && (
                                  <svg className={`w-3 h-3 transition-transform ${expandedConfMsgId === msg.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                )}
                              </div>
                              {expandedConfMsgId === msg.id && msg.confidence_breakdown && (() => {
                                const bd = msg.confidence_breakdown;
                                return (
                                  <div className="mt-1 p-2 bg-muted/50 rounded text-[10px] space-y-0.5 text-muted-foreground">
                                    <div className="flex justify-between"><span>知识库匹配</span><span>{bd.knowledge_score > 0 ? `${Math.round(bd.knowledge_score * 100)}%` : '-'}</span></div>
                                    <div className="flex justify-between"><span>工具调用</span><span>{bd.tool_score > 0 ? `${Math.round(bd.tool_score * 100)}%` : '-'}</span></div>
                                    <div className="flex justify-between"><span>LLM自评</span><span>{bd.llm_self_score > 0 ? `${Math.round(bd.llm_self_score * 100)}%` : '-'}</span></div>
                                    <div className="flex justify-between"><span>子Agent</span><span>{bd.sub_agent_score > 0 ? `${Math.round(bd.sub_agent_score * 100)}%` : '-'}</span></div>
                                    {bd.handoff_intent && (
                                      <div className="text-red-500 flex items-center gap-1">
                                        <span>⚠️</span>
                                        <span>检测到转人工意图，已降低置信度</span>
                                      </div>
                                    )}
                                    {bd.no_support && <div className="text-amber-500">⚠️ 无知识库/工具支撑，综合评分降低</div>}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                        <div className={`flex items-center gap-1.5 mt-0.5 ${isUser ? 'justify-end' : ''}`}>
                          {!isUser && (
                            <button
                              onClick={() => handleCopy(msg.content, msg.id)}
                              className="text-muted-foreground/50 hover:text-foreground transition-colors"
                              title="复制"
                            >
                              {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          )}
                          {themeSettings.showTimestamps && (
                            <span className="text-[10px] text-muted-foreground">{formatMessageTime(msg.created_at)}</span>
                          )}
                        </div>
                      </div>
                      {isUser && (
                        <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-[11px] font-medium text-primary-foreground shrink-0 mt-0.5">
                          {convTitle.charAt(0)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area - only visible after takeover */}
      {isHandoff && !isEnded ? (
        <div className={`border-t border-border ${noteMode ? 'bg-amber-50/50 dark:bg-amber-950/10' : 'bg-card/50'} shrink-0`}>
          {/* Mode indicator */}
          {noteMode && (
            <div className="px-4 pt-3 pb-2 flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center">
                <StickyNote className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">内部备注模式</span>
              <span className="text-[10px] text-amber-600/70 dark:text-amber-500/70">— 仅团队可见</span>
              <button
                className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                onClick={() => setNoteMode(false)}
              >
                退出
              </button>
            </div>
          )}
          {/* Input row */}
          <div className={`px-4 ${noteMode ? 'pb-3' : 'h-14 flex items-center'} flex items-center gap-2`}>
            <Button
              variant="ghost"
              size="icon"
              className={`shrink-0 transition-colors ${noteMode ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/20' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setNoteMode(!noteMode)}
              title={noteMode ? '退出备注模式' : '添加内部备注'}
            >
              <StickyNote className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setQuickReplyOpen(true)}
              title="话术库"
            >
              <BookOpen className="w-4 h-4" />
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || noteMode}
              title={noteMode ? '备注模式不支持附件' : '添加附件'}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </Button>
            <div className="flex-1 relative">
              <Input
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  const match = e.target.value.match(/@([^\s@]*)$/);
                  if (match) {
                    setMentionInput(match[1]);
                    setShowMentionList(true);
                  } else {
                    setShowMentionList(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={noteMode ? '输入内部备注，@提及同事' : '输入消息...'}
                className={`pr-20 ${noteMode ? 'border-amber-300 dark:border-amber-700 focus:ring-amber-200 dark:focus:ring-amber-800 bg-white dark:bg-amber-950/20' : ''}`}
              />
              {/* Mention dropdown */}
              {showMentionList && agents.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-2 w-full bg-popover rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  <div className="px-2 py-1.5 border-b border-border">
                    <span className="text-[10px] text-muted-foreground">提及同事</span>
                  </div>
                  {agents
                    .filter(a => !mentionInput || a.name.includes(mentionInput))
                    .map(agent => (
                      <button
                        key={agent.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 transition-colors"
                        onClick={() => {
                          const newInput = inputText.replace(/@[^\s@]*$/, `@${agent.name} `);
                          setInputText(newInput);
                          setShowMentionList(false);
                        }}
                      >
                        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-medium">
                          {agent.name[0]}
                        </div>
                        <span>{agent.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!inputText.trim() && attachments.length === 0}
              className={`shrink-0 transition-all ${noteMode ? 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700' : 'bg-primary hover:bg-primary/90'}`}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          {/* Attachment preview */}
          {attachments.length > 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-2">
              {attachments.map(att => (
                <div
                  key={att.id}
                  className="relative group flex items-center gap-2 px-2 py-1 rounded-lg bg-muted border border-border"
                >
                  {att.type.startsWith('image/') ? (
                    <>
                      <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground truncate max-w-[80px]">{att.name}</span>
                    </>
                  ) : (
                    <>
                      <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground truncate max-w-[80px]">{att.name}</span>
                    </>
                  )}
                  <button
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !isEnded && isActive ? (
        /* Not taken over - show takeover prompt */
        <div className="border-t border-border px-4 py-3 bg-card/50 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              当前为只读模式，接管后可发送消息
            </span>
            <button
              onClick={handleTakeover}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Headphones className="w-3.5 h-3.5" />
              接管对话
            </button>
          </div>
        </div>
      ) : isEnded ? (
        <div className="border-t border-border px-4 py-3 bg-card/50 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">对话已结束</span>
            <button
              onClick={() => onReopen(conversation.id)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重新开启
            </button>
          </div>
        </div>
      ) : null}

      {/* Image preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-3xl max-h-[80vh]">
            <img
              src={previewImage}
              alt="预览图片"
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-card rounded-full flex items-center justify-center shadow-lg border border-border hover:bg-muted transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Quick Reply Dialog */}
      <Dialog open={quickReplyOpen} onOpenChange={setQuickReplyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>话术库</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {quickReplies.map((reply, idx) => (
              <button
                key={idx}
                className="w-full text-left p-3 rounded-lg hover:bg-muted/50 transition-colors"
                onClick={() => {
                  setInputText(reply.content);
                  setQuickReplyOpen(false);
                }}
              >
                <p className="text-sm font-medium">{reply.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{reply.content}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
