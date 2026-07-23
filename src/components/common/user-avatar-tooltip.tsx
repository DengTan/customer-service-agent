'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface UserAvatarTooltipProps {
  user: {
    name: string;
    avatar?: string | null;
    role: string;
    agentStatus?: string | null;
  };
  size?: 'sm' | 'md' | 'lg';
  showStatus?: boolean;
  statusConfig?: Record<string, { label: string; color: string; bgColor: string; ringColor: string; pulse: boolean }>;
}

/**
 * Get user initials from name
 * Falls back to role label for consistent avatar display
 */
export function getUserInitials(name: string, role: string): string {
  const chineseChars = name.match(/[\u4e00-\u9fa5]/g);
  if (chineseChars && chineseChars.length >= 1) {
    return chineseChars.slice(0, 2).join('');
  }
  const letters = name.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
  return letters || roleLabels[role]?.[0] || 'U';
}

const roleLabels: Record<string, string> = {
  admin: '管理员',
  agent: '坐席',
  observer: '观察者',
};

// Default status config (can be overridden via props)
const defaultStatusConfig: Record<string, { label: string; color: string; bgColor: string; ringColor: string; pulse: boolean }> = {
  online: {
    label: '在线',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-500',
    ringColor: 'ring-green-500/50',
    pulse: true,
  },
  away: {
    label: '离开',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-500',
    ringColor: 'ring-yellow-500/50',
    pulse: false,
  },
  offline: {
    label: '离线',
    color: 'text-gray-400 dark:text-gray-500',
    bgColor: 'bg-gray-400 dark:bg-gray-600',
    ringColor: 'ring-gray-400/30',
    pulse: false,
  },
};

const sizeClasses = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
};

const statusDotSizes = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3.5 h-3.5',
  lg: 'w-4 h-4',
};

/**
 * Reusable user avatar with tooltip and optional status indicator
 * Eliminates duplicated Tooltip blocks across app-layout.tsx
 */
export function UserAvatarTooltip({
  user,
  size = 'md',
  showStatus = true,
  statusConfig = defaultStatusConfig,
}: UserAvatarTooltipProps) {
  const config = statusConfig[user.agentStatus || ''] || defaultStatusConfig[user.agentStatus || ''] || {
    label: '',
    color: '',
    bgColor: 'bg-gray-400',
    ringColor: 'ring-gray-400/30',
    pulse: false,
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative inline-block">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className={cn(
                'rounded-full object-cover',
                sizeClasses[size],
              )}
            />
          ) : (
            <div
              className={cn(
                'rounded-full bg-primary flex items-center justify-center font-medium text-primary-foreground',
                sizeClasses[size],
              )}
            >
              {getUserInitials(user.name, user.role)}
            </div>
          )}
          {showStatus && user.agentStatus && (
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-card cursor-help',
                statusDotSizes[size],
                config.bgColor,
                config.ringColor,
                config.pulse && 'animate-pulse',
              )}
            />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p className="text-xs">{user.name}</p>
        {user.agentStatus && (
          <p className="text-xs opacity-70">坐席状态: {config.label}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
