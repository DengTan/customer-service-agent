'use client';

import { useState, Suspense, lazy } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { TabType } from './types';
import { BookOpen, GraduationCap, Package, Ruler, TestTube2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// Lazy load tab components for code splitting
const KnowledgeTab = lazy(() => import('./knowledge-tab').then(m => ({ default: m.KnowledgeTab })));
const ProductsTab = lazy(() => import('./products-tab').then(m => ({ default: m.ProductsTab })));
const SizeChartsTab = lazy(() => import('./size-charts-tab').then(m => ({ default: m.SizeChartsTab })));
const LearningTab = lazy(() => import('./learning-tab').then(m => ({ default: m.LearningTab })));
const SearchTestTab = lazy(() => import('./search-test-tab').then(m => ({ default: m.SearchTestTab })));

const TABS: Array<{
  value: TabType;
  label: string;
  icon: React.ReactNode;
  description: string;
  accent: string;
}> = [
  {
    value: 'knowledge',
    label: '知识库',
    icon: <BookOpen className="w-3.5 h-3.5" />,
    description: '管理知识条目',
    accent: 'from-primary/15 to-primary/5',
  },
  {
    value: 'learning',
    label: '知识自学习',
    icon: <GraduationCap className="w-3.5 h-3.5" />,
    description: '自动提取候选 QA',
    accent: 'from-amber-500/15 to-amber-500/5',
  },
  {
    value: 'products',
    label: '商品详情',
    icon: <Package className="w-3.5 h-3.5" />,
    description: '商品信息管理',
    accent: 'from-emerald-500/15 to-emerald-500/5',
  },
  {
    value: 'size_charts',
    label: '尺码配置',
    icon: <Ruler className="w-3.5 h-3.5" />,
    description: '尺码表与推荐',
    accent: 'from-violet-500/15 to-violet-500/5',
  },
  {
    value: 'search_test',
    label: '检索测试',
    icon: <TestTube2 className="w-3.5 h-3.5" />,
    description: '测试检索效果',
    accent: 'from-cyan-500/15 to-cyan-500/5',
  },
];

// Loading skeleton for tab content
function TabSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

// Tab loading wrapper with Suspense
function TabContent({ tab }: { tab: TabType }) {
  switch (tab) {
    case 'knowledge':
      return (
        <Suspense fallback={<TabSkeleton />}>
          <KnowledgeTab />
        </Suspense>
      );
    case 'products':
      return (
        <Suspense fallback={<TabSkeleton />}>
          <ProductsTab />
        </Suspense>
      );
    case 'size_charts':
      return (
        <Suspense fallback={<TabSkeleton />}>
          <SizeChartsTab />
        </Suspense>
      );
    case 'learning':
      return (
        <Suspense fallback={<TabSkeleton />}>
          <LearningTab />
        </Suspense>
      );
    case 'search_test':
      return (
        <Suspense fallback={<TabSkeleton />}>
          <SearchTestTab />
        </Suspense>
      );
    default:
      return null;
  }
}

export function FaqPage() {
  return (
    <ErrorBoundary>
      <FaqPageInner />
    </ErrorBoundary>
  );
}

function FaqPageInner() {
  const [activeTab, setActiveTab] = useState<TabType>('knowledge');
  const activeTabInfo = TABS.find(t => t.value === activeTab) || TABS[0];

  return (
    <div className="h-full flex flex-col page-transition">
      {/* Header */}
      <div className="relative h-16 border-b border-border/60 px-6 flex items-center gap-5 bg-card shrink-0 overflow-hidden">
        {/* Decorative gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary/3 via-transparent to-transparent pointer-events-none" />

        {/* Title */}
        <div className="relative flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
            <BookOpen className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground leading-tight">知识库</h1>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">Knowledge Base</p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-border/60 shrink-0" />

        {/* Tab switch */}
        <div className="relative flex items-center gap-1 bg-muted/40 rounded-xl p-1 ring-1 ring-border/40">
          {TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                activeTab === tab.value
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/40',
              )}
            >
              <span className={cn(
                'transition-colors',
                activeTab === tab.value && activeTabInfo.value === 'learning' && 'text-amber-600 dark:text-amber-400',
                activeTab === tab.value && activeTabInfo.value === 'products' && 'text-emerald-600 dark:text-emerald-400',
                activeTab === tab.value && activeTabInfo.value === 'size_charts' && 'text-violet-600 dark:text-violet-400',
                activeTab === tab.value && activeTabInfo.value === 'search_test' && 'text-cyan-600 dark:text-cyan-400',
              )}>
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Active tab description */}
        <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 border border-border/40 shrink-0">
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="text-[11px] text-muted-foreground">{activeTabInfo.description}</span>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
        <TabContent tab={activeTab} />
      </div>
    </div>
  );
}