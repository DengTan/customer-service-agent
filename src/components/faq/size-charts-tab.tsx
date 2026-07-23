'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, Pencil, Trash2,
  Ruler,
  ArrowDownCircle, ArrowUpCircle,
  BarChart3,
  RefreshCw,
  Shirt,
  Footprints,
  CircleDot,
  SlidersHorizontal,
  PlusCircle,
  TrendingUp,
  Layers,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SizeChartFormModal } from './size-chart-form-modal';
import { SizeChartItem } from './types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { cn } from '@/lib/utils';

const CHART_TYPE_ICONS: Record<string, React.ReactNode> = {
  clothing: <Shirt className="w-5 h-5" />,
  shoes: <Footprints className="w-5 h-5" />,
  accessories: <CircleDot className="w-5 h-5" />,
  custom: <SlidersHorizontal className="w-5 h-5" />,
};

const CHART_TYPE_LABELS: Record<string, string> = {
  clothing: '服装',
  shoes: '鞋类',
  accessories: '配饰',
  custom: '自定义',
};

const CHART_TYPE_STYLES: Record<string, string> = {
  clothing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 ring-blue-200 dark:ring-blue-800/50',
  shoes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ring-amber-200 dark:ring-amber-800/50',
  accessories: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 ring-violet-200 dark:ring-violet-800/50',
  custom: 'bg-muted text-muted-foreground',
};

export function SizeChartsTab() {
  const [sizeCharts, setSizeCharts] = useState<SizeChartItem[]>([]);
  const [sizeChartTotal, setSizeChartTotal] = useState(0);
  const [loadingSizeCharts, setLoadingSizeCharts] = useState(false);
  const [sizeChartSearch, setSizeChartSearch] = useState('');
  const [sizeChartFilterType, setSizeChartFilterType] = useState('');
  const [sizeChartFilterStatus, setSizeChartFilterStatus] = useState('');
  const [sizeChartTypes, setSizeChartTypes] = useState<Record<string, number>>({});
  const [showSizeChartModal, setShowSizeChartModal] = useState(false);
  const [editingSizeChart, setEditingSizeChart] = useState<SizeChartItem | null>(null);
  const [confirmToggleSizeChart, setConfirmToggleSizeChart] = useState<SizeChartItem | null>(null);

  const { confirm: confirmDialog } = useConfirmDialog();

  const fetchSizeCharts = useCallback(async () => {
    setLoadingSizeCharts(true);
    try {
      const params = new URLSearchParams();
      if (sizeChartSearch) params.set('search', sizeChartSearch);
      if (sizeChartFilterType) params.set('chart_type', sizeChartFilterType);
      if (sizeChartFilterStatus) params.set('status', sizeChartFilterStatus);
      const res = await fetch(`/api/knowledge/size-charts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSizeCharts(data.items || []);
      setSizeChartTotal(data.total || 0);
      setSizeChartTypes(data.chartTypes || {});
    } catch {
      toast.error('获取尺码表列表失败');
    } finally {
      setLoadingSizeCharts(false);
    }
  }, [sizeChartSearch, sizeChartFilterType, sizeChartFilterStatus]);

  useEffect(() => {
    fetchSizeCharts();
  }, [fetchSizeCharts]);

  const handleDeleteSizeChart = async (id: string) => {
    const confirmed = await confirmDialog({
      title: '删除尺码表',
      description: '确定要删除该尺码表吗？此操作无法撤销。',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/knowledge/size-charts?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '删除失败');
      toast.success('尺码表已删除');
      fetchSizeCharts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleSizeChartStatus = (chart: SizeChartItem) => {
    setConfirmToggleSizeChart(chart);
  };

  const confirmToggleSizeChartStatus = async () => {
    if (!confirmToggleSizeChart) return;
    const chart = confirmToggleSizeChart;
    const newStatus = chart.status === 'active' ? 'disabled' : 'active';
    setConfirmToggleSizeChart(null);
    try {
      const res = await fetch('/api/knowledge/size-charts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chart.id, status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`尺码表已${newStatus === 'active' ? '启用' : '禁用'}`);
      fetchSizeCharts();
    } catch {
      toast.error('状态更新失败');
    }
  };

  const activeCount = sizeCharts.filter(c => c.status === 'active').length;
  const totalReferences = sizeCharts.reduce((sum, c) => sum + (c.hit_count || 0), 0);

  return (
    <>
      <div className="p-6 space-y-5">
        {/* Stat Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-muted/20 p-4 group hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">尺码表总数</div>
                <div className="text-2xl font-bold text-foreground tabular-nums">{loadingSizeCharts ? '—' : sizeChartTotal}</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-emerald-50/60 to-transparent dark:from-emerald-950/20 p-4 group hover:border-emerald-300/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">启用中</div>
                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{loadingSizeCharts ? '—' : activeCount}</div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-amber-50/60 to-transparent dark:from-amber-950/20 p-4 group hover:border-amber-300/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <BarChart3 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">AI 总引用</div>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{loadingSizeCharts ? '—' : totalReferences}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border/60 bg-muted/20">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索尺码表..."
              value={sizeChartSearch}
              onChange={e => setSizeChartSearch(e.target.value)}
              className="w-full pl-8.5 pr-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
            />
          </div>
          <select
            value={sizeChartFilterType}
            onChange={e => setSizeChartFilterType(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors cursor-pointer"
          >
            <option value="">全部类型</option>
            <option value="clothing">服装</option>
            <option value="shoes">鞋类</option>
            <option value="accessories">配饰</option>
            <option value="custom">自定义</option>
          </select>
          <select
            value={sizeChartFilterStatus}
            onChange={e => setSizeChartFilterStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors cursor-pointer"
          >
            <option value="">全部状态</option>
            <option value="active">启用中</option>
            <option value="disabled">已禁用</option>
          </select>
          <button
            onClick={() => { setEditingSizeChart(null); setShowSizeChartModal(true); }}
            className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 active:scale-[0.97] transition-all shadow-sm shadow-primary/20"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            添加尺码表
          </button>
        </div>

        {/* Size chart list */}
        {loadingSizeCharts ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2.5" />
            加载中...
          </div>
        ) : sizeCharts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/10 flex items-center justify-center">
                <Ruler className="w-7 h-7 text-primary/60" />
              </div>
            </div>
            <h3 className="text-base font-semibold text-foreground/80 mb-1.5">暂无尺码表</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {sizeChartSearch || sizeChartFilterType || sizeChartFilterStatus
                ? '没有找到符合条件的尺码表，请调整筛选条件'
                : '点击右上角「添加尺码表」开始配置您的第一个尺码表'}
            </p>
            {(sizeChartSearch || sizeChartFilterType || sizeChartFilterStatus) && (
              <button
                onClick={() => { setSizeChartSearch(''); setSizeChartFilterType(''); setSizeChartFilterStatus(''); }}
                className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                清空筛选
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {sizeCharts.map(chart => (
              <div
                key={chart.id}
                className={cn(
                  'group relative rounded-xl border bg-card transition-all duration-200',
                  chart.status === 'disabled'
                    ? 'opacity-60 border-border/40 hover:opacity-80'
                    : 'border-border/60 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5',
                )}
              >
                {/* Status indicator stripe */}
                <div className={cn(
                  'absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl',
                  chart.status === 'active' ? 'bg-primary' : 'bg-muted-foreground/30',
                )} />

                <div className="p-4 pl-5 flex items-start gap-4">
                  {/* Icon */}
                  <div className={cn(
                    'w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center transition-colors',
                    chart.status === 'disabled'
                      ? 'bg-muted'
                      : CHART_TYPE_STYLES[chart.chart_type]?.split(' ').slice(0, 2).join(' ').replace('bg-', 'bg-').replace('/30', '/10') || 'bg-primary/10',
                    !chart.status || chart.status === 'active' && CHART_TYPE_STYLES[chart.chart_type],
                  )}>
                    <div className={cn(
                      '[&>*]:w-5 [&>*]:h-5',
                      chart.status === 'disabled' ? 'text-muted-foreground' :
                        chart.chart_type === 'clothing' ? 'text-blue-600 dark:text-blue-400' :
                        chart.chart_type === 'shoes' ? 'text-amber-600 dark:text-amber-400' :
                        chart.chart_type === 'accessories' ? 'text-violet-600 dark:text-violet-400' :
                        'text-primary'
                    )}>
                      {CHART_TYPE_ICONS[chart.chart_type] || <Ruler className="w-5 h-5" />}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground truncate">{chart.name}</h3>
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-medium ring-2 ring-inset',
                        chart.status === 'disabled'
                          ? 'bg-muted text-muted-foreground ring-transparent'
                          : CHART_TYPE_STYLES[chart.chart_type] || 'bg-muted text-muted-foreground'
                      )}>
                        {CHART_TYPE_LABELS[chart.chart_type] || chart.chart_type}
                      </span>
                      {chart.status === 'disabled' && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-medium bg-muted text-muted-foreground ring-2 ring-inset ring-transparent">
                          已禁用
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2.5 flex-wrap">
                      {chart.category && (
                        <span className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                          {chart.category}
                        </span>
                      )}
                      {chart.sku && (
                        <span className="flex items-center gap-1 font-mono">
                          <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                          {chart.sku}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                        {chart.size_rows.length} 个尺码
                      </span>
                    </div>

                    {/* Size preview pills */}
                    {chart.size_rows.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {chart.size_rows.slice(0, 6).map((row, i) => (
                          <span
                            key={i}
                            className={cn(
                              'inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md border transition-colors',
                              chart.status === 'disabled'
                                ? 'bg-muted border-border/40 text-muted-foreground'
                                : 'bg-primary/5 border-primary/20 text-primary/80 hover:border-primary/40'
                            )}
                          >
                            <span className="font-semibold">{row['size'] || '-'}</span>
                            {Object.entries(row).filter(([k]) => k !== 'size').slice(0, 1).map(([k, v]) => (
                              <span key={k} className="text-muted-foreground/70 font-normal">: {v}</span>
                            ))}
                          </span>
                        ))}
                        {chart.size_rows.length > 6 && (
                          <span className="text-[10px] text-muted-foreground/50">+{chart.size_rows.length - 6}</span>
                        )}
                      </div>
                    )}

                    {chart.hit_count > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-2">
                        <TrendingUp className="w-3 h-3" />
                        AI 引用 {chart.hit_count} 次
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingSizeChart(chart); setShowSizeChartModal(true); }}
                      className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleToggleSizeChartStatus(chart)}
                      className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
                      title={chart.status === 'active' ? '禁用' : '启用'}
                    >
                      {chart.status === 'active' ? (
                        <ArrowDownCircle className="w-3.5 h-3.5 text-amber-600 hover:text-amber-700" />
                      ) : (
                        <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-600 hover:text-emerald-700" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteSizeChart(chart.id)}
                      className="w-8 h-8 rounded-lg hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Size Chart Form Modal */}
      <SizeChartFormModal
        open={showSizeChartModal}
        sizeChart={editingSizeChart}
        onClose={() => { setShowSizeChartModal(false); setEditingSizeChart(null); }}
        onSaved={() => { setShowSizeChartModal(false); setEditingSizeChart(null); fetchSizeCharts(); }}
      />

      {/* Toggle Confirm Dialog */}
      <AlertDialog open={!!confirmToggleSizeChart} onOpenChange={() => setConfirmToggleSizeChart(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{confirmToggleSizeChart?.status === 'active' ? '禁用' : '启用'}尺码表</AlertDialogTitle>
            <AlertDialogDescription>
              确定要{confirmToggleSizeChart?.status === 'active' ? '禁用' : '启用'}
              「{confirmToggleSizeChart?.name}」吗？
              {confirmToggleSizeChart?.status === 'active' ? (
                <span className="block mt-1 text-amber-700 dark:text-amber-400">禁用后该尺码表将不会在 AI 回复中被推荐。</span>
              ) : (
                <span className="block mt-1 text-emerald-700 dark:text-emerald-400">启用后该尺码表将恢复在 AI 回复中被推荐。</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmToggleSizeChart(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleSizeChartStatus}
              className={confirmToggleSizeChart?.status === 'active'
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }
            >
              确认{confirmToggleSizeChart?.status === 'active' ? '禁用' : '启用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}