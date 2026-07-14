'use client';

import { useState, useEffect } from 'react';
import { Bot, Check, Loader2, AlertCircle } from 'lucide-react';
import { logger } from '@/lib/logger';

export interface BotConfig {
  id: string;
  name: string;
  description: string;
  status: string;
  is_sub_agent: boolean;
  parent_bot_id: string | null;
}

export interface BotSelectorProps {
  selectedBotIds: string[];
  onChange: (botIds: string[]) => void;
  maxSelection?: number;
}

export function BotSelector({ selectedBotIds, onChange, maxSelection = 2 }: BotSelectorProps) {
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBots();
  }, []);

  const fetchBots = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/bot-configs?include_sub_agents=false');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const botList = Array.isArray(data.bots) ? data.bots : [];
      setBots(botList.filter((b: BotConfig) => b.status === 'active'));
    } catch (err) {
      setError('加载Bot列表失败');
      logger.error('Failed to fetch bots', { error: err });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleBot = (botId: string) => {
    if (selectedBotIds.includes(botId)) {
      onChange(selectedBotIds.filter(id => id !== botId));
    } else if (selectedBotIds.length < maxSelection) {
      onChange([...selectedBotIds, botId]);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-success/10 text-success';
      case 'inactive':
        return 'bg-muted text-muted-foreground';
      case 'draft':
        return 'bg-warning/10 text-warning';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8 text-error">
        <AlertCircle className="w-5 h-5" />
        <span className="ml-2 text-sm">{error}</span>
      </div>
    );
  }

  if (bots.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">暂无可用的Bot</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground mb-3">
        选择 {selectedBotIds.length}/{maxSelection} 个Bot进行对比
      </div>
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {bots.map((bot) => {
          const isSelected = selectedBotIds.includes(bot.id);
          const isDisabled = !isSelected && selectedBotIds.length >= maxSelection;

          return (
            <div
              key={bot.id}
              onClick={() => !isDisabled && toggleBot(bot.id)}
              className={`
                relative flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200
                ${isSelected
                  ? 'border-primary bg-primary/5'
                  : isDisabled
                  ? 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30'
                }
              `}
            >
              <div className={`
                w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors
                ${isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/30'
                }
              `}>
                {isSelected && <Check className="w-3 h-3" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">
                    {bot.name}
                  </span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusBadgeClass(bot.status)}`}>
                    {bot.status === 'active' ? '启用' : bot.status}
                  </span>
                </div>
                {bot.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {bot.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
