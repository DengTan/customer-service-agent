'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Search, Trash2, Loader2, RefreshCw } from 'lucide-react';

interface SearchTestPanelProps {
  onSearch: (query: string, mode: 'vector' | 'hybrid', minScore: number, limit: number, showFiltered: boolean) => void;
  onClear: () => void;
  loading: boolean;
  hasResults: boolean;
}

export function SearchTestPanel({
  onSearch,
  onClear,
  loading,
  hasResults,
}: SearchTestPanelProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'vector' | 'hybrid'>('hybrid');
  const [minScore, setMinScore] = useState(0.75);
  const [limit, setLimit] = useState(5);
  const [showFiltered, setShowFiltered] = useState(true);

  const handleSearch = () => {
    if (!query.trim()) return;
    onSearch(query.trim(), mode, minScore, limit, showFiltered);
  };

  const handleClear = () => {
    setQuery('');
    onClear();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSearch();
    }
  };

  return (
    <div className="space-y-4">
      {/* Query Input */}
      <div className="space-y-2">
        <Label htmlFor="query">检索问题</Label>
        <div className="relative">
          <Textarea
            id="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，如：如何申请退货？"
            className="min-h-[80px] pr-20 resize-none"
            disabled={loading}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {query.length > 0 && (
              <span className="text-xs text-muted-foreground mr-2">
                {query.length} 字
              </span>
            )}
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <Search className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          按 Ctrl+Enter 快速搜索
        </p>
      </div>

      {/* Search Mode */}
      <div className="space-y-2">
        <Label>搜索模式</Label>
        <div className="flex gap-2">
          <Button
            variant={mode === 'hybrid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('hybrid')}
            disabled={loading}
            className="flex-1"
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            混合搜索
          </Button>
          <Button
            variant={mode === 'vector' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('vector')}
            disabled={loading}
            className="flex-1"
          >
            <Search className="w-3 h-3 mr-1" />
            向量搜索
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === 'hybrid'
            ? '混合搜索：向量 + BM25 + RRF融合 + 重排序'
            : '向量搜索：仅使用语义向量相似度匹配'}
        </p>
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-2 gap-4">
        {/* Min Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="minScore">最低分数</Label>
            <span className="text-sm font-mono text-primary">{minScore.toFixed(2)}</span>
          </div>
          <Slider
            id="minScore"
            min={0}
            max={1}
            step={0.05}
            value={[minScore]}
            onValueChange={(value) => setMinScore(value[0])}
            disabled={loading}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.0</span>
            <span>0.75</span>
            <span>1.0</span>
          </div>
        </div>

        {/* Limit */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="limit">返回数量</Label>
            <span className="text-sm font-mono text-primary">{limit}</span>
          </div>
          <Slider
            id="limit"
            min={1}
            max={20}
            step={1}
            value={[limit]}
            onValueChange={(value) => setLimit(value[0])}
            disabled={loading}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1</span>
            <span>10</span>
            <span>20</span>
          </div>
        </div>
      </div>

      {/* Show Filtered Toggle */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="showFiltered"
          checked={showFiltered}
          onChange={(e) => setShowFiltered(e.target.checked)}
          disabled={loading}
          className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
        />
        <Label htmlFor="showFiltered" className="cursor-pointer">
          显示被过滤的候选结果
        </Label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        <Button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="flex-1"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              搜索中...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              开始测试
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={handleClear}
          disabled={loading || (!query.trim() && !hasResults)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          清空
        </Button>
      </div>
    </div>
  );
}
