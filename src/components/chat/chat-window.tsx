'use client';

import Image from 'next/image';
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Bot, Star, Send, Sparkles, Copy, Check, PhoneOff, Download, RotateCcw, Zap, ArrowRightLeft, User, BookOpen, Headphones, X, ChevronRight, Clock, Tag, MessageSquare, Globe, AlertTriangle, FileText, Paperclip, ImageIcon, Loader2, Ticket, Cpu, Network, Users } from 'lucide-react';
import type { Conversation, Message } from './chat-page';
import type { CardAction } from '@/lib/types';
import { RatingCard } from './rating-card';
import { MarkdownRenderer } from './markdown-renderer';
import { RichMessageCard } from './rich-message-card';
import { SourcePanel } from './source-panel';
import { formatMessageTime, shouldShowTimeDivider } from '@/lib/chat-utils';

interface ChatWindowProps {
  conversation: Conversation | undefined;
  messages: Message[];
  streamingContent: string;
  streamingSources: Message['sources'];
  streamingConfidence: number | null;
  streamingConfidenceBreakdown: import('@/lib/types').ConfidenceBreakdown | null;
  isLoading: boolean;
  isSending: boolean;
  activeDelegations: Array<{
    child_bot_name: string;
    child_bot_id: string;
    intent: string | null;
    confidence: number;
    collaborations: number;
  }>;
  allConversations: Conversation[];
  /** Scope for quick replies filtering: 'ai' for AI chatbot, 'agent' for agent workspace, undefined for all */
  quickRepliesScope?: 'ai' | 'agent';
  onSend: (content: string, imageUrl?: string) => void;
  onSubmitRating: (rating: number, comment: string) => void;
  onEndConversation: (id: string) => void;
  onRestartConversation: () => void;
  onHandoff: (id: string, reason?: string) => void;
}

/** Transfer target options — defaults, overridden by API data */
const DEFAULT_TRANSFER_DEPARTMENTS = [
  { id: 'sales', name: '售前咨询组', icon: '💼' },
  { id: 'aftersales', name: '售后服务组', icon: '🔧' },
  { id: 'complaint', name: '投诉处理组', icon: '📢' },
  { id: 'vip', name: 'VIP 专属服务', icon: '⭐' },
  { id: 'tech', name: '技术支持组', icon: '🛠️' },
];

const DEFAULT_TRANSFER_AGENTS = [
  { id: 'agent-1', name: '张晓明', dept: '售后服务组', online: true },
  { id: 'agent-2', name: '李婷', dept: '售前咨询组', online: true },
  { id: 'agent-3', name: '王伟', dept: '投诉处理组', online: false },
  { id: 'agent-4', name: '赵敏', dept: 'VIP 专属服务', online: true },
];

const DEFAULT_QUICK_REPLIES = [
  '您好，请问有什么可以帮您的？',
  '好的，我马上为您处理。',
  '请稍等，正在为您查询中...',
  '感谢您的耐心等待！',
  '还有其他问题吗？',
  '祝您生活愉快，再见！',
];

// Sub-component: Conversation Tickets Banner
function ConversationTicketsBanner({ conversationId }: { conversationId?: string }) {
  const [tickets, setTickets] = useState<Array<{ id: string; ticket_number: string; title: string; status: string; status_label: string }>>([]);

  useEffect(() => {
    if (!conversationId) return;
    fetch(`/api/tickets/customer?conversation_id=${conversationId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tickets) setTickets(data.tickets);
      })
      .catch(() => {});
  }, [conversationId]);

  if (tickets.length === 0) return null;

  const activeTickets = tickets.filter(t => t.status !== 'closed' && t.status !== 'resolved');

  return (
    <div className="px-4 py-2 border-b border-border bg-muted/30">
      {activeTickets.map(t => (
        <div key={t.id} className="flex items-center gap-2 text-xs py-0.5">
          <Ticket className="w-3 h-3 text-primary shrink-0" />
          <span className="font-mono text-primary">{t.ticket_number}</span>
          <span className="text-muted-foreground truncate">{t.title}</span>
          <span className={`ml-auto px-1.5 py-0.5 rounded-sm text-[10px] font-medium ${
            t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
            t.status === 'pending_customer' ? 'bg-amber-100 text-amber-700' :
            t.status === 'open' ? 'bg-gray-100 text-gray-700' :
            'bg-muted text-muted-foreground'
          }`}>
            {t.status_label}
          </span>
        </div>
      ))}
      {activeTickets.length < tickets.length && (
        <div className="text-[10px] text-muted-foreground mt-0.5">
          另有 {tickets.length - activeTickets.length} 个已关闭/已解决工单
        </div>
      )}
    </div>
  );
}

export function ChatWindow({
  conversation,
  messages,
  streamingContent,
  streamingSources,
  streamingConfidence,
  streamingConfidenceBreakdown,
  isLoading,
  isSending,
  allConversations,
  activeDelegations = [],
  quickRepliesScope,
  onSend,
  onSubmitRating,
  onEndConversation,
  onRestartConversation,
  onHandoff,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [showRating, setShowRating] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedConfMsgId, setExpandedConfMsgId] = useState<string | null>(null);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  const [selectedMsgIdForSource, setSelectedMsgIdForSource] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ type: 'dept' | 'agent'; id: string; name: string } | null>(null);
  const [transferNote, setTransferNote] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ url: string; file: File } | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  // Dynamic data loaded from API (fallback to defaults)
  const [transferDepartments, setTransferDepartments] = useState(DEFAULT_TRANSFER_DEPARTMENTS);
  const [transferAgents, setTransferAgents] = useState(DEFAULT_TRANSFER_AGENTS);
  const [quickReplies, setQuickReplies] = useState(DEFAULT_QUICK_REPLIES);

  // Load dynamic configuration from APIs on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        // Load quick replies from API (filtered by scope if provided)
        const scopeParam = quickRepliesScope ? `?scope=${quickRepliesScope}` : '';
        const qrRes = await fetch(`/api/quick-replies${scopeParam}`);
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          if (qrData.replies?.length) {
            setQuickReplies(qrData.replies.map((r: { content: string }) => r.content));
          }
        }
      } catch { /* keep defaults */ }

      try {
        // Load skill groups as transfer departments
        const sgRes = await fetch('/api/skill-groups');
        if (sgRes.ok) {
          const sgData = await sgRes.json();
          if (sgData.groups?.length) {
            setTransferDepartments(sgData.groups.map((g: { id: string; name: string }) => ({
              id: g.id,
              name: g.name,
              icon: '👥',
            })));
          }
        }
      } catch { /* keep defaults */ }

      try {
        // Load online agents as transfer targets
        const uRes = await fetch('/api/users?role=agent&status=active');
        if (uRes.ok) {
          const uData = await uRes.json();
          if (uData.users?.length) {
            setTransferAgents(uData.users.map((u: { id: string; name: string; email?: string }) => ({
              id: u.id,
              name: u.name,
              dept: '',
              online: true,
            })));
          }
        }
      } catch { /* keep defaults */ }
    }
    loadConfig();
  }, [quickRepliesScope]);

  // Handle card action button clicks (refund confirmation, etc.)
  const handleCardAction = useCallback(async (action: CardAction) => {
    if (isProcessingAction) return;
    setIsProcessingAction(true);

    try {
      switch (action.type) {
        case 'confirm_refund': {
          // Confirm refund action - send message to user
          const orderId = action.data?.order_id || '';
          const amount = action.data?.amount || 0;
          const refundId = action.data?.refund_id || '';

          if (!orderId) {
            toast.error('缺少订单信息');
            break;
          }

          // Send confirmation message
          onSend(`您好，您的退款申请（单号：${refundId}，金额：¥${Number(amount).toFixed(2)}）已确认提交。我们将在1-3个工作日内处理，感谢您的耐心等待。`);
          toast.success('退款申请已确认提交');
          break;
        }

        case 'cancel_refund': {
          // Cancel refund action
          onSend('好的，已取消退款申请。请问还有其他问题需要帮助吗？');
          toast.info('已取消退款申请');
          break;
        }

        case 'apply_refund': {
          // Trigger refund flow - send message to trigger LLM refund tool
          const orderId = action.data?.order_id || '';
          onSend(`请帮我申请退款，订单号：${orderId}，原因是商品不满意。`);
          break;
        }

        case 'view_order_detail': {
          // Copy order ID for user
          const orderId = String(action.data?.order_id || '');
          if (orderId) {
            await navigator.clipboard.writeText(orderId);
            toast.success('订单号已复制');
          }
          break;
        }

        case 'view_logistics': {
          // Trigger logistics query - send message to trigger LLM logistics tool
          const orderId = String(action.data?.order_id || '');
          const trackingNo = String(action.data?.tracking_number || '');
          onSend(`请帮我查询物流信息${orderId ? `，订单号：${orderId}` : trackingNo ? `，运单号：${trackingNo}` : ''}。`);
          break;
        }

        case 'contact_support': {
          // Trigger human handoff
          if (conversation?.id) {
            onHandoff(conversation.id, '用户请求人工客服');
          }
          break;
        }

        default:
          toast.error(`暂不支持该操作：${action.type}`);
      }
    } catch (err) {
      console.error('Card action error:', err);
      toast.error('操作失败，请重试');
    } finally {
      setIsProcessingAction(false);
    }
  }, [isProcessingAction, conversation?.id, onSend, onHandoff]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quickReplyRef = useRef<HTMLDivElement>(null);
  const transferRef = useRef<HTMLDivElement>(null);

  // Auto-scroll (only scroll the messages container, not the page)
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Show rating check
  useEffect(() => {
    if (conversation?.status === 'ended' && !conversation?.rating) {
      setShowRating(true);
      setRatingSubmitted(false);
    } else {
      setShowRating(false);
    }
  }, [conversation]);

  // Auto-show source panel when streaming completes with sources
  const prevStreamingSourcesLenRef = useRef<number>(0);
  useEffect(() => {
    const currentLen = streamingSources?.length ?? 0;
    // Only trigger when streamingSources transitions from 0/null to having items AND we just finished sending
    if (currentLen > 0 && prevStreamingSourcesLenRef.current === 0 && !isSending) {
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMsg) {
        setSelectedMsgIdForSource(lastAssistantMsg.id);
        setShowSourcePanel(true);
        setShowCustomerPanel(false);
      }
    }
    prevStreamingSourcesLenRef.current = currentLen;
  }, [streamingSources, isSending, messages]);

  // Close quick replies on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (quickReplyRef.current && !quickReplyRef.current.contains(e.target as Node)) {
        setShowQuickReplies(false);
      }
    };
    if (showQuickReplies) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showQuickReplies]);

  const handleSend = () => {
    const trimmed = input.trim();
    if ((!trimmed && !pendingImage) || isSending) return;
    if (conversation?.status === 'ended' || conversation?.status === 'handoff') return;
    const imageUrl = pendingImage?.url;
    onSend(trimmed || (imageUrl ? '请查看这张图片' : ''), imageUrl);
    setInput('');
    setPendingImage(null);
    setShowQuickReplies(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validate file type
    if (!file.type.startsWith('image/')) return;
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) return;

    // Create local preview URL
    const localUrl = URL.createObjectURL(file);
    setPendingImage({ url: localUrl, file });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemovePendingImage = () => {
    if (pendingImage?.url) {
      URL.revokeObjectURL(pendingImage.url);
    }
    setPendingImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 150) + 'px';
  };

  const handleCopy = async (content: string, msgId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleRatingSubmit = (rating: number, comment: string) => {
    onSubmitRating(rating, comment);
    setRatingSubmitted(true);
    setShowRating(false);
  };

  const handleQuickReply = (text: string) => {
    setInput(text);
    setShowQuickReplies(false);
    textareaRef.current?.focus();
  };

  const handleTransfer = useCallback(async () => {
    if (!conversation || !transferTarget) return;
    setIsTransferring(true);
    try {
      const reason = transferTarget.type === 'dept'
        ? `转接至${transferTarget.name}`
        : `转接至坐席 ${transferTarget.name}`;
      const res = await fetch(`/api/conversations/${conversation.id}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: transferNote ? `${reason}：${transferNote}` : reason,
          transfer_target: transferTarget,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowTransferDialog(false);
      setTransferTarget(null);
      setTransferNote('');
      onHandoff(conversation.id, transferNote ? `${reason}：${transferNote}` : reason);
    } catch (err) {
      console.error('转接失败:', err);
      toast.error('转接人工客服失败，请重试');
    } finally {
      setIsTransferring(false);
    }
  }, [conversation, transferTarget, transferNote, onHandoff]);

  // Create ticket from conversation
  const handleCreateTicket = useCallback(async () => {
    if (!conversation) return;
    setIsCreatingTicket(true);
    try {
      const res = await fetch('/api/tickets/from-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation.id,
          title: conversation.title,
          category: 'other',
          priority: conversation.priority === 'urgent' ? 'high' : 'medium',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`工单 ${data.ticket?.ticket_number || ''} 已创建`);
      } else if (res.status === 409) {
        toast.warning('该对话已有未关闭工单');
      } else {
        toast.error(data.error || '创建工单失败');
      }
    } catch {
      toast.error('创建工单失败');
    } finally {
      setIsCreatingTicket(false);
    }
  }, [conversation]);

  // Close transfer dialog on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (transferRef.current && !transferRef.current.contains(e.target as Node)) {
        setShowTransferDialog(false);
      }
    };
    if (showTransferDialog) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showTransferDialog]);

  // Other conversations for the same customer (same source/external_user_id)
  const otherConversations = allConversations.filter(
    (c) => c.id !== conversation?.id && c.source === conversation?.source,
  );

  const isEnded = conversation?.status === 'ended';
  const isHandoff = conversation?.status === 'handoff';
  const convTitle = conversation?.title || '对话';
  const convSource = conversation?.source;
  const isUrgent = conversation?.priority === 'urgent';

  return (
    <div className="flex h-full w-full min-h-0 flex-1">
      {/* Main chat area */}
      <div className={`flex flex-col h-full flex-1 min-w-0 min-h-0 transition-all ${showCustomerPanel ? '' : ''}`}>
        {/* Header - matching prototype */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20 shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
              isUrgent ? 'bg-error/15 text-error' : convSource === '千牛' ? 'bg-primary/10 text-primary' : convSource === '抖店' ? 'bg-emerald-100 text-emerald-700' : 'bg-success/15 text-success'
            }`}>
              {convTitle.charAt(0)}
            </div>
            <span className="text-base font-medium text-foreground">{convTitle}</span>
          {/* Source tag */}
          {convSource && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${
              convSource === '千牛' ? 'bg-primary/10 text-primary' : convSource === '抖店' ? 'bg-emerald-100 text-emerald-700' : 'bg-success/10 text-success'
            }`}>
              {convSource}
            </span>
          )}
          {/* Customer info (auto-linked by externalUserId) */}
          {conversation?.customer && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-medium bg-muted text-muted-foreground">
              <Users className="w-3 h-3" />
              {conversation.customer.is_anonymous ? '匿名访客' : conversation.customer.name}
              {!conversation.customer.is_anonymous && conversation.customer.conversation_count > 1 && (
                <span className="text-muted-foreground/70">·历史{conversation.customer.conversation_count}次</span>
              )}
            </span>
          )}
          {/* Urgent tag */}
          {isUrgent && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-error/10 text-error">
              紧急
            </span>
          )}
          {/* Status */}
          {!isEnded && !isHandoff ? (
            <span className="flex items-center gap-1 text-sm text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              在线
            </span>
          ) : isHandoff ? (
            <span className="flex items-center gap-1 text-sm text-amber-500">
              <Headphones className="w-3.5 h-3.5" />
              转人工中
            </span>
          ) : (
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              已结束
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEnded && !isHandoff && conversation && (
            <button
              onClick={() => onHandoff(conversation.id)}
              className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 px-2.5 py-1 rounded hover:bg-amber-500/10 transition-colors"
              title="转人工客服"
            >
              <Headphones className="w-4 h-4" />
              转人工
            </button>
          )}
          <div className="relative" ref={transferRef}>
            <button
              onClick={() => { setShowTransferDialog(!showTransferDialog); setShowCustomerPanel(false); }}
              disabled={!conversation || isEnded}
              className="text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="转接"
            >
              <ArrowRightLeft className="w-4 h-4 inline-block" />
            </button>
            {showTransferDialog && conversation && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card shadow-float rounded-lg border border-border z-50 popup-enter">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">转接对话</span>
                  <button onClick={() => setShowTransferDialog(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Department selection */}
                <div className="px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-1.5">选择部门</div>
                  <div className="space-y-1">
                    {transferDepartments.map((dept) => (
                      <button
                        key={dept.id}
                        onClick={() => setTransferTarget({ type: 'dept', id: dept.id, name: dept.name })}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors ${
                          transferTarget?.type === 'dept' && transferTarget?.id === dept.id
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted'
                        }`}
                      >
                        <span>{dept.icon}</span>
                        <span>{dept.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Agent selection */}
                <div className="px-3 py-2 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-1.5">指定坐席</div>
                  <div className="space-y-1">
                    {transferAgents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => setTransferTarget({ type: 'agent', id: agent.id, name: agent.name })}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors ${
                          transferTarget?.type === 'agent' && transferTarget?.id === agent.id
                            ? 'bg-primary/10 text-primary'
                            : agent.online ? 'text-foreground hover:bg-muted' : 'text-muted-foreground cursor-not-allowed'
                        }`}
                        disabled={!agent.online}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${agent.online ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                        <span>{agent.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{agent.dept}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Note & confirm */}
                <div className="px-3 py-2 border-t border-border">
                  <textarea
                    value={transferNote}
                    onChange={(e) => setTransferNote(e.target.value)}
                    placeholder="备注信息（可选）"
                    rows={2}
                    className="w-full bg-surface-container border-none rounded-md px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none mb-2"
                  />
                  <button
                    onClick={handleTransfer}
                    disabled={!transferTarget || isTransferring}
                    className="w-full bg-primary text-primary-foreground text-sm font-medium py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isTransferring ? '转接中...' : '确认转接'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => { setShowCustomerPanel(!showCustomerPanel); setShowSourcePanel(false); setShowTransferDialog(false); }}
            disabled={!conversation}
            className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              showCustomerPanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-surface-container'
            }`}
            title="客户信息"
          >
            <User className="w-3.5 h-3.5 inline-block" />
          </button>
          <button
            onClick={() => {
              if (showSourcePanel) {
                setShowSourcePanel(false);
              } else {
                // Select the latest assistant message with sources
                const lastAssistantWithSources = [...messages].reverse().find(m => m.role === 'assistant' && m.sources && m.sources.length > 0);
                if (lastAssistantWithSources) {
                  setSelectedMsgIdForSource(lastAssistantWithSources.id);
                }
                setShowSourcePanel(true);
                setShowCustomerPanel(false);
                setShowTransferDialog(false);
              }
            }}
            disabled={!conversation}
            className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              showSourcePanel ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-surface-container'
            }`}
            title="引用溯源"
          >
            <BookOpen className="w-3.5 h-3.5 inline-block" />
          </button>
          {conversation && messages.length > 0 && (
            <button
              onClick={() => {
                if (!conversation || messages.length === 0) return;
                const lines = messages.map((m) => {
                  const time = formatMessageTime(m.created_at);
                  const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '系统';
                  return `[${time}] ${role}: ${m.content}`;
                });
                const content = `对话: ${conversation.title}\n时间: ${new Date(conversation.created_at).toLocaleString('zh-CN')}\n${'─'.repeat(40)}\n\n${lines.join('\n\n')}`;
                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const safeFileName = (conversation?.id || 'unknown')
                  .replace(/[^a-zA-Z0-9-_]/g, '_')
                  .slice(0, 8);
                a.download = `conversation-${safeFileName}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-surface-container transition-colors"
              title="导出对话"
            >
              <Download className="w-3.5 h-3.5 inline-block" />
            </button>
          )}
        </div>
      </div>

      {/* Ticket Status Banner */}
      <ConversationTicketsBanner conversationId={conversation?.id} />

      {/* Messages */}
      <div ref={messagesScrollRef} className="flex-1 overflow-y-auto py-4 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            加载中...
          </div>
        ) : messages.length === 0 && !streamingContent ? (
          /* Welcome for new conversation */
          <div className="flex flex-col items-center justify-center h-full animate-fade-in-up">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              您好！我是 SmartAssist 智能客服
            </h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
              很高兴为您服务，请问有什么可以帮您的？您可以直接输入问题，或点击下方常见问题快速开始。
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-md w-full">
              {['退换货政策是什么？', '如何查询物流？', '支持哪些支付方式？', '如何联系人工客服？'].map((q, i) => (
                <button
                  key={q}
                  onClick={() => onSend(q)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-muted hover:border-primary/30 transition-all duration-200 text-left animate-stagger stagger-${i + 1}`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message list */
          <div className="space-y-3 max-w-3xl mx-auto">
            {messages.map((msg, idx) => {
              const prevMsg = idx > 0 ? messages[idx - 1] : undefined;
              const showTimeDivider = shouldShowTimeDivider(msg, prevMsg);
              const isUser = msg.role === 'user';

              return (
                <div key={msg.id}>
                  {/* Time divider */}
                  {showTimeDivider && (
                    <div className="flex items-center justify-center my-4 animate-fade-in">
                      <span className="text-xs text-muted-foreground/60 bg-muted/50 px-3 py-1 rounded-full">
                        {formatMessageTime(msg.created_at)}
                      </span>
                    </div>
                  )}

                  {/* Message bubble - prototype style */}
                  <div className={`flex gap-2 ${isUser ? 'justify-end pl-0' : 'pl-0'} ${isUser ? 'msg-enter-user' : 'msg-enter-assistant'}`}>
                    {/* Avatar - AI on left, User on right */}
                    {!isUser ? (
                      <div className="w-7 h-7 bg-primary/15 rounded-full flex items-center justify-center text-[11px] font-semibold text-primary shrink-0 mt-0.5">AI</div>
                    ) : null}
                    <div className={isUser ? 'text-right' : ''}>
                      <div
                        className={`${isUser ? 'bg-blue-100 text-foreground' : `bg-card text-foreground cursor-pointer transition-colors ${selectedMsgIdForSource === msg.id ? 'ring-1 ring-primary/30' : 'hover:bg-muted/30'}`} rounded-lg px-3 py-2 text-left`}
                        onClick={() => {
                          if (!isUser && msg.sources && msg.sources.length > 0) {
                            setSelectedMsgIdForSource(selectedMsgIdForSource === msg.id ? null : msg.id);
                            if (selectedMsgIdForSource !== msg.id) {
                              setShowSourcePanel(true);
                              setShowCustomerPanel(false);
                            }
                          }
                        }}
                      >
                        {/* Image display */}
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
                            {msg.message_type && msg.message_type !== 'text' && msg.rich_content ? (
                              <RichMessageCard type={msg.message_type} content={msg.rich_content} onAction={handleCardAction} />
                            ) : null}
                            {msg.content && <MarkdownRenderer content={msg.content} />}
                            {/* Knowledge images from AI reply */}
                            {msg.message_type === 'knowledge_images' && msg.rich_content?.images && msg.rich_content.images.length > 0 && (
                              <div className="mt-2 space-y-2">
                                {msg.rich_content.images.map((img, idx) => (
                                  <div key={idx} className="relative group">
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
                        {/* Sources hint - clickable to open source panel */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-border/30">
                            {msg.sources.map((s, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 text-[10px] text-primary mr-1 cursor-pointer hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedMsgIdForSource(msg.id);
                                  setShowSourcePanel(true);
                                  setShowCustomerPanel(false);
                                }}
                              >
                                <BookOpen className="w-2.5 h-2.5" />
                                {s.type === 'knowledge' ? '知识库' : s.type === 'auto_reply' ? '自动回复' : '引用'}
                                {s.score !== undefined && s.score > 0 && (
                                  <span className={`ml-0.5 ${s.score >= 0.75 ? 'text-emerald-500' : s.score >= 0.5 ? 'text-amber-500' : 'text-red-500'}`}>
                                    {Math.round(s.score * 100)}%
                                  </span>
                                )}
                                {s.name && <span className="text-muted-foreground ml-0.5">· {s.name}</span>}
                              </span>
                            ))}
                            <span className="text-[10px] text-muted-foreground ml-1">点击查看详情</span>
                          </div>
                        )}
                        {/* Sub-Agent delegation info */}
                        {msg.delegations && msg.delegations.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-border/30">
                            {msg.delegations.map((d, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400">
                                <Network className="w-3 h-3" />
                                <span>由 {d.child_bot_name} 处理</span>
                                {d.intent && (
                                  <span className="text-blue-400 dark:text-blue-500">· {d.intent}</span>
                                )}
                                {d.confidence > 0 && (
                                  <span className="text-blue-400 dark:text-blue-500">· 置信度 {Math.round(d.confidence * 100)}%</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Confidence badge with breakdown */}
                        {!isUser && msg.confidence !== null && msg.confidence !== undefined && (
                          <div className="mt-1">
                            <div
                              className={`inline-flex items-center gap-1 text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${
                                msg.confidence < 0.4 ? 'text-red-500' : msg.confidence < 0.7 ? 'text-amber-500' : 'text-emerald-500'
                              }`}
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
                                  <div className="flex justify-between gap-4"><span>知识库匹配</span><span>{bd.knowledge_score > 0 ? `${Math.round(bd.knowledge_score * 100)}%` : '-'}</span></div>
                                  <div className="flex justify-between gap-4"><span>工具调用</span><span>{bd.tool_score > 0 ? `${Math.round(bd.tool_score * 100)}%` : '-'}</span></div>
                                  <div className="flex justify-between gap-4"><span>LLM自评</span><span>{bd.llm_self_score > 0 ? `${Math.round(bd.llm_self_score * 100)}%` : '-'}</span></div>
                                  <div className="flex justify-between gap-4"><span>子Agent</span><span>{bd.sub_agent_score > 0 ? `${Math.round(bd.sub_agent_score * 100)}%` : '-'}</span></div>
                                  {bd.handoff_intent && <div className="text-red-500">检测到转人工意图</div>}
                                  {bd.no_support && <div className="text-amber-500">无知识库/工具支撑</div>}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                      {/* Time + actions */}
                      <div className={`flex items-center gap-1.5 mt-0.5 ${isUser ? 'justify-end' : ''}`}>
                        {!isUser && (
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="text-muted-foreground/50 hover:text-foreground transition-colors"
                            title="复制"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3 h-3 text-success" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                        <span className="text-[10px] text-muted-foreground">{formatMessageTime(msg.created_at)}</span>
                      </div>
                    </div>
                    {/* User avatar on the right side of bubble */}
                    {isUser && (
                      <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-[11px] font-medium text-primary-foreground shrink-0 mt-0.5">
                        {convTitle.charAt(0)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Streaming output */}
            {streamingContent && (
              <div className="flex gap-2 pl-0 pr-3 msg-enter-assistant">
                <div className="w-7 h-7 bg-primary/15 rounded-full flex items-center justify-center text-[11px] font-semibold text-primary shrink-0 mt-0.5">AI</div>
                <div>
                  <div className="bg-blue-100 rounded-lg px-3 py-2 text-foreground">
                    <div className="text-sm leading-relaxed">
                      <MarkdownRenderer content={streamingContent} />
                      <span className="inline-block w-1.5 h-4 bg-primary/50 animate-pulse ml-0.5 align-middle" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Typing indicator */}
            {isSending && !streamingContent && (
              <div className="flex gap-2 pl-0 pr-3 items-center">
                <div className="w-7 h-7 bg-primary/15 rounded-full flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">AI</div>
                <div className="bg-blue-100 rounded-lg px-3 py-2 flex items-center justify-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Agent delegation status */}
            {activeDelegations.length > 0 && isSending && (
              <div className="pl-0 pr-3">
                {activeDelegations.map((delegation, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-blue-100 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                    <Network className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                    <span className="font-medium">{delegation.child_bot_name}</span>
                    <span className="text-blue-400 dark:text-blue-500">处理中</span>
                    {delegation.intent && (
                      <span className="text-blue-500 dark:text-blue-400 truncate max-w-[120px]">· {delegation.intent}</span>
                    )}
                    {delegation.collaborations > 0 && (
                      <span className="text-blue-400 dark:text-blue-500">· 协作{delegation.collaborations}次</span>
                    )}
                    <Loader2 className="w-3 h-3 shrink-0 animate-spin ml-auto" />
                  </div>
                ))}
              </div>
            )}

            {/* Satisfaction rating */}
            {showRating && !ratingSubmitted && (
              <RatingCard onSubmit={handleRatingSubmit} />
            )}
            {ratingSubmitted && (
              <div className="flex items-center gap-2 justify-center py-3 text-sm text-success">
                <Check className="w-4 h-4" />
                感谢您的评价！
              </div>
            )}

            {/* Handoff notice with summary */}
            {isHandoff && (
              <div className="py-3 space-y-2">
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 px-3 py-2 rounded-lg">
                    <Headphones className="w-3.5 h-3.5" />
                    正在连接人工客服，请稍候...
                  </div>
                </div>
                {conversation?.summary && (
                  <div className="mx-auto max-w-md bg-primary/5 border border-primary/15 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-medium text-primary">对话摘要</span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{conversation.summary}</p>
                  </div>
                )}
              </div>
            )}

            {/* Conversation ended notice */}
            {isEnded && !showRating && !ratingSubmitted && (
              <div className="text-center py-3">
                <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                  对话已结束
                </span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area - prototype style */}
      <div className="border-t border-outline-variant/30 px-3 py-3 bg-card shrink-0">
        {/* Pending image preview */}
        {pendingImage && (
          <div className="mb-2 flex items-end gap-2">
            <div className="relative group">
              <img
                src={pendingImage.url}
                alt="待发送图片"
                className="w-20 h-20 rounded-md object-cover border border-border"
              />
              <button
                onClick={handleRemovePendingImage}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-error text-error-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">图片已选择，发送后将自动识别</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* Image upload button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isEnded || isHandoff || isUploadingImage}
            className="bg-surface-container text-muted-foreground p-2 rounded-md hover:bg-surface-container-high transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title="上传图片"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder={isHandoff ? '等待人工客服接入...' : isEnded ? '对话已结束，请重新开始' : pendingImage ? '添加图片描述（可选）...' : '输入回复内容...'}
              disabled={isEnded || isHandoff}
              rows={2}
              className="w-full bg-surface-container border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors resize-none disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !pendingImage) || isSending || isEnded || isHandoff}
              className="bg-primary text-primary-foreground p-2 rounded-md hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="发送"
            >
              <Send className="w-4 h-4" />
            </button>
            <div className="relative" ref={quickReplyRef}>
              <button
                onClick={() => setShowQuickReplies(!showQuickReplies)}
                className="bg-surface-container text-muted-foreground p-2 rounded-md hover:bg-surface-container-high transition-colors"
                title="快捷回复"
              >
                <Zap className="w-4 h-4" />
              </button>
              {/* Quick replies dropdown */}
              {showQuickReplies && (
                <div className="absolute bottom-full right-0 mb-1 w-56 bg-card shadow-float rounded-lg border border-border py-1 z-50">
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
                    快捷回复
                  </div>
                  {quickReplies.map((text, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleQuickReply(text)}
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors truncate"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {conversation && !isEnded && !isHandoff && (
            <>
              <button
                onClick={() => onEndConversation(conversation.id)}
                className="text-xs text-muted-foreground hover:text-error px-2 py-1 rounded hover:bg-error/5 transition-colors flex items-center gap-1"
              >
                <PhoneOff className="w-3 h-3" />
                结束对话
              </button>
              <button
                onClick={() => onHandoff(conversation.id)}
                className="text-xs text-amber-600 hover:text-amber-700 px-2 py-1 rounded hover:bg-amber-500/10 transition-colors flex items-center gap-1"
              >
                <Headphones className="w-3 h-3" />
                转人工客服
              </button>
              <button
                onClick={handleCreateTicket}
                disabled={isCreatingTicket}
                className="text-xs text-primary hover:bg-primary/5 px-2 py-1 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {isCreatingTicket ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ticket className="w-3 h-3" />}
                转工单
              </button>
            </>
          )}
          {conversation && isHandoff && (
            <span className="text-xs text-amber-600 flex items-center gap-1 px-2 py-1">
              <Headphones className="w-3 h-3" />
              等待人工客服接入...
            </span>
          )}
          {conversation && isEnded && (
            <button
              onClick={onRestartConversation}
              className="text-xs text-primary hover:bg-primary/5 px-2 py-1 rounded transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              重新开始
            </button>
          )}
        </div>
      </div>
      </div>

      {/* Customer Info Side Panel */}
      {showCustomerPanel && conversation && (
        <div className="w-72 border-l border-border bg-card shrink-0 flex flex-col overflow-hidden animate-slide-in-right">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium text-foreground">客户信息</span>
            <button
              onClick={() => setShowCustomerPanel(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Customer avatar & name */}
            <div className="px-4 py-4 text-center border-b border-border">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-semibold text-primary mx-auto mb-2">
                {convTitle.charAt(0)}
              </div>
              <div className="text-sm font-medium text-foreground">{convTitle}</div>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-xs ${
                  convSource === '千牛' ? 'text-primary' : convSource === '抖店' ? 'text-emerald-600' : 'text-success'
                }`}>
                  <Globe className="w-3 h-3" />
                  {convSource || '网页'}
                </span>
                {isUrgent && (
                  <span className="inline-flex items-center gap-1 text-xs text-error">
                    <AlertTriangle className="w-3 h-3" />
                    紧急
                  </span>
                )}
              </div>
            </div>

            {/* Conversation details */}
            <div className="px-4 py-3 border-b border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2">当前对话</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">状态</span>
                  <span className="ml-auto text-foreground">
                    {isEnded ? '已结束' : isHandoff ? '转人工中' : '进行中'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">消息数</span>
                  <span className="ml-auto text-foreground">{messages.length}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">创建时间</span>
                  <span className="ml-auto text-foreground">
                    {new Date(conversation.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {conversation.rating && (
                  <div className="flex items-center gap-2 text-xs">
                    <Star className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">评分</span>
                    <span className="ml-auto text-foreground flex items-center gap-0.5">
                      {Array.from({ length: conversation.rating }).map((_, i) => (
                        <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
                      ))}
                    </span>
                  </div>
                )}
              </div>
              {/* Conversation summary */}
              {conversation.summary && (
                <div className="mt-3 pt-2.5 border-t border-border">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-xs font-medium text-primary">对话摘要</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{conversation.summary}</p>
                </div>
              )}
            </div>

            {/* Other conversations */}
            <div className="px-4 py-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">历史对话</div>
              {otherConversations.length === 0 ? (
                <div className="text-xs text-muted-foreground/60 py-2">暂无其他对话记录</div>
              ) : (
                <div className="space-y-1.5">
                  {otherConversations.slice(0, 10).map((conv) => (
                    <div
                      key={conv.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors cursor-default"
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold shrink-0 overflow-hidden ${
                        conv.status === 'active' ? 'bg-success/15 text-success' : conv.status === 'handoff' ? 'bg-amber-500/15 text-amber-600' : 'bg-muted text-muted-foreground'
                      }`}>
                        {conv.customer?.avatar ? (
                          <Image
                            src={conv.customer.avatar}
                            alt={conv.customer.name || '用户头像'}
                            width={20}
                            height={20}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          (conv.customer?.name || conv.title).charAt(0)
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-foreground truncate">{conv.customer?.name || conv.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(conv.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {conv.last_message && ` · ${conv.last_message.slice(0, 15)}${conv.last_message.length > 15 ? '...' : ''}`}
                        </div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Source Panel */}
      {showSourcePanel && conversation && (() => {
        // Determine which sources to display
        let displaySources: Message['sources'] = null;
        let displayConfidence: number | null = null;
        let displayConfidenceBreakdown: import('@/lib/types').ConfidenceBreakdown | null = null;

        if (isSending && streamingSources) {
          // During streaming, show streaming sources
          displaySources = streamingSources;
          displayConfidence = streamingConfidence;
          displayConfidenceBreakdown = streamingConfidenceBreakdown;
        } else if (selectedMsgIdForSource) {
          // Show selected message's sources
          const selectedMsg = messages.find(m => m.id === selectedMsgIdForSource);
          if (selectedMsg) {
            displaySources = selectedMsg.sources;
            displayConfidence = selectedMsg.confidence ?? null;
            displayConfidenceBreakdown = selectedMsg.confidence_breakdown ?? null;
          }
        } else {
          // Default: show last assistant message's sources
          const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
          if (lastAssistant) {
            displaySources = lastAssistant.sources;
            displayConfidence = lastAssistant.confidence ?? null;
            displayConfidenceBreakdown = lastAssistant.confidence_breakdown ?? null;
          }
        }

        let displayMessageId: string | null = null;
        if (isSending && streamingSources) {
          // During streaming, no message id yet
          displayMessageId = null;
        } else if (selectedMsgIdForSource) {
          displayMessageId = selectedMsgIdForSource;
        } else {
          const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
          displayMessageId = lastAssistant?.id ?? null;
        }

        return (
          <SourcePanel
            sources={displaySources || []}
            confidence={displayConfidence}
            confidenceBreakdown={displayConfidenceBreakdown}
            messageId={displayMessageId ?? undefined}
            conversationId={conversation.id}
            onClose={() => { setShowSourcePanel(false); setSelectedMsgIdForSource(null); }}
          />
        );
      })()}
      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="预览图片"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
