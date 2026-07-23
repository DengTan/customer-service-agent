'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  Clock,
  BookOpen,
  Settings,
  BarChart3,
  Users,
  Shield,
  Headphones,
  ClipboardCheck,
  Megaphone,
  Ticket,
  FlaskConical,
  LogOut,
  ChevronDown,
  Bell,
  CheckCircle,
  Bot,
  UserCog,
  Scale,
  Copy,
  Check,
} from 'lucide-react';
import { useAuth, useIsAuthenticated } from '@/lib/auth';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { UserAvatarTooltip } from '@/components/common/user-avatar-tooltip';

const navItems = [
  { href: '/dashboard', label: '数据分析', icon: BarChart3, roles: ['admin', 'agent', 'observer'], shortcut: '1' },
  { href: '/eval', label: '评估', icon: Scale, roles: ['admin'], shortcut: '2' },
  { href: '/', label: '对话监控', icon: Monitor, roles: ['admin', 'agent', 'observer'], shortcut: '3' },
  { href: '/simulation', label: '模拟测试', icon: FlaskConical, roles: ['admin', 'agent', 'observer'], shortcut: '4' },
  { href: '/workspace', label: '坐席工作台', icon: Headphones, roles: ['admin', 'agent'], shortcut: '5' },
  { href: '/history', label: '对话历史', icon: Clock, roles: ['admin', 'agent', 'observer'], shortcut: '6' },
  { href: '/customers', label: '客户管理', icon: Users, roles: ['admin', 'agent'], shortcut: '7' },
  { href: '/tickets', label: '工单管理', icon: Ticket, roles: ['admin', 'agent'], shortcut: '8' },
  { href: '/faq', label: '知识库', icon: BookOpen, roles: ['admin', 'agent'], shortcut: '9' },
  { href: '/marketing', label: '营销管理', icon: Megaphone, roles: ['admin', 'agent'], shortcut: '0' },
  { href: '/quality', label: '质检管理', icon: ClipboardCheck, roles: ['admin', 'agent'] },
  { href: '/team', label: '团队管理', icon: Shield, roles: ['admin'] },
  { href: '/settings', label: '系统设置', icon: Settings, roles: ['admin'] },
];

const roleLabels: Record<string, string> = {
  admin: '管理员',
  agent: '坐席',
  observer: '观察者',
};

// Status indicator configuration with visual effects
const statusConfig: Record<string, { label: string; color: string; bgColor: string; ringColor: string; pulse: boolean }> = {
  online: { 
    label: '在线', 
    color: 'text-green-600 dark:text-green-400', 
    bgColor: 'bg-green-500', 
    ringColor: 'ring-green-500/50',
    pulse: true 
  },
  away: { 
    label: '离开', 
    color: 'text-yellow-600 dark:text-yellow-400', 
    bgColor: 'bg-yellow-500', 
    ringColor: 'ring-yellow-500/50',
    pulse: false 
  },
  offline: { 
    label: '离线', 
    color: 'text-gray-400 dark:text-gray-500', 
    bgColor: 'bg-gray-400 dark:bg-gray-600', 
    ringColor: 'ring-gray-400/30',
    pulse: false 
  },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, refreshUser } = useAuth();
  const isAuthenticated = useIsAuthenticated();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notificationCount, setNotificationCount] = useState<number | string>(0);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch unread notification count
  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      setNotificationsLoading(false);
      return;
    }

    const fetchNotifications = async () => {
      setNotificationsLoading(true);
      try {
        const res = await fetch('/api/alerts?resolved=false&limit=1', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          // Get total count from headers if available
          const total = data.total || 0;
          setNotificationCount(total > 99 ? '99+' : total);
        }
      } catch {
        // Silently fail
      } finally {
        setNotificationsLoading(false);
      }
    };

    fetchNotifications();
    // Refresh every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Filter nav items based on user role
  const visibleNavItems = navItems.filter(item => {
    if (!user) return false;
    return item.roles.includes(user.role);
  });

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.push('/login');
      router.refresh();
    } finally {
      setLoggingOut(false);
      setShowUserMenu(false);
    }
  };

  const toggleMenu = useCallback(() => {
    setShowUserMenu(prev => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setShowUserMenu(false);
    menuButtonRef.current?.focus();
  }, []);

  // Keyboard navigation (menu + shortcuts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+Number shortcuts for navigation
      if (e.altKey) {
        const shortcutMap: Record<string, string> = {
          '1': '/dashboard',
          '2': '/eval',
          '3': '/',
          '4': '/simulation',
          '5': '/workspace',
          '6': '/history',
          '7': '/customers',
          '8': '/tickets',
          '9': '/faq',
          '0': '/marketing',
        };
        const href = shortcutMap[e.key];
        if (href && visibleNavItems.some(item => item.href === href)) {
          e.preventDefault();
          router.push(href);
          return;
        }
      }

      // Menu keyboard navigation
      if (!showUserMenu) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          closeMenu();
          break;
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          const firstItem = menuRef.current?.querySelector<HTMLElement>('button, [role="menuitem"]');
          firstItem?.focus();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showUserMenu, closeMenu, router, visibleNavItems]);

  // Close menu on click outside
  useEffect(() => {
    if (!showUserMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuButtonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu, closeMenu]);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border flex flex-col bg-card shrink-0">
        {/* Logo & Header */}
        <div className="h-14 flex items-center justify-between gap-3 px-4 border-b border-border">
          {/* Logo */}
          <div className="flex items-center gap-2.5 group">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/90 to-primary shadow-sm shadow-primary/20 flex items-center justify-center transition-transform group-hover:scale-105">
                <Bot className="w-5 h-5 text-primary-foreground" />
              </div>
              {/* Online indicator dot */}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-card" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground tracking-tight leading-none">SmartAssist</span>
              <span className="text-[10px] text-muted-foreground/60 font-medium leading-none mt-0.5">v2.0</span>
            </div>
          </div>
          
          {/* Right actions */}
          {user && (user.role === 'admin' || user.role === 'agent') && (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="relative p-1.5 rounded-md hover:bg-muted/80 transition-all duration-150 active:scale-95"
                  >
                    <Bell className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
                    {notificationsLoading ? (
                      // Show subtle loading indicator during initial load to prevent UI shift
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-500 text-[10px] font-semibold text-white shadow-sm animate-pulse">
                        •
                      </span>
                    ) : notificationCount && notificationCount !== '0' ? (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-500 text-[10px] font-semibold text-white shadow-sm">
                        {notificationCount}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={6}>
                  <p className="text-xs">
                    {notificationsLoading
                      ? '加载中...'
                      : notificationCount && notificationCount !== '0'
                      ? `有 ${notificationCount} 条未处理告警`
                      : '暂无未处理告警'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-3">
          {visibleNavItems.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 mb-0.5",
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                          >
                        <Icon className={cn("w-4.5 h-4.5 transition-transform duration-200 shrink-0", !isActive && "group-hover:scale-110")} />
                        <span className="flex-1 truncate">{item.label}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8} className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100">
                      <div className="flex items-center gap-1">
                        <span className="text-xs">跳转到「{item.label}」</span>
                        <kbd className="ml-1 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 text-xs font-mono font-semibold text-blue-700 dark:text-blue-200">Alt+{item.shortcut}</kbd>
                      </div>
                    </TooltipContent>
                  </Tooltip>
            );
          })}
        </nav>

        {/* User Info Footer */}
        {user && (
          <div className="p-3 border-t border-border">
            <div className="relative">
              <button
                ref={menuButtonRef}
                onClick={toggleMenu}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleMenu();
                  } else if (e.key === 'Escape' && showUserMenu) {
                    closeMenu();
                  }
                }}
                aria-expanded={showUserMenu}
                aria-haspopup="menu"
                aria-label={`${user.name}，${roleLabels[user.role] || user.role}，点击打开菜单`}
                className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="relative">
                  <UserAvatarTooltip
                    user={{
                      name: user.name,
                      avatar: user.avatar,
                      role: user.role,
                      agentStatus: user.agentStatus,
                    }}
                    size="md"
                    statusConfig={statusConfig}
                  />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-semibold truncate">{user.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/50 text-[11px] font-medium">
                      {roleLabels[user.role] || user.role}
                    </span>
                    {user.role === 'agent' && user.agentStatus && (
                      <span className={cn("inline-flex items-center gap-1 text-[10px]", statusConfig[user.agentStatus]?.color)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", statusConfig[user.agentStatus]?.bgColor)} />
                        {statusConfig[user.agentStatus]?.label}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", showUserMenu && "rotate-180")} />
              </button>

              {/* User Menu Dropdown */}
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={closeMenu} />
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label="用户菜单"
                    className="absolute bottom-full left-0 right-0 mb-2 p-1 bg-background border border-border rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-bottom-1 duration-200"
                  >
                    <div className="px-3 py-2 border-b border-border mb-1">
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(user.email);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          } catch {
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = user.email;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }
                        }}
                        className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        <span className="truncate flex-1">{user.email}</span>
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                      {user.agentStatus && (
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                          <span className="text-[10px] text-muted-foreground">坐席状态</span>
                          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium", user.agentStatus === 'online' ? 'bg-green-500/10 text-green-600' : user.agentStatus === 'away' ? 'bg-yellow-500/10 text-yellow-600' : 'bg-gray-500/10 text-gray-500')}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", statusConfig[user.agentStatus]?.bgColor)} />
                            {statusConfig[user.agentStatus]?.label}
                          </span>
                        </div>
                      )}
                    </div>
                    <Link
                      href="/settings?tab=profile"
                      role="menuitem"
                      onClick={closeMenu}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:bg-muted"
                    >
                      <UserCog className="w-4 h-4" />
                      个人设置
                    </Link>
                    {user.role === 'agent' && (
                      <button
                        onClick={async () => {
                          await refreshUser?.();
                          closeMenu();
                        }}
                        role="menuitem"
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:bg-muted"
                      >
                        <CheckCircle className="w-4 h-4" />
                        刷新状态
                      </button>
                    )}
                    <div className="h-px bg-border my-1" />
                    <button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:bg-destructive/10"
                    >
                      <LogOut className="w-4 h-4" />
                      {loggingOut ? '退出中...' : '退出登录'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* System Status Footer - only show if no user */}
        {!user && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              系统运行中
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
