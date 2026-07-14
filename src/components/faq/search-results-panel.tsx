'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileText, ChevronDown, ChevronRight, Clock, CheckCircle2 } from 'lucide-react';

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  name?: string;
  category?: string;
  source?: string;
  filterReason?: string;
  isFiltered?: boolean;
}

export interface FilteredResult {
  id: string;
  content: string;
  score: number;
  name?: string;
  category?: string;
  source?: string;
  filterReason: string;
  isFiltered: true;
}

export interface SearchResultsData {
  results: SearchResult[];
  total: number;
  execution_time_ms: number;
  vector_results?: number;
  bm25_results?: number;
  rerank_applied?: boolean;
  avg_score?: number;
  error?: string;
  filtered?: {
    total: number;
    items: SearchResult[];
  };
  termAnalysis?: {
    queryTerms: string[];
    matchedTerms: string[];
    unmatchedTerms: string[];
  };
}

interface SearchResultsPanelProps {
  data: SearchResultsData | null;
  query: string;
  loading: boolean;
  minScore: number;
}

function highlightTerms(text: string, terms: string[]): React.ReactNode {
  if (!terms || terms.length === 0) return text;

  const pattern = terms
    .filter(t => t.length >= 2)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  if (!pattern) return text;

  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) => {
    const isMatch = terms.some(t => t.toLowerCase() === part.toLowerCase());
    return isMatch ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

function getScoreColor(score: number, minScore: number): string {
  if (score >= 0.85) return 'text-green-700 dark:text-green-400';
  if (score >= minScore) return 'text-emerald-700 dark:text-emerald-400';
  if (score >= 0.6) return 'text-amber-700 dark:text-amber-400';
  return 'text-red-700 dark:text-red-400';
}

function getScoreBgColor(score: number, minScore: number): string {
  if (score >= 0.85) return 'bg-green-600';
  if (score >= minScore) return 'bg-emerald-600';
  if (score >= 0.6) return 'bg-amber-600';
  return 'bg-red-600';
}

function getSourceLabel(source?: string): string {
  switch (source) {
    case 'vector':
      return '向量';
    case 'bm25':
      return 'BM25';
    case 'hybrid':
      return '混合';
    default:
      return source || '未知';
  }
}

function getSourceVariant(source?: string): 'default' | 'secondary' | 'outline' {
  switch (source) {
    case 'vector':
      return 'secondary';
    case 'bm25':
      return 'outline';
    case 'hybrid':
      return 'default';
    default:
      return 'outline';
  }
}

function ResultItem({
  result,
  index,
  queryTerms,
  minScore,
}: {
  result: SearchResult;
  index: number;
  queryTerms: string[];
  minScore: number;
}) {
  const scorePercent = Math.round(result.score * 100);
  const isPassed = result.score >= minScore;

  return (
    <Card className={`mb-3 ${result.isFiltered ? 'opacity-70 border-dashed' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground font-mono">
                #{index + 1}
              </span>
              {result.name && (
                <span className="text-sm font-medium truncate">{result.name}</span>
              )}
              {result.isFiltered && (
                <Badge variant="outline" className="text-xs">
                  已过滤
                </Badge>
              )}
            </div>
            {result.category && (
              <span className="text-xs text-muted-foreground">
                {result.category}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-2">
              <Badge variant={getSourceVariant(result.source)} className="text-xs">
                [{getSourceLabel(result.source)}]
              </Badge>
            </div>
          </div>
        </div>

        {/* Score Bar */}
        <div className="flex items-center gap-2 mt-2">
          <Progress
            value={scorePercent}
            className={`h-2 flex-1 [&>div]:${getScoreBgColor(result.score, minScore)}`}
          />
          <span className={`text-sm font-mono font-semibold w-16 text-right ${getScoreColor(result.score, minScore)}`}>
            {result.score.toFixed(3)}
          </span>
        </div>

        {result.isFiltered && result.filterReason && (
          <p className="text-xs text-muted-foreground mt-1">
            {result.filterReason}
          </p>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        <div className="text-sm text-muted-foreground leading-relaxed">
          {highlightTerms(
            result.content.length > 300
              ? result.content.slice(0, 300) + '...'
              : result.content,
            queryTerms
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-medium text-muted-foreground mb-2">
        暂无搜索结果
      </h3>
      <p className="text-sm text-muted-foreground">
        输入问题并点击「开始测试」查看检索结果
      </p>
    </div>
  );
}

function SummaryBar({ data, query }: { data: SearchResultsData; query: string }) {
  return (
    <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg mb-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-primary" />
        <span className="text-sm">
          找到 <span className="font-semibold text-primary">{data.total}</span> 条相关结果
        </span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          耗时 <span className="font-mono">{data.execution_time_ms}</span>ms
        </span>
      </div>
      {data.avg_score !== undefined && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">
            平均分 <span className="font-mono">{data.avg_score.toFixed(3)}</span>
          </span>
        </>
      )}
    </div>
  );
}

export function SearchResultsPanel({ data, query, loading, minScore }: SearchResultsPanelProps) {
  const queryTerms = useMemo(() => {
    if (!query) return [];
    return query
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length >= 2)
      .slice(0, 20);
  }, [query]);

  const filteredResults = useMemo(() => {
    if (!data) return [];
    return data.filtered?.items || [];
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">正在检索知识库...</p>
        </div>
      </div>
    );
  }

  if (!data || data.results.length === 0) {
    return <EmptyState />;
  }

  const allResults = [
    ...data.results.map(r => ({ ...r, isFiltered: false })),
    ...filteredResults.map(r => ({ ...r, isFiltered: true })),
  ];

  return (
    <div className="space-y-4">
      <SummaryBar data={data} query={query} />

      {/* Term Analysis */}
      {data.termAnalysis && data.termAnalysis.queryTerms.length > 0 && (
        <div className="mb-4 p-3 bg-muted/30 rounded-lg">
          <div className="text-xs font-medium text-muted-foreground mb-2">关键词分析</div>
          <div className="flex flex-wrap gap-2">
            {data.termAnalysis.queryTerms.map((term) => {
              const isMatched = data.termAnalysis?.matchedTerms.includes(term);
              return (
                <Badge
                  key={term}
                  variant={isMatched ? 'default' : 'outline'}
                  className={`text-xs ${
                    isMatched
                      ? 'bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'opacity-50'
                  }`}
                >
                  {term}
                  {isMatched ? ' ✓' : ' ✗'}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <ScrollArea className="h-[calc(100vh-400px)]">
        {/* Passed Results */}
        {data.results.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">
                命中结果 ({data.results.length})
              </span>
            </div>
            {data.results.map((result, index) => (
              <ResultItem
                key={result.id}
                result={result}
                index={index}
                queryTerms={queryTerms}
                minScore={minScore}
              />
            ))}
          </div>
        )}

        {/* Filtered Results */}
        {filteredResults.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-600">
                被过滤候选 ({filteredResults.length})
              </span>
              <span className="text-xs text-muted-foreground">
                分数低于阈值 {minScore.toFixed(2)}
              </span>
            </div>
            {filteredResults.map((result, index) => (
              <ResultItem
                key={`filtered-${result.id}`}
                result={result}
                index={data.results.length + index}
                queryTerms={queryTerms}
                minScore={minScore}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
