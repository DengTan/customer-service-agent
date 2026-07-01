'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { SearchTestPanel } from './search-test-panel';
import { SearchResultsPanel, SearchResultsData } from './search-results-panel';
import { SearchAnalysisPanel } from './search-analysis-panel';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle } from 'lucide-react';

export function SearchTestTab() {
  const [loading, setLoading] = useState(false);
  const [hasResults, setHasResults] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'vector' | 'hybrid'>('hybrid');
  const [minScore, setMinScore] = useState(0.75);
  const [results, setResults] = useState<SearchResultsData | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = useCallback(async (
    searchQuery: string,
    searchMode: 'vector' | 'hybrid',
    searchMinScore: number,
    limit: number,
    showFiltered: boolean
  ) => {
    setLoading(true);
    setQuery(searchQuery);
    setMode(searchMode);
    setMinScore(searchMinScore);

    try {
      const response = await fetch('/api/knowledge/test-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: searchQuery,
          mode: searchMode,
          min_score: searchMinScore,
          limit,
          show_filtered: showFiltered,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '搜索请求失败');
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || '搜索失败');
      }

      setResults(data);
      setHasResults(true);
      setSearchError(null);
      toast.success(`找到 ${data.total} 条相关结果，耗时 ${data.execution_time_ms}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '搜索失败，请稍后重试';
      toast.error(message);
      setResults(null);
      setHasResults(false);
      setSearchError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults(null);
    setHasResults(false);
    setMode('hybrid');
    setMinScore(0.75);
  }, []);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">检索测试</h2>
        <p className="text-sm text-muted-foreground">
          输入问题并测试知识库检索效果，查看哪些知识会被命中以及为什么。
        </p>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Search Panel */}
        <div className="col-span-12 lg:col-span-4">
          <Card className="p-4 sticky top-6">
            <SearchTestPanel
              onSearch={handleSearch}
              onClear={handleClear}
              loading={loading}
              hasResults={hasResults}
            />
          </Card>
        </div>

        {/* Right: Results & Analysis */}
        <div className="col-span-12 lg:col-span-8">
          <Tabs defaultValue="results" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="results" className="gap-2">
                检索结果
                {results && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                    {results.total}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="analysis" className="gap-2">
                详细分析
              </TabsTrigger>
            </TabsList>

            <TabsContent value="results" className="mt-0">
              {searchError ? (
                <Card className="p-6">
                  <div className="flex items-center gap-3 text-destructive">
                    <AlertCircle className="w-5 h-5" />
                    <div>
                      <p className="font-medium">搜索出错</p>
                      <p className="text-sm text-muted-foreground">{searchError}</p>
                    </div>
                  </div>
                </Card>
              ) : (
                <SearchResultsPanel
                  data={results}
                  query={query}
                  loading={loading}
                  minScore={minScore}
                />
              )}
            </TabsContent>

            <TabsContent value="analysis" className="mt-0">
              <SearchAnalysisPanel
                data={results}
                mode={mode}
                query={query}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
