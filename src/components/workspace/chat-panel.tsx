'use client';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MessageSquare,
  UserCheck,
  CheckCircle,
  PhoneOff,
  ArrowRightLeft,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentQueueItem } from '@/lib/types';
import { SOURCE_PLATFORM_LABELS } from '@/lib/types';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import { stripInternalMarkersFromResponse } from '@/lib/strip-markers';
import { ChatInputBar, type Attachment } from '@/components/chat/chat-input-bar';
import {
  type ChatMessage,
  shouldShowTimeDivider,
} from './workspace-shared';

interface ChatPanelProps {
  selectedConversation: AgentQueueItem | null;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  agents: Array<{ id: string; name: string }>;
  onTransfer: () => void;
  onResolve: (queueId: string) => void;
  transferDialogOpen?: boolean;
  onTransferDialogOpenChange?: (open: boolean) => void;
}

export function ChatPanel({
  selectedConversation,
  messages,
  setMessages,
  agents,
  onTransfer,
  onResolve,
  transferDialogOpen,
  onTransferDialogOpenChange,
}: ChatPanelProps) {
  const { user } = useAuth();
  const [noteMode, setNoteMode] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<Array<{ title: string; content: string; category: string }>>([]);
  const [selectedTransferAgent, setSelectedTransferAgent] = useState('');
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use external transfer dialog state if provided, otherwise manage internally
  const [internalTransferOpen, setInternalTransferOpen] = useState(false);
  const isTransferDialogControlled = transferDialogOpen !== undefined;
  const isTransferOpen = isTransferDialogControlled ? transferDialogOpen! : internalTransferOpen;
  const handleTransferDialogChange = (open: boolean) => {
    if (isTransferDialogControlled && onTransferDialogOpenChange) {
      onTransferDialogOpenChange(open);
    } else {
      setInternalTransferOpen(open);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch quick replies
  useEffect(() => {
    fetch('/api/quick-replies')
      .then(res => res.ok ? res.json() : { replies: [] })
      .then(data => setQuickReplies(data.replies || []))
      .catch(() => {
        toast.error('加载话术库失败');
      });
  }, []);

  const handleCopy = async (content: string, msgId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  const handleSendMessage = async (text: string, isNote: boolean, attachments?: Attachment[]) => {
    if (!selectedConversation) return;
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    if (isNote) {
      const mentions = agents
        .filter(a => text.includes(`@${a.name}`))
        .map(a => a.id);

      const tempId = crypto.randomUUID();
      const msg: ChatMessage = {
        id: tempId,
        role: 'internal_note',
        content: text.trim(),
        timestamp: new Date().toISOString(),
        author_name: user?.name || '坐席',
        mentions,
      };
      setMessages(prev => [...prev, msg]);

      try {
        const res = await fetch(`/api/conversations/${selectedConversation.conversation_id}/internal-note`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: msg.content, mentions }),
        });
        if (!res.ok) {
          setMessages(prev => prev.filter(m => m.id !== tempId));
          const data = await res.json().catch(() => ({}));
          toast.error(data.message || '备注发送失败，请重试');
        }
      } catch {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        toast.error('备注发送失败，请重试');
      }
      return;
    }

    const currentAttachments = attachments ? [...attachments] : [];
    const tempId = crypto.randomUUID();
    const msg: ChatMessage = {
      id: tempId,
      role: 'agent',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };
    setMessages(prev => [...prev, msg]);

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.conversation_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msg.content, role: 'agent', attachments: currentAttachments }),
      });
      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        const data = await res.json().catch(() => ({}));
        toast.error(data.message || '消息发送失败，请重试');
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      toast.error('消息发送失败，请重试');
    }
  };

  const handleTransfer = async () => {
    if (!selectedConversation || !selectedTransferAgent) return;
    const selectedAgent = agents.find(a => a.id === selectedTransferAgent);
    try {
      const res = await fetch('/api/agent/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue_id: selectedConversation.id,
          action: 'transfer',
          target_agent_id: selectedTransferAgent,
        }),
      });
      if (res.ok) {
        handleTransferDialogChange(false);
        toast.success(`已转接给 ${selectedAgent?.name || '目标坐席'}`);
        onTransfer();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message || '转接失败');
      }
    } catch {
      toast.error('转接失败，请重试');
    }
  };

  if (!selectedConversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">选择一个对话开始服务</p>
          <p className="text-xs mt-1">从左侧排队列表接单，或选择正在服务的对话</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 overflow-hidden ${
            selectedConversation.status === 'resolved' ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
          }`}>
            {selectedConversation.customer_avatar ? (
              <Image
                src={selectedConversation.customer_avatar}
                alt={selectedConversation.customer_name || '用户头像'}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            ) : (
              (selectedConversation.customer_name || '?').charAt(0)
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">
                {selectedConversation.customer_name || '未知客户'}
              </span>
              {selectedConversation.source_platform && (
                <span className={`text-[10px] font-medium ${
                  selectedConversation.source_platform === 'qianniu' ? 'text-blue-600' : selectedConversation.source_platform === 'doudian' ? 'text-emerald-700' : 'text-gray-600'
                }`}>
                  {SOURCE_PLATFORM_LABELS[selectedConversation.source_platform as keyof typeof SOURCE_PLATFORM_LABELS] || selectedConversation.source_platform}
                </span>
              )}
              {selectedConversation.priority === 'urgent' && (
                <span className="inline-flex items-center px-1.5 py-0 rounded-sm text-[10px] font-medium bg-red-500/10 text-red-600">
                  <AlertCircle className="w-3 h-3 mr-0.5" />紧急
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1 text-emerald-700">
                <UserCheck className="w-3 h-3" />服务中
              </span>
              {selectedConversation.summary && (
                <>
                  <span>·</span>
                  <span className="truncate max-w-[200px]">{selectedConversation.summary}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleTransferDialogChange(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            转接
          </button>
          <button
            onClick={() => onResolve(selectedConversation.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            已解决
          </button>
          <button
            onClick={() => onResolve(selectedConversation.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            结束
          </button>
        </div>
      </div>

      {/* Summary Card */}
      {selectedConversation.summary && (
        <div className="mx-4 mt-2 p-2.5 rounded-lg bg-primary/5 border border-primary/10">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">对话摘要</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {selectedConversation.summary}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 min-h-0">
        <div className="space-y-3 max-w-3xl mx-auto px-4">
          {messages.map((msg, idx) => {
            const prevMsg = idx > 0 ? messages[idx - 1] : undefined;
            const showTimeDivider = shouldShowTimeDivider(msg, prevMsg);
            const isUser = msg.role === 'user';
            const isInternalNote = msg.role === 'internal_note';
            const isAgent = msg.role === 'agent';
            const customerName = selectedConversation?.customer_name || '客';
            const customerAvatar = selectedConversation?.customer_avatar || null;

            return (
              <div key={msg.id}>
                {showTimeDivider && (
                  <div className="flex items-center justify-center my-4 animate-fade-in">
                    <span className="text-xs text-muted-foreground/60 bg-muted/50 px-3 py-1 rounded-full">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
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
                        {msg.author_name && (
                          <span className="text-[10px] font-medium text-amber-600 mb-1 block">
                            @{msg.author_name}
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
                      <span className="text-[10px] text-muted-foreground mt-0.5 block">
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Normal message */
                  <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {!isUser && (
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 mt-0.5 ${
                        isAgent ? 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                      }`}>
                        {isAgent ? '坐' : 'S'}
                      </div>
                    )}
                    <div className={isUser ? 'text-right' : ''}>
                      <div className={`${isUser ? 'bg-blue-100 dark:bg-blue-900 text-foreground' : 'bg-card text-foreground'} rounded-lg px-3 py-2 text-left`}>
                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="mb-2 space-y-2">
                            {msg.attachments.map(att => (
                              att.type.startsWith('image/') ? (
                                <img
                                  key={att.id}
                                  src={att.url}
                                  alt={att.name}
                                  className="max-w-[280px] max-h-[200px] rounded-md object-cover"
                                />
                              ) : (
                                <a
                                  key={att.id}
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 px-2 py-1 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                                >
                                  <Paperclip className="w-3 h-3" />
                                  <span className="text-xs truncate max-w-[120px]">{att.name}</span>
                                </a>
                              )
                            ))}
                          </div>
                        )}
                        {isUser ? (
                          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</div>
                        ) : (
                          <>
                            {msg.content && <MarkdownRenderer content={stripInternalMarkersFromResponse(msg.content)} />}
                          </>
                        )}
                      </div>
                      <div className={`flex items-center gap-1.5 mt-0.5 ${isUser ? 'justify-end' : ''}`}>
                        {!isUser && (
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="text-muted-foreground/50 hover:text-foreground transition-colors"
                            title="复制"
                          >
                            {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    {isUser && (
                      <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-[11px] font-medium text-primary-foreground shrink-0 mt-0.5 overflow-hidden">
                        {customerAvatar ? (
                          <Image
                            src={customerAvatar}
                            alt={customerName}
                            width={28}
                            height={28}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          customerName.charAt(0)
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card/50 shrink-0">
        <ChatInputBar
          noteMode={noteMode}
          onNoteModeChange={setNoteMode}
          agents={agents}
          onSend={(text, isNote, attachments) => handleSendMessage(text, isNote, attachments)}
        />
      </div>

      {/* Transfer Dialog */}
      <Dialog open={isTransferOpen} onOpenChange={handleTransferDialogChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>转接其他坐席</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">选择目标坐席</label>
              <Select value={selectedTransferAgent} onValueChange={setSelectedTransferAgent}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择坐席" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleTransferDialogChange(false)}>
                取消
              </Button>
              <Button onClick={handleTransfer} disabled={!selectedTransferAgent}>
                确认转接
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
