'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Search,
  Trash2,
  Loader2,
  RefreshCw,
  Sparkles,
  Sliders,
  Eye,
  ArrowUpDown,
  Keyboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchRequest {
  query: string;
  mode: 'vector' | 'hybrid';
  minScore: number;
  limit: number;
  showFiltered: boolean;
  rerankEnabled: boolean;
}

interface SearchTestPanelProps {
  onSearch: (req: SearchRequest) => void;
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
  const [rerankEnabled, setRerankEnabled] = useState(false);

  const handleSearch = () => {
    if (!query.trim()) return;
    onSearch({ query: query.trim(), mode, minScore, limit, showFiltered, rerankEnabled });
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

  const sectionClass =
    'rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2.5 transition-colors hover:border-border/70';

  return (
    <div className="space-y-4">
      {/* Query Input */}
      <section className={sectionClass}>
        <Label htmlFor="query" className="text-sm font-medium flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          检索问题
        </Label>
        <div className="relative">
          <Textarea
            id="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，如：如何申请退货？"
            className="min-h-[88px] pr-24 pb-9 resize-none bg-background"
            disabled={loading}
          />
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
              <Keyboard className="w-3 h-3" />
              Ctrl+Enter 快速搜索
            </span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {query.length > 0 && (
                <span className="tabular-nums">{query.length} 字</span>
              )}
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5 opacity-60" />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Search Mode */}
      <section className={sectionClass}>
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
          搜索模式
        </Label>
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/60 border border-border/40">
          <Button
            variant={mode === 'hybrid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('hybrid')}
            disabled={loading}
            className={cn(
              'justify-center transition-all border-0 shadow-none',
              mode === 'hybrid'
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            混合搜索
          </Button>
          <Button
            variant={mode === 'vector' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('vector')}
            disabled={loading}
            className={cn(
              'justify-center transition-all border-0 shadow-none',
              mode === 'vector'
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Search className="w-3.5 h-3.5 mr-1.5" />
            向量搜索
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {mode === 'hybrid'
            ? '混合搜索：向量 + BM25 + RRF 融合，可选重排序精排'
            : '向量搜索：仅基于语义向量相似度匹配'}
        </p>
      </section>

      {/* Parameters */}
      <section className={sectionClass}>
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
          检索参数
        </Label>
        <div className="grid grid-cols-2 gap-4 pt-1">
          {/* Min Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="minScore" className="text-xs text-muted-foreground">
                最低分数
              </Label>
              <span className="text-xs font-mono tabular-nums rounded bg-primary/10 text-primary px-1.5 py-0.5">
                {minScore.toFixed(2)}
              </span>
            </div>
            <Slider
              id="minScore"
              min={0}
              max={1}
              step={0.05}
              value={[minScore]}
              onValueChange={(value) => setMinScore(value[0])}
              disabled={loading}
              className="py-1"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/80 tabular-nums">
              <span>0.0</span>
              <span>0.75</span>
              <span>1.0</span>
            </div>
          </div>

          {/* Limit */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="limit" className="text-xs text-muted-foreground">
                返回数量
              </Label>
              <span className="text-xs font-mono tabular-nums rounded bg-primary/10 text-primary px-1.5 py-0.5">
                {limit}
              </span>
            </div>
            <Slider
              id="limit"
              min={1}
              max={20}
              step={1}
              value={[limit]}
              onValueChange={(value) => setLimit(value[0])}
              disabled={loading}
              className="py-1"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/80 tabular-nums">
              <span>1</span>
              <span>10</span>
              <span>20</span>
            </div>
          </div>
        </div>
      </section>

      {/* Toggles */}
      <section className={sectionClass}>
        <Label className="text-sm font-medium flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
          显示与排序
        </Label>

        {/* Show Filtered */}
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-md px-2 py-1.5 -mx-2',
            'hover:bg-background/60 transition-colors cursor-pointer'
          )}
        >
          <input
            type="checkbox"
            id="showFiltered"
            checked={showFiltered}
            onChange={(e) => setShowFiltered(e.target.checked)}
            disabled={loading}
            className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30 transition"
          />
          <Label htmlFor="showFiltered" className="text-sm cursor-pointer flex-1">
            显示被过滤的候选结果
          </Label>
        </div>

        {/* Rerank Switch (hybrid mode only) */}
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-md px-2 py-1.5 -mx-2',
            'hover:bg-background/60 transition-colors',
            mode === 'vector' && 'opacity-60'
          )}
        >
          <Switch
            id="rerankEnabled"
            checked={rerankEnabled}
            onCheckedChange={setRerankEnabled}
            disabled={loading || mode === 'vector'}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <Label
              htmlFor="rerankEnabled"
              className={cn(
                'text-sm flex items-center gap-1.5',
                mode === 'vector' ? 'cursor-not-allowed' : 'cursor-pointer'
              )}
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
              启用重排序（Rerank）
            </Label>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              {mode === 'vector'
                ? '仅在「混合搜索」模式下可用'
                : rerankEnabled
                  ? '使用 cross-encoder 对融合结果精排'
                  : '跳过重排序，直接使用 RRF 融合分数'}
            </p>
          </div>
        </div>
      </section>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="flex-1 shadow-none"
          size="default"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              搜索中…
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              开始测试
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          onClick={handleClear}
          disabled={loading || (!query.trim() && !hasResults)}
          className="px-4 hover:bg-muted"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          清空
        </Button>
      </div>
    </div>
  );
}