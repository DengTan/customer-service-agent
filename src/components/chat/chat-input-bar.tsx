'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-fetch';
import {
  StickyNote,
  BookOpen,
  Paperclip,
  Send,
  ImageIcon,
  Loader2,
  X,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QuickRepliesPanel } from '@/components/quick-replies/quick-replies-panel';
import { ProductPicker } from '@/components/chat/product-picker';
import { HTTP } from '@/lib/constants';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size?: number;
}

export interface Agent {
  id: string;
  name: string;
}

interface ChatInputBarProps {
  noteMode: boolean;
  onNoteModeChange: (value: boolean) => void;
  agents: Agent[];
  maxLength?: number;
  onSend: (text: string, isNote: boolean, attachments?: Attachment[]) => void;
  onSendProduct?: (product: { name: string; sku: string; price: number; description?: string }) => void;
  /** 模拟测试模式下禁用内部备注按钮 */
  simulationMode?: boolean;
}

export function ChatInputBar({
  noteMode,
  onNoteModeChange,
  agents,
  maxLength = HTTP.MAX_MESSAGE_LENGTH,
  onSend,
  onSendProduct,
  simulationMode = false,
}: ChatInputBarProps) {
  const [inputText, setInputText] = useState('');
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionInput, setMentionInput] = useState('');
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!inputText.trim() && attachments.length === 0) return;
    onSend(inputText, noteMode, attachments);
    setInputText('');
    setAttachments([]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    const newAttachments: Attachment[] = [];

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('purpose', 'chat');

        const res = await apiFetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error('上传失败');
        const data = await res.json();

        newAttachments.push({
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          url: data.url,
        });
      }

      setAttachments(prev => [...prev, ...newAttachments]);
    } catch (err) {
      toast.error('文件上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  return (
    <>
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
            onClick={() => onNoteModeChange(false)}
          >
            退出
          </button>
        </div>
      )}

      {/* Input row */}
      <div className={`px-4 py-3 max-h-24 flex items-center gap-2`}>
        <div className="grid grid-cols-2 gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            disabled={simulationMode}
            className={`transition-colors ${simulationMode ? 'opacity-40 cursor-not-allowed pointer-events-none' : noteMode ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/20' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => onNoteModeChange(!noteMode)}
            title={simulationMode ? '模拟测试模式不支持内部备注' : noteMode ? '退出备注模式' : '添加内部备注'}
          >
            <StickyNote className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground transition-colors"
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
            className="text-muted-foreground hover:text-foreground transition-colors"
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
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setProductPickerOpen(true)}
            disabled={noteMode}
            title={noteMode ? '备注模式不支持发送商品' : '发送商品'}
          >
            <ShoppingBag className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 relative">
          <textarea
            value={inputText}
            rows={2}
            onChange={(e) => {
              const val = e.target.value;
              setInputText(val);
              e.target.style.height = 'auto';
              const lineHeight = parseInt(getComputedStyle(e.target).lineHeight) || 20;
              const maxHeight = lineHeight * 3;
              e.target.style.height = Math.min(e.target.scrollHeight, maxHeight) + 'px';
              const match = val.match(/@([^\s@]*)$/);
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
            className={`flex items-center w-full min-h-[2lh] max-h-[3lh] resize-none rounded-md border bg-transparent px-3 py-2 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              noteMode
                ? 'border-amber-300 dark:border-amber-700 focus-visible:border-amber-400 dark:focus-visible:border-amber-600 focus-visible:ring-amber-200 dark:focus-visible:ring-amber-800 bg-white dark:bg-amber-950/20'
                : 'border-input focus-visible:border-ring'
            }`}
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

        {/* Send button group */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          {/* Character counter */}
          <div
            className={`select-none text-[10px] tabular-nums ${
              inputText.length > maxLength * 0.9
                ? inputText.length > maxLength
                  ? 'text-red-500 font-medium'
                  : 'text-amber-500'
                : 'text-muted-foreground/50'
            }`}
          >
            {inputText.length}/{maxLength}
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

      {/* Quick Replies Panel */}
      <Dialog open={quickReplyOpen} onOpenChange={setQuickReplyOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-3 border-b">
            <DialogTitle>话术库管理</DialogTitle>
          </DialogHeader>
          <QuickRepliesPanel
            className="flex-1 overflow-hidden"
            onSelect={(reply) => {
              setInputText(reply.content);
              setQuickReplyOpen(false);
            }}
            showActions={true}
          />
        </DialogContent>
      </Dialog>

      <ProductPicker
        open={productPickerOpen}
        onOpenChange={setProductPickerOpen}
        onSelect={(product) => {
          if (onSendProduct) {
            onSendProduct(product);
          } else {
            const content = `【商品信息】
名称：${product.name}
SKU：${product.sku}
价格：¥${product.price}
${product.description ? `描述：${product.description}` : ''}`;
            onSend(content, false);
          }
          setProductPickerOpen(false);
        }}
      />
    </>
  );
}
