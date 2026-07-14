'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Database, 
  Binary, 
  GitMerge, 
  Sparkles,
  TrendingUp,
  BarChart3,
  RefreshCw,
  CheckCircle2,
  XCircle
} from 'lucide-react';

interface SearchResultsData {
  results: Array<{
    id: string;
    content: string;
    score: number;
    name?: string;
    category?: string;
    source?: string;
    filterReason?: string;
  }>;
  total: number;
  execution_time_ms: number;
  vector_results?: number;
  bm25_results?: number;
  rerank_applied?: boolean;
  avg_score?: number;
  error?: string;
  filtered?: {
    total: number;
    items: Array<{
      id: string;
      content: string;
      score: number;
      filterReason?: string;
      name?: string;
      category?: string;
    }>;
  };
  termAnalysis?: {
    queryTerms: string[];
    matchedTerms: string[];
    unmatchedTerms: string[];
  };
}

interface SearchAnalysisPanelProps {
  data: SearchResultsData | null;
  mode: 'vector' | 'hybrid';
  query: string;
}

export function SearchAnalysisPanel({ data, mode, query }: SearchAnalysisPanelProps) {
  if (!data) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        执行搜索后查看分析数据
      </div>
    );
  }

  const vectorCount = data.vector_results || 0;
  const bm25Count = data.bm25_results || 0;
  const totalCandidates = vectorCount + bm25Count;
  const finalCount = data.results.length;
  const filteredCount = data.filtered?.total || (totalCandidates - finalCount);

  return (
    <div className="space-y-4">
      {/* Mode Badge */}
      <div className="flex items-center gap-2">
        <Badge variant={mode === 'hybrid' ? 'default' : 'secondary'} className="text-xs">
          {mode === 'hybrid' ? (
            <>
              <GitMerge className="w-3 h-3 mr-1" />
              混合搜索模式
            </>
          ) : (
            <>
              <Database className="w-3 h-3 mr-1" />
              向量搜索模式
            </>
          )}
        </Badge>
      </div>

      {/* Pipeline Flow */}
      {mode === 'hybrid' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              检索流水线
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Database className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="font-medium">向量检索</div>
                  <div className="text-xs text-muted-foreground">
                    {vectorCount} 条候选
                  </div>
                </div>
              </div>
              <div className="text-muted-foreground">+</div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                  <Binary className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <div className="font-medium">BM25检索</div>
                  <div className="text-xs text-muted-foreground">
                    {bm25Count} 条候选
                  </div>
                </div>
              </div>
              <div className="text-muted-foreground">→</div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                  <GitMerge className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <div className="font-medium">RRF融合</div>
                  <div className="text-xs text-muted-foreground">
                    {totalCandidates} 条合并
                  </div>
                </div>
              </div>
              {data.rerank_applied && (
                <>
                  <div className="text-muted-foreground">→</div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <div className="font-medium">重排序</div>
                      <div className="text-xs text-muted-foreground">
                        精排
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-primary">{finalCount}</div>
            <div className="text-xs text-muted-foreground">最终结果</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">{filteredCount}</div>
            <div className="text-xs text-muted-foreground">被过滤</div>
          </CardContent>
        </Card>
      </div>

      {/* Term Analysis */}
      {data.termAnalysis && data.termAnalysis.queryTerms.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              关键词命中分析
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Matched Terms */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                  <span className="text-xs font-medium text-green-600">
                    命中 ({data.termAnalysis.matchedTerms.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.termAnalysis.matchedTerms.length > 0 ? (
                    data.termAnalysis.matchedTerms.map((term) => (
                      <Badge
                        key={term}
                        variant="secondary"
                        className="text-xs bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200"
                      >
                        {term}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">无</span>
                  )}
                </div>
              </div>

              <Separator />

              {/* Unmatched Terms */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-3 h-3 text-red-600" />
                  <span className="text-xs font-medium text-red-600">
                    未命中 ({data.termAnalysis.unmatchedTerms.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.termAnalysis.unmatchedTerms.length > 0 ? (
                    data.termAnalysis.unmatchedTerms.map((term) => (
                      <Badge
                        key={term}
                        variant="outline"
                        className="text-xs opacity-60"
                      >
                        {term}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">无</span>
                  )}
                </div>
              </div>

              {/* Hit Rate */}
              {data.termAnalysis.queryTerms.length > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">关键词命中率</span>
                    <span className="font-medium">
                      {Math.round((data.termAnalysis.matchedTerms.length / data.termAnalysis.queryTerms.length) * 100)}%
                    </span>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            性能指标
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">执行时间</span>
              <span className="font-mono">{data.execution_time_ms}ms</span>
            </div>
            {data.avg_score !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">平均分数</span>
                <span className="font-mono">{data.avg_score.toFixed(3)}</span>
              </div>
            )}
            {mode === 'hybrid' && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">重排序</span>
                  <span className={data.rerank_applied ? 'text-green-600' : 'text-muted-foreground'}>
                    {data.rerank_applied ? '已启用' : '已跳过'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">向量召回</span>
                  <span className="font-mono">{vectorCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">BM25召回</span>
                  <span className="font-mono">{bm25Count}</span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
