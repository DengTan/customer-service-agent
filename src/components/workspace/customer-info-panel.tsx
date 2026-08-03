'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRightLeft, CheckCircle, Mail, PanelRightClose, PanelRightOpen, Phone, PhoneOff } from 'lucide-react';
import type { AgentQueueItem, Customer } from '@/lib/types';
import { PRIORITY_LABELS, SOURCE_PLATFORM_LABELS } from '@/lib/types';

interface CustomerInfoPanelProps {
  selectedConversation: AgentQueueItem | null;
  customerInfo?: Customer | null;
  isLoading?: boolean;
  onTransfer: () => void;
  onResolve: (queueId: string) => void;
}

export function CustomerInfoPanel({
  selectedConversation,
  customerInfo = null,
  isLoading = false,
  onTransfer,
  onResolve,
}: CustomerInfoPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (isCollapsed) {
    return (
      <div className="w-11 border-l border-border/50 bg-card shrink-0 flex justify-center py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsCollapsed(false)}
          aria-label="展开客户信息"
          title="展开客户信息"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (!selectedConversation) {
    return (
      <div className="w-[280px] border-l border-border/50 bg-card overflow-y-auto shrink-0">
        <div className="flex justify-end p-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsCollapsed(true)}
            aria-label="收起客户信息"
            title="收起客户信息"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center justify-center h-[calc(100%-48px)] text-muted-foreground">
          <p className="text-xs">选择对话查看客户信息</p>
        </div>
      </div>
    );
  }

  const customerName = customerInfo?.name || selectedConversation.customer_name || '未知客户';
  const sourcePlatform = customerInfo?.source_platform || selectedConversation.source_platform;

  return (
    <div className="w-[280px] border-l border-border/50 bg-card overflow-y-auto shrink-0">
      <div className="flex items-center justify-between px-4 pt-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">客户信息</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setIsCollapsed(true)}
          aria-label="收起客户信息"
          title="收起客户信息"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="px-4 pb-4 pt-2 space-y-5">
        <div>
          <div className="flex items-center gap-3">
            {customerInfo?.avatar || selectedConversation.customer_avatar ? (
              <img
                src={customerInfo?.avatar || selectedConversation.customer_avatar || ''}
                alt={customerName}
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
                {customerName[0] || '?'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{customerName}</p>
              <p className="text-xs text-muted-foreground">
                {sourcePlatform
                  ? SOURCE_PLATFORM_LABELS[sourcePlatform as keyof typeof SOURCE_PLATFORM_LABELS] || sourcePlatform
                  : '未知来源'}
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : customerInfo ? (
          <>
            {(customerInfo.phone || customerInfo.email) && (
              <div className="space-y-2 text-xs text-muted-foreground">
                {customerInfo.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" /><span>{customerInfo.phone}</span></div>}
                {customerInfo.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" /><span className="truncate">{customerInfo.email}</span></div>}
              </div>
            )}
            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">客户画像</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">历史对话</span><span>{customerInfo.conversation_count} 次</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">当前优先级</span><span>{PRIORITY_LABELS[selectedConversation.priority]}</span></div>
              </div>
            </div>
            {customerInfo.tags.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">标签</h3>
                <div className="flex flex-wrap gap-1.5">
                  {customerInfo.tags.map(tag => <span key={tag} className="rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">{tag}</span>)}
                </div>
              </div>
            )}
            {customerInfo.notes && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">备注</h3>
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">{customerInfo.notes}</p>
              </div>
            )}
          </>
        ) : null}

        {selectedConversation.summary && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">关联订单 / 问题摘要</h3>
            <p className="text-xs text-muted-foreground leading-relaxed bg-muted/50 rounded-lg p-3">{selectedConversation.summary}</p>
          </div>
        )}

        {selectedConversation.reason && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">转人工原因</h3>
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">{selectedConversation.reason}</p>
          </div>
        )}

        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">快捷操作</h3>
          <Button variant="ghost" className="w-full justify-start gap-2 h-9 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" onClick={onTransfer}>
            <ArrowRightLeft className="w-4 h-4" />转接其他坐席
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-2 h-9 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" onClick={() => onResolve(selectedConversation.id)}>
            <CheckCircle className="w-4 h-4" />标记已解决
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-2 h-9 px-3 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors" onClick={() => onResolve(selectedConversation.id)}>
            <PhoneOff className="w-4 h-4" />结束对话
          </Button>
        </div>
      </div>
    </div>
  );
}
