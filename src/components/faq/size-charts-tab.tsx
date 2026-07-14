'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, Pencil, Trash2,
  Ruler,
  ArrowDownCircle, ArrowUpCircle,
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

  // Confirm dialog
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

  return (
    <>
      <div className="p-6">
        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索尺码表名称..."
              value={sizeChartSearch}
              onChange={e => setSizeChartSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select
            value={sizeChartFilterType}
            onChange={e => setSizeChartFilterType(e.target.value)}
            className="px-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            className="px-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">全部状态</option>
            <option value="active">启用中</option>
            <option value="disabled">已禁用</option>
          </select>
          <button
            onClick={() => { setEditingSizeChart(null); setShowSizeChartModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加尺码表
          </button>
        </div>

        {/* Size chart list */}
        {loadingSizeCharts ? (
          <div className="text-center py-16 text-sm text-muted-foreground">加载中...</div>
        ) : sizeCharts.length === 0 ? (
          <div className="text-center py-16">
            <Ruler className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground mb-1">暂无尺码表</p>
            <p className="text-xs text-muted-foreground/60">点击右上角「添加尺码表」开始配置</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sizeCharts.map(chart => (
              <div
                key={chart.id}
                className="bg-card rounded-lg shadow-card p-4 flex items-start gap-4 hover:shadow-md transition-shadow"
              >
                {/* Icon */}
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex-shrink-0 flex items-center justify-center">
                  <Ruler className="w-5 h-5 text-primary" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground truncate">{chart.name}</h3>
                    <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                      chart.chart_type === 'clothing' ? 'bg-blue-200 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                      chart.chart_type === 'shoes' ? 'bg-amber-200 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {chart.chart_type === 'clothing' ? '服装' :
                       chart.chart_type === 'shoes' ? '鞋类' :
                       chart.chart_type === 'accessories' ? '配饰' : '自定义'}
                    </span>
                    {chart.status === 'disabled' && (
                      <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">
                        已禁用
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                    {chart.category && <span>分类: {chart.category}</span>}
                    {chart.sku && <span>SKU: {chart.sku}</span>}
                    <span>{chart.size_rows.length} 个尺码</span>
                  </div>
                  {/* Size preview mini-table */}
                  {chart.size_rows.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {chart.size_rows.slice(0, 5).map((row, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                          <span className="font-medium text-foreground">{row['size'] || '-'}</span>
                          {Object.entries(row).filter(([k]) => k !== 'size').slice(0, 1).map(([k, v]) => (
                            <span key={k}>: {v}</span>
                          ))}
                        </span>
                      ))}
                      {chart.size_rows.length > 5 && (
                        <span className="text-xs text-muted-foreground/50">+{chart.size_rows.length - 5}</span>
                      )}
                    </div>
                  )}
                  {chart.hit_count > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">AI引用 {chart.hit_count} 次</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setEditingSizeChart(chart); setShowSizeChartModal(true); }}
                    className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleSizeChartStatus(chart)}
                    className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
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
                    className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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

      {/* Size Chart Toggle Confirm Dialog */}
      <AlertDialog open={!!confirmToggleSizeChart} onOpenChange={() => setConfirmToggleSizeChart(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{confirmToggleSizeChart?.status === 'active' ? '禁用' : '启用'}尺码表</AlertDialogTitle>
            <AlertDialogDescription>
              确定要{confirmToggleSizeChart?.status === 'active' ? '禁用' : '启用'}
              「{confirmToggleSizeChart?.name}」吗？
              {confirmToggleSizeChart?.status === 'active' ? (
                <span className="block mt-1 text-amber-700">禁用后该尺码表将不会在 AI 回复中被推荐。</span>
              ) : (
                <span className="block mt-1 text-emerald-700">启用后该尺码表将恢复在 AI 回复中被推荐。</span>
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
