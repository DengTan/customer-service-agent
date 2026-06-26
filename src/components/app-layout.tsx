'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Monitor,
  Clock,
  BookOpen,
  Settings,
  Bot,
  BarChart3,
  Users,
  Shield,
  Headphones,
  ClipboardCheck,
  Megaphone,
  Ticket,
  FlaskConical,
  LogOut,
  User as UserIcon,
  ChevronDown,
} from 'lucide-react';
import { useAuth, useIsAuthenticated } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: '数据分析', icon: BarChart3, roles: ['admin', 'agent', 'observer'] },
  { href: '/', label: '对话监控', icon: Monitor, roles: ['admin', 'agent', 'observer'] },
  { href: '/simulation', label: '模拟测试', icon: FlaskConical, roles: ['admin', 'agent', 'observer'] },
  { href: '/workspace', label: '坐席工作台', icon: Headphones, roles: ['admin', 'agent'] },
  { href: '/history', label: '对话历史', icon: Clock, roles: ['admin', 'agent', 'observer'] },
  { href: '/customers', label: '客户管理', icon: Users, roles: ['admin', 'agent'] },
  { href: '/tickets', label: '工单管理', icon: Ticket, roles: ['admin', 'agent'] },
  { href: '/faq', label: '知识库', icon: BookOpen, roles: ['admin', 'agent'] },
  { href: '/marketing', label: '营销管理', icon: Megaphone, roles: ['admin', 'agent'] },
  { href: '/quality', label: '质检管理', icon: ClipboardCheck, roles: ['admin', 'agent'] },
  { href: '/team', label: '团队管理', icon: Shield, roles: ['admin'] },
  { href: '/settings', label: '系统设置', icon: Settings, roles: ['admin'] },
];

const roleLabels: Record<string, string> = {
  admin: '管理员',
  agent: '坐席',
  observer: '观察者',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const isAuthenticated = useIsAuthenticated();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border flex flex-col bg-card shrink-0">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-5 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Bot className="w-4.5 h-4.5 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold text-foreground">SmartAssist</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-3">
          {visibleNavItems.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 mb-0.5",
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-primary rounded-r-full nav-item-active-bar" />
                )}
                <Icon className={cn("w-4.5 h-4.5 transition-transform duration-200", !isActive && "group-hover:scale-110")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User Info Footer */}
        {user && (
          <div className="p-3 border-t border-border">
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserIcon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{roleLabels[user.role] || user.role}</div>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", showUserMenu && "rotate-180")} />
              </button>

              {/* User Menu Dropdown */}
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-2 p-1 bg-background border border-border rounded-lg shadow-lg z-50">
                    <div className="px-3 py-2 border-b border-border mb-1">
                      <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                    </div>
                    <button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
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
