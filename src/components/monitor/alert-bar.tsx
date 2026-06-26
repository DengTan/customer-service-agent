'use client';

import { AlertTriangle, Ticket } from 'lucide-react';

interface AlertBarProps {
  unresolvedAlerts: number;
  lowConfidenceCount: number;
  highTurnCount: number;
  ticketAlertCount: number;
  onClick: () => void;
}

export function AlertBar({ unresolvedAlerts, lowConfidenceCount, highTurnCount, ticketAlertCount, onClick }: AlertBarProps) {
  if (unresolvedAlerts === 0 && lowConfidenceCount === 0 && highTurnCount === 0 && ticketAlertCount === 0) return null;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-2 border-t border-border bg-amber-500/5 shrink-0 cursor-pointer hover:bg-amber-500/10 transition-colors"
    >
      <div className="flex items-center gap-1.5 text-xs">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-amber-600 font-medium">告警</span>
      </div>
      {lowConfidenceCount > 0 && (
        <span className="text-xs text-red-600 font-medium">
          低置信度 {lowConfidenceCount}
        </span>
      )}
      {highTurnCount > 0 && (
        <span className="text-xs text-amber-600 font-medium">
          高轮次 {highTurnCount}
        </span>
      )}
      {ticketAlertCount > 0 && (
        <span className="text-xs text-blue-600 font-medium inline-flex items-center gap-1">
          <Ticket className="w-3 h-3" />
          工单 {ticketAlertCount}
        </span>
      )}
      {unresolvedAlerts > 0 && (
        <span className="text-xs text-muted-foreground ml-auto">
          {unresolvedAlerts} 条未处理 →
        </span>
      )}
    </div>
  );
}
