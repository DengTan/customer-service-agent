'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Bell, CheckCircle, Loader2, RefreshCw, X, ArrowUpDown } from 'lucide-react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { Alert } from '@/lib/types';

interface AlertDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAlertResolved?: () => void;
  onConversationClick?: (conversationId: string) => void;
}

export function AlertDrawer({ open, onOpenChange, onAlertResolved, onConversationClick }: AlertDrawerProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortNewest, setSortNewest] = useState(true);
  const [filter, setFilter] = useState<'unresolved' | 'resolved'>('unresolved');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts?limit=50');
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadAlerts();
  }, [open, loadAlerts]);

  const handleResolve = async (alertId: string) => {
    try {
      const res = await fetch(`/api/alerts?id=${alertId}`, { method: 'PATCH' });
      if (!res.ok) {
        toast.error('标记失败');
        return;
      }
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, is_resolved: true } : a)),
      );
      onAlertResolved?.();
    } catch {
      toast.error('标记失败');
    }
  };

  const unresolvedCount = alerts.filter((a) => !a.is_resolved).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] p-0 flex flex-col">
        <SheetHeader className="px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <SheetTitle className="text-sm font-semibold">异常告警</SheetTitle>
              {unresolvedCount > 0 && (
                <span className="min-w-[20px] h-5 flex items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-1.5">
                  {unresolvedCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSortNewest((prev) => !prev)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
              >
                <ArrowUpDown className={`w-3.5 h-3.5 transition-transform ${!sortNewest ? 'rotate-180' : ''}`} />
                {sortNewest ? '最新' : '最早'}
              </button>
              <SheetClose className="flex items-center justify-center w-7 h-7 rounded-md opacity-70 hover:opacity-100 hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </SheetClose>
            </div>
          </div>
          <SheetDescription className="sr-only">查看和管理异常告警</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-1 px-5 py-2 border-b border-border shrink-0">
          <button
            onClick={() => setFilter('unresolved')}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              filter === 'unresolved'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            未处理
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`text-xs px-3 py-1 rounded-md transition-colors ${
              filter === 'resolved'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            已处理
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && alerts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
              加载中...
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              暂无异常告警
            </div>
          ) : (
            (() => {
              const filtered = alerts.filter((a) =>
                filter === 'unresolved' ? !a.is_resolved : a.is_resolved
              );
              const sorted = filtered.sort((a, b) =>
                sortNewest
                  ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                  : new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );

              if (sorted.length === 0) {
                return (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                    {filter === 'unresolved' ? '暂无未处理告警' : '暂无已处理告警'}
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  {sorted.map((alert) => (
                    <div
                      key={alert.id}
                      onClick={() => onConversationClick?.(alert.conversation_id)}
                      className={`flex items-start gap-3 p-3 rounded-lg border border-border transition-colors cursor-pointer ${
                        alert.is_resolved
                          ? 'border-border/50 bg-muted/20 opacity-60'
                          : alert.severity === 'critical'
                          ? 'border-destructive/20 bg-destructive/5'
                          : alert.severity === 'warning'
                          ? 'border-warning/20 bg-warning/5'
                          : 'bg-muted/30'
                      }`}
                    >
                      <AlertTriangle
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          alert.is_resolved
                            ? 'text-muted-foreground'
                            : alert.severity === 'critical'
                            ? 'text-destructive'
                            : 'text-warning'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{alert.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(alert.created_at).toLocaleString('zh-CN')}
                          {alert.is_resolved && ' · 已处理'}
                        </p>
                      </div>
                      {!alert.is_resolved && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResolve(alert.id); }}
                          className="text-[10px] px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          标记已处理
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
