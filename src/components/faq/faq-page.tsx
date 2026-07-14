'use client';

import { useState, Suspense, lazy } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { TabType } from './types';

// Lazy load tab components for code splitting
const KnowledgeTab = lazy(() => import('./knowledge-tab').then(m => ({ default: m.KnowledgeTab })));
const ProductsTab = lazy(() => import('./products-tab').then(m => ({ default: m.ProductsTab })));
const SizeChartsTab = lazy(() => import('./size-charts-tab').then(m => ({ default: m.SizeChartsTab })));
const LearningTab = lazy(() => import('./learning-tab').then(m => ({ default: m.LearningTab })));
const SearchTestTab = lazy(() => import('./search-test-tab').then(m => ({ default: m.SearchTestTab })));

// Loading skeleton for tab content
function TabSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-48 w-full" />
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

  return (
    <div className="h-full flex flex-col page-transition">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center gap-6 bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">知识库</h1>
        {/* Tab switch */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'knowledge'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            知识库
          </button>
          <button
            onClick={() => setActiveTab('learning')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'learning'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            知识自学习
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'products'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            商品详情
          </button>
          <button
            onClick={() => setActiveTab('size_charts')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'size_charts'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            尺码配置
          </button>
          <button
            onClick={() => setActiveTab('search_test')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'search_test'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            检索测试
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        <TabContent tab={activeTab} />
      </div>
    </div>
  );
}
