'use client';

import { Button } from '@/components/ui/button';
import { ArrowRightLeft, CheckCircle, PhoneOff } from 'lucide-react';
import type { AgentQueueItem } from '@/lib/types';
import { SOURCE_PLATFORM_LABELS } from '@/lib/types';

interface CustomerInfoPanelProps {
  selectedConversation: AgentQueueItem | null;
  onTransfer: () => void;
  onResolve: (queueId: string) => void;
}

export function CustomerInfoPanel({
  selectedConversation,
  onTransfer,
  onResolve,
}: CustomerInfoPanelProps) {
  if (!selectedConversation) {
    return (
      <div className="w-[300px] border-l border-border bg-card overflow-y-auto shrink-0">
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-xs">选择对话查看客户信息</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[300px] border-l border-border bg-card overflow-y-auto shrink-0">
      <div className="p-4 space-y-4">
        {/* Customer Basic Info */}
        <div>
          <h3 className="text-sm font-medium mb-3">客户信息</h3>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
              {(selectedConversation.customer_name || '?')[0]}
            </div>
            <div>
              <p className="text-sm font-medium">{selectedConversation.customer_name || '未知客户'}</p>
              <p className="text-xs text-muted-foreground">
                {selectedConversation.source_platform
                  ? SOURCE_PLATFORM_LABELS[selectedConversation.source_platform as keyof typeof SOURCE_PLATFORM_LABELS] || selectedConversation.source_platform
                  : '未知来源'}
              </p>
            </div>
          </div>
        </div>

        {/* Summary */}
        {selectedConversation.summary && (
          <div>
            <h3 className="text-sm font-medium mb-2">问题摘要</h3>
            <p className="text-xs text-muted-foreground leading-relaxed bg-muted/50 rounded-lg p-2.5">
              {selectedConversation.summary}
            </p>
          </div>
        )}

        {/* Reason */}
        {selectedConversation.reason && (
          <div>
            <h3 className="text-sm font-medium mb-2">转人工原因</h3>
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5">
              {selectedConversation.reason}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-medium mb-2">快捷操作</h3>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={onTransfer}
          >
            <ArrowRightLeft className="w-4 h-4" />
            转接其他坐席
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => onResolve(selectedConversation.id)}
          >
            <CheckCircle className="w-4 h-4" />
            标记已解决
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onResolve(selectedConversation.id)}
          >
            <PhoneOff className="w-4 h-4" />
            结束对话
          </Button>
        </div>
      </div>
    </div>
  );
}
