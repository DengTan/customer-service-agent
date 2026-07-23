'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppLayout from '@/components/app-layout';
import { useAuth } from '@/lib/auth';
import {
  History,
  GitCompare,
  Sliders,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpCircle,
  PauseCircle,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type RegressionRunKind = 'ci' | 'continuous' | 'manual';
type RegressionRunStatus = 'pass' | 'warn' | 'fail';

interface MetricResult {
  value: number;
  ci_lower: number;
  ci_upper: number;
  threshold: number;
}

interface RegressionRun {
  id: string;
  dataset_version_id: string;
  run_kind: RegressionRunKind;
  status: RegressionRunStatus;
  metrics: Record<string, MetricResult>;
  started_at: string;
  finished_at: string;
  triggered_by: string | null;
}

interface MetricWithCI {
  value: number;
  ci_lower: number;
  ci_upper: number;
}

interface ShadowComparatorData {
  bot_id: string;
  shop_id: string | null;
  window_days: number;
  n: number;
  baseline: {
    answer_correct: MetricWithCI;
    cite_precision: MetricWithCI;
    recall_at_10: MetricWithCI;
    false_handoff_rate: MetricWithCI;
  };
  candidate: {
    answer_correct: MetricWithCI;
    cite_precision: MetricWithCI;
    recall_at_10: MetricWithCI;
    false_handoff_rate: MetricWithCI;
  };
  delta: {
    answer_correct: number;
    cite_precision: number;
    recall_at_10: number;
    false_handoff_rate: number;
  };
}

type CalibrationStatus = 'frozen' | 'canary' | 'active' | 'archived';

interface CalibrationRow {
  id: string;
  dataset_version_id: string;
  bot_id: string;
  shop_id: string | null;
  min_score: number;
  rerank_backend: string;
  claim_verifier_threshold: number;
  confidence_gate: number;
  answer_correct: number;
  cite_precision: number;
  recall_at_10: number;
  false_handoff_rate: number;
  composite: number;
  fold_gap: number;
  status: CalibrationStatus;
  is_canary: boolean;
  canary_pct: number;
  created_by: string | null;
  created_at: string;
  promoted_at: string | null;
}

interface BotOption {
  id: string;
  name: string;
}

interface ShopOption {
  id: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  answer_correct: '答案正确率',
  cite_precision: '引用精确率',
  recall_at_10: 'Top-10 召回率',
  false_handoff_rate: '错误转人工率',
};

const STATUS_COLORS: Record<RegressionRunStatus, string> = {
  pass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  warn: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  fail: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const STATUS_LABELS: Record<RegressionRunStatus, string> = {
  pass: '通过',
  warn: '警告',
  fail: '失败',
};

const CALIBRATION_STATUS_LABELS: Record<CalibrationStatus, string> = {
  frozen: '已冻结',
  canary: '金丝雀',
  active: '生效中',
  archived: '已归档',
};

const CALIBRATION_STATUS_COLORS: Record<CalibrationStatus, string> = {
  frozen: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400',
  canary: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  archived: 'bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-400',
};

const METRIC_KEYS = ['answer_correct', 'cite_precision', 'recall_at_10', 'false_handoff_rate'] as const;

// ─── Delta helper ────────────────────────────────────────────────────────────

function DeltaBadge({ value }: { value: number }) {
  if (value > 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 text-xs font-medium">
        <TrendingUp className="w-3 h-3" />
        +{(value * 100).toFixed(1)}%
      </span>
    );
  }
  if (value < -0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-600 text-xs font-medium">
        <TrendingDown className="w-3 h-3" />
        {(value * 100).toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs">
      <Minus className="w-3 h-3" />
      0.0%
    </span>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function EvalPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  // ── Admin guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && user && user.role !== 'admin') {
      toast.error('仅管理员可访问此页面');
      router.push('/');
    }
  }, [user, isLoading, router]);

  const [activeTab, setActiveTab] = useState<'regression' | 'shadow' | 'calibration'>('regression');

  // ── Regression state ─────────────────────────────────────────────────────────
  const [regressionRuns, setRegressionRuns] = useState<RegressionRun[]>([]);
  const [regressionLoading, setRegressionLoading] = useState(false);
  const [regressionError, setRegressionError] = useState('');
  const [regressionKind, setRegressionKind] = useState<RegressionRunKind | 'all'>('all');

  // ── Shadow state ─────────────────────────────────────────────────────────────
  const [bots, setBots] = useState<BotOption[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [botsError, setBotsError] = useState('');
  const [shopsError, setShopsError] = useState('');
  const [selectedBotId, setSelectedBotId] = useState('');
  const [selectedShopId, setSelectedShopId] = useState('');
  const [windowDays, setWindowDays] = useState(7);
  const [comparatorData, setComparatorData] = useState<ShadowComparatorData | null>(null);
  const [comparatorLoading, setComparatorLoading] = useState(false);
  const [comparatorError, setComparatorError] = useState('');

  // ── Calibration state ─────────────────────────────────────────────────────────
  const [calibrationRows, setCalibrationRows] = useState<CalibrationRow[]>([]);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [calibrationError, setCalibrationError] = useState('');
  const [selectedCalibration, setSelectedCalibration] = useState<CalibrationRow | null>(null);
  const [calibrationDetailOpen, setCalibrationDetailOpen] = useState(false);
  const [calibrationActionLoading, setCalibrationActionLoading] = useState(false);

  // ── Fetch bots & shops ───────────────────────────────────────────────────────
  const fetchBots = useCallback(async () => {
    setBotsLoading(true);
    setBotsError('');
    try {
      const res = await fetch('/api/bot-configs?include_sub_agents=false');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBots(data.bots?.filter((b: BotOption & { is_sub_agent?: boolean }) => !b.is_sub_agent) ?? []);
    } catch (e) {
      logger.error('Failed to fetch bots', { error: e });
      setBotsError('加载 Bot 列表失败');
    } finally {
      setBotsLoading(false);
    }
  }, []);

  const fetchShops = useCallback(async () => {
    setShopsLoading(true);
    setShopsError('');
    try {
      const res = await fetch('/api/shops');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setShops(data.shops ?? []);
    } catch (e) {
      logger.error('Failed to fetch shops', { error: e });
      setShopsError('加载店铺列表失败');
    } finally {
      setShopsLoading(false);
    }
  }, []);

  // ── Fetch regression runs ────────────────────────────────────────────────────
  const fetchRegressionRuns = useCallback(async () => {
    setRegressionLoading(true);
    try {
      const params = new URLSearchParams();
      if (regressionKind !== 'all') params.set('kind', regressionKind);
      params.set('limit', '20');
      const res = await fetch(`/api/eval/regression/runs?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRegressionRuns(data.rows ?? []);
    } catch (e) {
      logger.error('Failed to fetch regression runs', { error: e });
      setRegressionError('获取回归历史失败');
      toast.error('获取回归历史失败');
    } finally {
      setRegressionLoading(false);
    }
  }, [regressionKind]);

  // ── Fetch shadow comparator ───────────────────────────────────────────────────
  const fetchComparator = useCallback(async () => {
    if (!selectedBotId) return;
    setComparatorLoading(true);
    setComparatorError('');
    setComparatorData(null);
    try {
      const params = new URLSearchParams({
        botId: selectedBotId,
        windowDays: String(windowDays),
        minN: '10',
      });
      if (selectedShopId) params.set('shopId', selectedShopId);
      const res = await fetch(`/api/eval/shadow/comparator?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setComparatorError(err.error ?? '加载失败');
        return;
      }
      const data = await res.json();
      setComparatorData(data.data ?? null);
      // null data means insufficient shadow runs — clear error, show empty state
      if (!data.data) {
        setComparatorError('');
      }
    } catch (e) {
      logger.error('Failed to fetch shadow comparator', { error: e });
      setComparatorError('加载失败');
    } finally {
      setComparatorLoading(false);
    }
  }, [selectedBotId, selectedShopId, windowDays]);

  // ── Fetch calibration rows ───────────────────────────────────────────────────
  const fetchCalibrations = useCallback(async () => {
    if (!selectedBotId) {
      setCalibrationRows([]);
      return;
    }
    setCalibrationLoading(true);
    setCalibrationError('');
    try {
      const params = new URLSearchParams({ botId: selectedBotId });
      if (selectedShopId) params.set('shopId', selectedShopId);
      const res = await fetch(`/api/eval/calibration?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalibrationRows(data.rows ?? []);
    } catch (e) {
      logger.error('Failed to fetch calibrations', { error: e });
      setCalibrationError('获取校准记录失败');
      toast.error('获取校准记录失败');
    } finally {
      setCalibrationLoading(false);
    }
  }, [selectedBotId, selectedShopId]);

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchBots();
    fetchShops();
  }, [fetchBots, fetchShops]);

  useEffect(() => {
    if (activeTab === 'regression') {
      fetchRegressionRuns();
    }
  }, [activeTab, regressionKind, fetchRegressionRuns]);

  useEffect(() => {
    if (activeTab === 'shadow') {
      if (selectedBotId) fetchComparator();
    }
  }, [activeTab, selectedBotId, selectedShopId, windowDays, fetchComparator]);

  useEffect(() => {
    if (activeTab === 'calibration') {
      fetchCalibrations();
    }
  }, [activeTab, selectedBotId, selectedShopId, fetchCalibrations]);

  // ── Calibration action ───────────────────────────────────────────────────────
  const handleCalibrationAction = async (action: 'promote' | 'pause' | 'rollback', id: string) => {
    setCalibrationActionLoading(true);
    try {
      const res = await fetch('/api/eval/calibration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? '操作失败');
        return;
      }
      toast.success(`${action === 'promote' ? '已提升为金丝雀' : action === 'pause' ? '已归档' : '已回滚'}`);
      setCalibrationDetailOpen(false);
      setSelectedCalibration(null);
      fetchCalibrations();
    } catch (e) {
      logger.error('Calibration action failed', { error: e });
      toast.error('操作失败');
    } finally {
      setCalibrationActionLoading(false);
    }
  };

  // ── Chart data: regression time series ──────────────────────────────────────
  const regressionChartData = regressionRuns
    .slice()
    .reverse()
    .map((run) => ({
      date: new Date(run.started_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
      fullDate: run.started_at,
      ci_lower: run.metrics.answer_correct?.ci_lower ?? 0,
      value: run.metrics.answer_correct?.value ?? 0,
      ci_upper: run.metrics.answer_correct?.ci_upper ?? 1,
      threshold: run.metrics.answer_correct?.threshold ?? 0,
      status: run.status,
    }));

  // ── Pass/warn/fail counts ────────────────────────────────────────────────────
  const statusCounts = regressionRuns.reduce<Record<string, number>>(
    (acc, run) => {
      acc[run.status] = (acc[run.status] ?? 0) + 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );

  // ── Tabs config ─────────────────────────────────────────────────────────────
  const tabs = [
    { key: 'regression' as const, label: '回归历史', icon: History },
    { key: 'shadow' as const, label: 'Shadow 对比', icon: GitCompare },
    { key: 'calibration' as const, label: '阈值校准', icon: Sliders },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="h-full flex flex-col page-transition">
        {/* Header */}
        <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-foreground">Eval 看板</h1>
            <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 ml-4">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeTab === tab.key
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tab: Regression History ─────────────────────────────────────────── */}
        {activeTab === 'regression' && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Filter row */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {(['all', 'ci', 'continuous', 'manual'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setRegressionKind(k)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      regressionKind === k
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {k === 'all' ? '全部' : k === 'ci' ? 'CI' : k === 'continuous' ? '持续' : '手动'}
                  </button>
                ))}
              </div>
              {regressionRuns.length > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  {(['pass', 'warn', 'fail'] as const).map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLORS[s].split(' ')[0]}`} />
                      {STATUS_LABELS[s]}: {statusCounts[s]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {regressionLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : regressionError ? (
              <div className="flex flex-col items-center justify-center h-64 text-destructive">
                <AlertTriangle className="w-12 h-12 mb-4" />
                <p>{regressionError}</p>
              </div>
            ) : regressionChartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <History className="w-12 h-12 mb-4" />
                <p>暂无回归测试记录</p>
              </div>
            ) : (
              <>
                {/* Chart */}
                <div className="border border-border rounded-xl bg-card p-4 mb-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-foreground">answer_correct 置信区间趋势</h2>
                    <span className="text-xs text-muted-foreground">最近 20 次运行</span>
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={regressionChartData}>
                        <defs>
                          <linearGradient id="ciGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                          domain={[0, 1]}
                          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            if (name === 'threshold') return [`阈值: ${(value * 100).toFixed(1)}%`, ''];
                            if (name === 'ci_band') return null;
                            return [`${(value * 100).toFixed(1)}%`, METRIC_LABELS[name] ?? name];
                          }}
                          labelFormatter={(label) => {
                            const item = regressionChartData.find((d) => d.date === label);
                            return item ? new Date(item.fullDate).toLocaleString('zh-CN') : label;
                          }}
                          contentStyle={{
                            backgroundColor: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend
                          formatter={(value: string) => {
                            if (value === 'ci_band') return 'CI 区间';
                            return METRIC_LABELS[value] ?? value;
                          }}
                        />
                        <ReferenceLine
                          y={regressionChartData[0]?.threshold ?? 0}
                          stroke="#f59e0b"
                          strokeDasharray="4 4"
                          label={{ value: '阈值', position: 'right', fill: '#f59e0b', fontSize: 11 }}
                        />
                        {/* CI band (upper and lower as area) */}
                        <Area
                          type="monotone"
                          dataKey="ci_upper"
                          stroke="none"
                          fill="url(#ciGradient)"
                          name="ci_band"
                          legendType="none"
                          baseLine={0}
                        />
                        <Area
                          type="monotone"
                          dataKey="ci_lower"
                          stroke="none"
                          fill="var(--card)"
                          name="ci_band"
                          legendType="none"
                        />
                        {/* CI lower bound line */}
                        <Line
                          type="monotone"
                          dataKey="ci_lower"
                          name="answer_correct"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={({ cx, cy, index }) => {
                            const run = regressionChartData[index ?? 0];
                            const color =
                              run?.status === 'pass'
                                ? '#22c55e'
                                : run?.status === 'warn'
                                ? '#f59e0b'
                                : '#ef4444';
                            return <circle key={index} cx={cx} cy={cy} r={5} fill={color} stroke="#3b82f6" strokeWidth={2} />;
                          }}
                        />
                        {/* Mean value line */}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#8b5cf6"
                          strokeWidth={1.5}
                          strokeDasharray="4 2"
                          dot={false}
                          name="value"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Run table */}
                <div className="border border-border rounded-xl bg-card overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">时间</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">类型</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">状态</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">answer_correct</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">CI 下界</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">CI 上界</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">阈值</th>
                        <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">触发者</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regressionRuns.map((run, idx) => (
                        <tr
                          key={run.id}
                          className={idx !== regressionRuns.length - 1 ? 'border-b border-border/50' : ''}
                        >
                          <td className="px-5 py-3 text-sm text-foreground">
                            {new Date(run.started_at).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className="font-normal">
                              {run.run_kind}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className={STATUS_COLORS[run.status]}>
                              {STATUS_LABELS[run.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {(run.metrics.answer_correct?.value ?? 0).toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-sm text-blue-600">
                            {(run.metrics.answer_correct?.ci_lower ?? 0).toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {(run.metrics.answer_correct?.ci_upper ?? 0).toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-sm text-yellow-600">
                            {(run.metrics.answer_correct?.threshold ?? 0).toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {run.triggered_by ?? '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Tab: Shadow Comparator ──────────────────────────────────────────── */}
        {activeTab === 'shadow' && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Filters */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative">
                <select
                  className="px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[180px] pr-8"
                  value={selectedBotId}
                  onChange={(e) => setSelectedBotId(e.target.value)}
                  disabled={botsLoading}
                >
                  <option value="">选择 Bot…</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {botsLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground pointer-events-none" />}
              </div>

              <div className="relative">
                <select
                  className="px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[180px] pr-8"
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                  disabled={shopsLoading}
                >
                  <option value="">全部店铺</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {shopsLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground pointer-events-none" />}
              </div>
              {(botsError || shopsError) && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {botsError || shopsError}
                </span>
              )}

              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
                <span className="text-xs text-muted-foreground">窗口：</span>
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => setWindowDays(d)}
                    className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                      windowDays === d
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {d} 天
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={fetchComparator}
                disabled={!selectedBotId || comparatorLoading}
                className="rounded-lg"
              >
                {comparatorLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '查询'}
              </Button>
            </div>

            {!selectedBotId ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <GitCompare className="w-12 h-12 mb-4" />
                <p>请先选择 Bot 和店铺进行对比</p>
              </div>
            ) : comparatorLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : comparatorError ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <AlertTriangle className="w-12 h-12 mb-4" />
                <p>{comparatorError}</p>
              </div>
            ) : !comparatorData && !comparatorError ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <GitCompare className="w-12 h-12 mb-4" />
                <p>该 Bot 在近 {windowDays} 天内没有足够的阴影测试记录</p>
                <p className="text-xs mt-1">每个队列至少需要 10 条记录才能展示对比结果</p>
              </div>
            ) : comparatorData ? (
              <div className="space-y-4">
                {/* 4×2 table */}
                <div className="border border-border rounded-xl bg-card overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3 w-48">
                          指标
                        </th>
                        <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">
                          Baseline
                        </th>
                        <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">
                          Candidate
                        </th>
                        <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3 w-24">
                          差值 Δ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {METRIC_KEYS.map((key, idx) => {
                        const b = comparatorData.baseline[key] ?? { value: 0, ci_lower: 0, ci_upper: 0 };
                        const c = comparatorData.candidate[key] ?? { value: 0, ci_lower: 0, ci_upper: 0 };
                        const d = comparatorData.delta[key] ?? 0;
                        return (
                          <tr
                            key={key}
                            className={idx !== METRIC_KEYS.length - 1 ? 'border-b border-border/50' : ''}
                          >
                            <td className="px-5 py-4">
                              <span className="text-sm font-medium text-foreground">
                                {METRIC_LABELS[key]}
                              </span>
                            </td>
                            {/* Baseline cell */}
                            <td className="px-4 py-4 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-sm font-medium text-foreground">
                                  {(b.value * 100).toFixed(1)}%
                                </span>
                                <div className="w-32 h-4 bg-muted rounded overflow-hidden relative">
                                  <div
                                    className="absolute h-full bg-blue-400/40 rounded-l"
                                    style={{
                                      left: `${(b.ci_lower * 100).toFixed(1)}%`,
                                      width: `${((b.ci_upper - b.ci_lower) * 100).toFixed(1)}%`,
                                    }}
                                  />
                                  <div
                                    className="absolute h-1 bg-blue-600 top-1/2 -translate-y-1/2 rounded"
                                    style={{ left: `${(b.value * 100).toFixed(1)}%`, width: '2px' }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  CI: [{(b.ci_lower * 100).toFixed(1)}%, {(b.ci_upper * 100).toFixed(1)}%]
                                </span>
                              </div>
                            </td>
                            {/* Candidate cell */}
                            <td className="px-4 py-4 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-sm font-medium text-foreground">
                                  {(c.value * 100).toFixed(1)}%
                                </span>
                                <div className="w-32 h-4 bg-muted rounded overflow-hidden relative">
                                  <div
                                    className="absolute h-full bg-emerald-400/40 rounded-l"
                                    style={{
                                      left: `${(c.ci_lower * 100).toFixed(1)}%`,
                                      width: `${((c.ci_upper - c.ci_lower) * 100).toFixed(1)}%`,
                                    }}
                                  />
                                  <div
                                    className="absolute h-1 bg-emerald-600 top-1/2 -translate-y-1/2 rounded"
                                    style={{ left: `${(c.value * 100).toFixed(1)}%`, width: '2px' }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  CI: [{(c.ci_lower * 100).toFixed(1)}%, {(c.ci_upper * 100).toFixed(1)}%]
                                </span>
                              </div>
                            </td>
                            {/* Delta */}
                            <td className="px-4 py-4 text-center">
                              <DeltaBadge value={d} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>样本量：n = {comparatorData.n}（每队列）</span>
                  <span>窗口：{comparatorData.window_days} 天</span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 bg-blue-400/40 rounded inline-block" />
                    Baseline
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-2 bg-emerald-400/40 rounded inline-block" />
                    Candidate
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ── Tab: Calibration Selector ────────────────────────────────────────── */}
        {activeTab === 'calibration' && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Filters */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative">
                <select
                  className="px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[180px] pr-8"
                  value={selectedBotId}
                  onChange={(e) => setSelectedBotId(e.target.value)}
                  disabled={botsLoading}
                >
                  <option value="">选择 Bot…</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {botsLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground pointer-events-none" />}
              </div>

              <div className="relative">
                <select
                  className="px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[180px] pr-8"
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                  disabled={shopsLoading}
                >
                  <option value="">全部店铺</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {shopsLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground pointer-events-none" />}
              </div>
              {(botsError || shopsError) && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {botsError || shopsError}
                </span>
              )}
            </div>

            {!selectedBotId ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Sliders className="w-12 h-12 mb-4" />
                <p>请先选择 Bot 和店铺查看校准记录</p>
              </div>
            ) : calibrationLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : calibrationError ? (
              <div className="flex flex-col items-center justify-center h-64 text-destructive">
                <AlertTriangle className="w-12 h-12 mb-4" />
                <p>{calibrationError}</p>
              </div>
            ) : calibrationRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Sliders className="w-12 h-12 mb-4" />
                <p>暂无校准记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {calibrationRows.map((row) => (
                  <div
                    key={row.id}
                    className="border border-border rounded-xl bg-card p-4 cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => {
                      setSelectedCalibration(row);
                      setCalibrationDetailOpen(true);
                    }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={CALIBRATION_STATUS_COLORS[row.status]}
                        >
                          {CALIBRATION_STATUS_LABELS[row.status]}
                        </Badge>
                        {row.fold_gap > 0.1 && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            过拟合风险
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString('zh-CN')}
                      </span>
                    </div>

                    {/* Quick metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {METRIC_KEYS.map((key) => (
                        <div key={key}>
                          <div className="text-xs text-muted-foreground mb-0.5">{METRIC_LABELS[key]}</div>
                          <div className="text-sm font-medium text-foreground">
                            {(row[key] * 100).toFixed(1)}%
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Composite & fold gap */}
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
                      <div>
                        <span className="text-xs text-muted-foreground">综合得分：</span>
                        <span className="text-sm font-semibold text-foreground ml-1">
                          {row.composite.toFixed(3)}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Fold Gap：</span>
                        <span className={`text-sm font-medium ml-1 ${row.fold_gap > 0.1 ? 'text-red-500' : 'text-foreground'}`}>
                          {row.fold_gap.toFixed(3)}
                        </span>
                      </div>
                      <div className="ml-auto text-xs text-muted-foreground">
                        {row.rerank_backend} · min_score={row.min_score}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Calibration Detail Dialog ────────────────────────────────────────── */}
        <Dialog
          open={calibrationDetailOpen}
          onOpenChange={(open) => {
            setCalibrationDetailOpen(open);
            if (!open) setSelectedCalibration(null);
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                校准配置详情
                {selectedCalibration && (
                  <Badge
                    variant="secondary"
                    className={CALIBRATION_STATUS_COLORS[selectedCalibration.status]}
                  >
                    {CALIBRATION_STATUS_LABELS[selectedCalibration.status]}
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>

            {selectedCalibration && (
              <div className="space-y-4 py-2">
                {/* Thresholds */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    检索阈值配置
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'min_score', value: selectedCalibration.min_score },
                      { label: 'rerank_backend', value: selectedCalibration.rerank_backend },
                      {
                        label: 'claim_verifier_threshold',
                        value: selectedCalibration.claim_verifier_threshold,
                      },
                      { label: 'confidence_gate', value: selectedCalibration.confidence_gate },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className="text-sm font-medium text-foreground">
                          {typeof value === 'number' && value < 1
                            ? value.toFixed(2)
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Metrics */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    5 折交叉验证结果
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {METRIC_KEYS.map((key) => (
                      <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted">
                        <span className="text-xs text-muted-foreground">{METRIC_LABELS[key]}</span>
                        <span className="text-sm font-medium text-foreground">
                          {(selectedCalibration[key] * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Composite & fold gap */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">综合得分</span>
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                      {selectedCalibration.composite.toFixed(4)}
                    </span>
                  </div>
                  <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                    selectedCalibration.fold_gap > 0.1
                      ? 'bg-red-500/10 border border-red-500/20'
                      : 'bg-muted'
                  }`}>
                    <span className={`text-xs ${selectedCalibration.fold_gap > 0.1 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}`}>
                      Fold Gap
                    </span>
                    <span className={`text-sm font-medium ${selectedCalibration.fold_gap > 0.1 ? 'text-red-600' : 'text-foreground'}`}>
                      {selectedCalibration.fold_gap.toFixed(4)}
                    </span>
                  </div>
                </div>

                {/* Fold gap warning */}
                {selectedCalibration.fold_gap > 0.1 && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-yellow-700 dark:text-yellow-400">
                      <strong>过拟合风险：</strong>Fold Gap &gt; 0.10，模型在不同数据分片上表现不稳定，
                      建议谨慎提升为金丝雀。
                    </div>
                  </div>
                )}

                {/* Metadata */}
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>创建时间：{new Date(selectedCalibration.created_at).toLocaleString('zh-CN')}</div>
                  {selectedCalibration.promoted_at && (
                    <div>提升时间：{new Date(selectedCalibration.promoted_at).toLocaleString('zh-CN')}</div>
                  )}
                  {selectedCalibration.created_by && (
                    <div>操作人：{selectedCalibration.created_by}</div>
                  )}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => setCalibrationDetailOpen(false)}
                className="rounded-lg"
              >
                关闭
              </Button>
              {selectedCalibration && selectedCalibration.status !== 'archived' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCalibrationAction('pause', selectedCalibration.id)}
                    disabled={calibrationActionLoading}
                    className="rounded-lg gap-1.5"
                  >
                    {calibrationActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />}
                    归档
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleCalibrationAction('promote', selectedCalibration.id)}
                    disabled={calibrationActionLoading}
                    className="rounded-lg gap-1.5"
                  >
                    {calibrationActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                    提升为金丝雀
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
