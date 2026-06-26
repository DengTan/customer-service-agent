'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle, Scan, CheckCircle, X, ExternalLink,
  ChevronLeft, ChevronRight, Search, MessageSquare,
} from 'lucide-react';

interface KnowledgeGap {
  id: string;
  question_hash: string;
  sample_question: string;
  question_category: string | null;
  frequency: number;
  first_seen_at: string;
  last_seen_at: string;
  last_top_score: number | null;
  triggers_handoff: boolean;
  source_conversation_ids: string[] | null;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  resolved_at: string | null;
  notes: string | null;
}

interface KnowledgeGapStats {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  dismissed: number;
  top_concerns: Array<{
    question_hash: string;
    sample_question: string;
    frequency: number;
  }>;
}

const STATUS_TABS = [
  { value: 'open', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'dismissed', label: '已忽略' },
];

export function KnowledgeGapTab() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [stats, setStats] = useState<KnowledgeGapStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusTab, setStatusTab] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const pageSize = 20;

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/gaps/stats', {
        headers: { 'x-user-role': 'admin' },
      });
      const json = await res.json();
      if (json?.stats) setStats(json.stats);
    } catch (err) {
      console.error('Failed to load gap stats', err);
    }
  }, []);

  const loadGaps = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('status', statusTab);
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/knowledge/gaps?${params.toString()}`, {
        headers: { 'x-user-role': 'admin' },
      });
      const json = await res.json();
      setGaps(json.gaps || []);
      setTotal(json.total ?? json.gaps?.length ?? 0);
    } catch (err) {
      console.error('Failed to load gaps', err);
      toast.error('加载知识缺口失败');
    } finally {
      setLoading(false);
    }
  }, [statusTab, page, search]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadGaps();
  }, [loadGaps]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/knowledge/gaps/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({ windowDays: 7 }),
      });
      const json = await res.json();
      if (json?.success === false) throw new Error(json.error);
      toast.success(`扫描完成：发现 ${json.gaps_found} 个新缺口`);
      setScannedAt(new Date().toLocaleString());
      await loadGaps();
      await loadStats();
    } catch (err) {
      toast.error('扫描失败：' + ((err as Error).message || '未知错误'));
    } finally {
      setScanning(false);
    }
  };

  const handlePromote = async (gap: KnowledgeGap) => {
    const category = window.prompt(
      `将「${gap.sample_question.slice(0, 30)}...」转入知识自学习队列（需要人工填写答案）。\n请输入分类：`,
      gap.question_category || '通用'
    );
    if (category === null) return;
    try {
      const res = await fetch(`/api/knowledge/gaps/${gap.id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({ category }),
      });
      const json = await res.json();
      if (json?.success === false) throw new Error(json.error);
      toast.success('已转入自学习队列');
      await loadGaps();
      await loadStats();
    } catch (err) {
      toast.error('操作失败：' + ((err as Error).message || '未知错误'));
    }
  };

  const handleDismiss = async (gap: KnowledgeGap) => {
    if (!window.confirm(`确认忽略「${gap.sample_question.slice(0, 30)}...」？`)) return;
    try {
      const res = await fetch(`/api/knowledge/gaps/${gap.id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({ notes: '人工忽略' }),
      });
      const json = await res.json();
      if (json?.success === false) throw new Error(json.error);
      toast.success('已忽略');
      await loadGaps();
      await loadStats();
    } catch (err) {
      toast.error('操作失败：' + ((err as Error).message || '未知错误'));
    }
  };

  const handleResolve = async (gap: KnowledgeGap) => {
    const itemId = window.prompt(
      `将「${gap.sample_question.slice(0, 30)}...」标记为已解决。\n请输入关联的知识条目ID（可留空）：`
    );
    if (itemId === null) return;
    try {
      const res = await fetch(`/api/knowledge/gaps/${gap.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin' },
        body: JSON.stringify({ linked_knowledge_item_id: itemId || undefined, notes: '人工标记已解决' }),
      });
      const json = await res.json();
      if (json?.success === false) throw new Error(json.error);
      toast.success('已标记为已解决');
      await loadGaps();
      await loadStats();
    } catch (err) {
      toast.error('操作失败：' + ((err as Error).message || '未知错误'));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="总缺口" value={stats.total} icon={AlertTriangle} color="text-amber-600" />
          <StatCard label="待处理" value={stats.open} icon={AlertTriangle} color="text-red-600" />
          <StatCard label="已解决" value={stats.resolved} icon={CheckCircle} color="text-emerald-600" />
          <StatCard label="已忽略" value={stats.dismissed} icon={X} color="text-zinc-500" />
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索问题..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background"
          />
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="bg-primary text-primary-foreground px-4 py-1.5 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1.5"
        >
          <Scan className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? '扫描中...' : '扫描历史对话'}
        </button>
      </div>

      {/* 状态 Tab */}
      <div className="flex items-center gap-1 border-b border-border">
        {STATUS_TABS.map((tab) => {
          const count = tab.value === 'open' ? stats?.open
            : tab.value === 'in_progress' ? stats?.in_progress
            : tab.value === 'resolved' ? stats?.resolved
            : stats?.dismissed;
          return (
            <button
              key={tab.value}
              onClick={() => { setStatusTab(tab.value); setPage(1); }}
              className={`px-3 py-1.5 text-sm border-b-2 transition-colors ${
                statusTab === tab.value
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="py-16 text-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 animate-pulse" />
          <p className="text-sm">加载中...</p>
        </div>
      ) : gaps.length === 0 ? (
        <div className="py-16 text-center">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground mb-1">暂无该状态的缺口</p>
          <p className="text-xs text-muted-foreground/70">系统会持续监测用户问题，发现无人应答的高频问题会展示在这里</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-[40%]">问题</th>
                <th className="text-left px-3 py-2 font-medium w-[10%]">频次</th>
                <th className="text-left px-3 py-2 font-medium w-[10%]">分类</th>
                <th className="text-left px-3 py-2 font-medium w-[12%]">最高分</th>
                <th className="text-left px-3 py-2 font-medium w-[13%]">最近出现</th>
                <th className="text-left px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {gaps.map((gap) => (
                <tr key={gap.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="line-clamp-2 text-foreground">{gap.sample_question}</div>
                    {gap.triggers_handoff && (
                      <span className="inline-flex items-center gap-1 mt-1 text-xs text-amber-600">
                        <AlertTriangle className="w-3 h-3" />
                        触发过转人工
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-base font-semibold text-amber-600">
                      {gap.frequency}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {gap.question_category || '-'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {gap.last_top_score !== null && gap.last_top_score !== undefined
                      ? gap.last_top_score.toFixed(2)
                      : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(gap.last_seen_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {statusTab === 'open' || statusTab === 'in_progress' ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handlePromote(gap)}
                          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                          title="转入知识自学习队列"
                        >
                          转入学习
                        </button>
                        <button
                          onClick={() => handleResolve(gap)}
                          className="text-xs px-2 py-1 rounded border border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                          title="标记为已解决"
                        >
                          解决
                        </button>
                        <button
                          onClick={() => handleDismiss(gap)}
                          className="text-xs px-2 py-1 rounded border border-zinc-300 text-muted-foreground hover:bg-muted"
                          title="忽略"
                        >
                          忽略
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {gap.notes || '-'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            共 {total} 条 · 第 {page} / {totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="p-1 rounded hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {scannedAt && (
        <p className="text-xs text-muted-foreground text-center">
          最近扫描：{scannedAt}
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
      <Icon className={`w-8 h-8 ${color}`} />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </div>
    </div>
  );
}
