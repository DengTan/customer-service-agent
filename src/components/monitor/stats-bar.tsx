'use client';

import { MessageSquare, Headphones, Bot, AlertTriangle } from 'lucide-react';

interface StatsBarProps {
  active: number;
  handoff: number;
  aiProcessing: number;
  alerts: number;
  onFilterClick: (filter: 'active' | 'handoff' | 'active_ai' | 'alert' | null) => void;
  activeFilter: string | null;
}

export function StatsBar({ active, handoff, aiProcessing, alerts, onFilterClick, activeFilter }: StatsBarProps) {
  const items = [
    {
      key: 'active' as const,
      label: '进行中',
      value: active,
      icon: MessageSquare,
      color: 'text-primary',
      bg: 'bg-primary/10',
      border: 'border-primary/20',
    },
    {
      key: 'handoff' as const,
      label: '待接管',
      value: handoff,
      icon: Headphones,
      color: 'text-amber-600',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
    {
      key: 'active_ai' as const,
      label: 'AI处理中',
      value: aiProcessing,
      icon: Bot,
      color: 'text-emerald-600',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
    },
    {
      key: 'alert' as const,
      label: '异常',
      value: alerts,
      icon: AlertTriangle,
      color: 'text-red-600',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
    },
  ];

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border/50 bg-card/50 shrink-0">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeFilter === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onFilterClick(isActive ? null : item.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm transition-all duration-200 ${
              isActive
                ? `${item.bg} ${item.border} ${item.color} font-medium`
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{item.label}</span>
            <span className={`min-w-[20px] h-5 flex items-center justify-center rounded-full text-xs font-semibold px-1.5 ${
              isActive ? `${item.bg}` : 'bg-muted'
            }`}>
              {item.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
