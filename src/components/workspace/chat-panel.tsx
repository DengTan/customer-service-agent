'use client';

import Image from 'next/image';
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Send,
  ArrowRightLeft,
  AlertCircle,
  Loader2,
  StickyNote,
  AtSign,
  Paperclip,
  X,
  Image as ImageIcon,
  BookOpen,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentQueueItem } from '@/lib/types';
import { SOURCE_PLATFORM_LABELS } from '@/lib/types';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import {
  type ChatMessage,
  type Attachment,
  VALID_FILE_TYPES,
  MAX_FILE_SIZE,
  MAX_UPLOAD_SIZE_LABEL,
  shouldShowTimeDivider,
} from './workspace-shared';

interface ChatPanelProps {
  selectedConversation: AgentQueueItem | null;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  agents: Array<{ id: string; name: string }>;
  onTransfer: () => void;
  onResolve: (queueId: string) => void;
}

export function ChatPanel({
  selectedConversation,
  messages,
  setMessages,
  agents,
  onTransfer,
  onResolve,
}: ChatPanelProps) {
  const { user } = useAuth();
  const [inputText, setInputText] = useState('');
  const [noteMode, setNoteMode] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mentionInput, setMentionInput] = useState('');
  const [showMentionList, setShowMentionList] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<Array<{ title: string; content: string; category: string }>>([]);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedTransferAgent, setSelectedTransferAgent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const validTypes = VALID_FILE_TYPES;
      if (!validTypes.includes(file.type)) {
        toast.error(`不支持的文件格式: ${file.name}`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast.error(`文件过大: ${file.name}，最大支持 ${MAX_UPLOAD_SIZE_LABEL}`);
        continue;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          throw new Error('Upload failed');
        }

        const data = await res.json();
        const newAttachment: Attachment = {
          id: crypto.randomUUID(),
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

  const handleSendMessage = async () => {
    if (!selectedConversation) return;
    if (!inputText.trim() && attachments.length === 0) return;

    if (noteMode) {
      const mentions = agents
        .filter(a => inputText.includes(`@${a.name}`))
        .map(a => a.id);

      const tempId = crypto.randomUUID();
      const msg: ChatMessage = {
        id: tempId,
        role: 'internal_note',
        content: inputText.trim(),
        timestamp: new Date().toISOString(),
        author_name: user?.name || '坐席',
        mentions,
      };
      setMessages(prev => [...prev, msg]);
      setInputText('');

      try {
        const res = await fetch(`/api/conversations/${selectedConversation.conversation_id}/internal-note`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: msg.content, mentions }),
        });
        if (!res.ok) {
          setMessages(prev => prev.filter(m => m.id !== tempId));
          toast.error('备注发送失败，请重试');
        }
      } catch {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        toast.error('备注发送失败，请重试');
      }
      return;
    }

    const currentAttachments = [...attachments];
    const tempId = crypto.randomUUID();
    const msg: ChatMessage = {
      id: tempId,
      role: 'agent',
      content: inputText.trim(),
      timestamp: new Date().toISOString(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };
    setMessages(prev => [...prev, msg]);
    setInputText('');
    setAttachments([]);

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.conversation_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: msg.content, role: 'agent', attachments: currentAttachments }),
      });
      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        toast.error('消息发送失败，请重试');
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      toast.error('消息发送失败，请重试');
    }
  };

  const handleTransfer = async () => {
    if (!selectedConversation || !selectedTransferAgent) return;
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
        setTransferDialogOpen(false);
        onTransfer();
      } else {
        toast.error('转接失败');
      }
    } catch {
      toast.error('转接失败');
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
              : 'bg-emerald-500/10 text-emerald-600'
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
                  selectedConversation.source_platform === 'qianniu' ? 'text-blue-600' : selectedConversation.source_platform === 'doudian' ? 'text-emerald-600' : 'text-gray-500'
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
              <span className="flex items-center gap-1 text-emerald-600">
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
            onClick={() => setTransferDialogOpen(true)}
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
                        isAgent ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'
                      }`}>
                        {isAgent ? '坐' : 'S'}
                      </div>
                    )}
                    <div className={isUser ? 'text-right' : ''}>
                      <div className={`${isUser ? 'bg-blue-100 text-foreground' : 'bg-card text-foreground'} rounded-lg px-3 py-2 text-left`}>
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
                            {msg.content && <MarkdownRenderer content={msg.content} />}
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
              ref={inputRef}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                // Detect @mention
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
                  handleSendMessage();
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
                        const inputEl = inputRef.current;
                        const cursorPos = inputEl?.selectionStart ?? inputText.length;
                        const textBeforeCursor = inputText.slice(0, cursorPos);
                        const mentionMatch = textBeforeCursor.match(/@([^\s@]*)$/);
                        if (mentionMatch) {
                          const mentionStart = cursorPos - mentionMatch[0].length;
                          const newText = inputText.slice(0, mentionStart) + `@${agent.name} ` + inputText.slice(cursorPos);
                          setInputText(newText);
                        } else {
                          setInputText(inputText + `@${agent.name} `);
                        }
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
            onClick={handleSendMessage}
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
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group:hover:opacity-100 transition-opacity"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transfer Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
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
              <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleTransfer} disabled={!selectedTransferAgent}>
                确认转接
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Reply Dialog */}
      <Dialog open={quickReplyOpen} onOpenChange={setQuickReplyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>话术库</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {quickReplies.map((reply) => (
              <button
                key={reply.title}
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
