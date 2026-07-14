'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  MessageSquare, Users, Star, TrendingUp, Zap, Clock,
  BarChart3, ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle, Bell,
  Send, Truck, Package, CreditCard, XCircle, CheckCircle2, XCircle as XCircleIcon, Loader2, Webhook, RefreshCw, Ticket,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts';
import { ErrorBoundary } from '@/components/common/error-boundary';

import type { PushRecord, PushEventLog } from '@/lib/types';
import { logger } from '@/lib/logger';

/** Push event type definitions for dashboard */
const PUSH_EVENT_TYPES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  order_shipped: { label: '订单已发货', color: 'bg-primary/10 text-primary', icon: <Truck className="w-3 h-3" /> },
  order_delivered: { label: '订单已签收', color: 'bg-success/10 text-success', icon: <Package className="w-3 h-3" /> },
  refund_completed: { label: '退款已到账', color: 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400', icon: <CreditCard className="w-3 h-3" /> },
  refund_rejected: { label: '退款已拒绝', color: 'bg-destructive/10 text-destructive', icon: <XCircle className="w-3 h-3" /> },
  logistics_delayed: { label: '物流延迟', color: 'bg-amber-500/10 text-amber-600', icon: <Clock className="w-3 h-3" /> },
};

const CHANNEL_MAP: Record<string, { label: string; icon: string }> = {
  web: { label: 'Web', icon: '🌐' },
  qianniu: { label: '千牛', icon: '💬' },
  doudian: { label: '抖店', icon: '🛒' },
  sms: { label: '短信', icon: '📱' },
};

interface Alert {
  id: string;
  conversation_id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  is_resolved: boolean;
  created_at: string;
  resolved_at?: string;
}

interface Metrics {
  totalConversations: number;
  totalMessages: number;
  activeConversations: number;
  todayConversations: number;
  avgRating: number;
  avgMessagesPerConv: number;
  autoReplyHitRate: number;
}

const RATING_COLORS = [
  'var(--chart-4)',   // 1-star: destructive red
  'var(--chart-3)',   // 2-star: warning amber
  '#eab308',          // 3-star: yellow
  'var(--chart-2)',   // 4-star: success green
  'var(--chart-1)',   // 5-star: primary blue
];
const SOURCE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)'];
const SOURCE_LABELS: Record<string, string> = {
  web: '网页端',
  qianniu: '千牛',
  doudian: '抖店',
  api: 'API',
};

/** 工单状态映射 */
const TICKET_STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  pending_customer: '待客户',
  resolved: '已解决',
  closed: '已关闭',
};

/** 工单状态颜色映射 */
const TICKET_STATUS_COLORS: Record<string, string> = {
  open: 'bg-amber-500',
  in_progress: 'bg-blue-500',
  pending_customer: 'bg-amber-500',
  resolved: 'bg-emerald-500',
  closed: 'bg-gray-400',
};

export function DashboardPage() {
  return (
    <ErrorBoundary>
      <DashboardPageInner />
    </ErrorBoundary>
  );
}

function DashboardPageInner() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trendData, setTrendData] = useState<Array<{ date: string; count: number }>>([]);
  const [msgTrendData, setMsgTrendData] = useState<Array<{ date: string; user: number; assistant: number }>>([]);
  const [ratingDist, setRatingDist] = useState<Array<{ star: number; count: number }>>([]);
  const [sourceDist, setSourceDist] = useState<Record<string, number>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pushRecords, setPushRecords] = useState<PushRecord[]>([]);
  const [pushEvents, setPushEvents] = useState<PushEventLog[]>([]);
  const [satisfactionTrend, setSatisfactionTrend] = useState<Array<{ date: string; avgRating: number; count: number }>>([]);
  const [satisfactionBySource, setSatisfactionBySource] = useState<Record<string, { avgRating: number; count: number }>>({});
  const [ticketStats, setTicketStats] = useState<{
    total: number; by_status: Record<string, number>; by_category: Record<string, number>;
    avg_resolution_hours: number | null; avg_first_response_hours: number | null; overdue_count: number;
  } | null>(null);
  const [ticketTrend, setTicketTrend] = useState<Array<{ date: string; created: number; closed: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 使用 Promise.allSettled 确保部分 API 失败不影响整体加载
      const results = await Promise.allSettled([
        fetch('/api/analytics?include_tickets=true'),
        fetch('/api/push/records'),
        fetch('/api/push/events'),
      ]);

      // 处理 analytics 数据（核心数据，失败时抛出错误）
      const analyticsResult = results[0];
      if (analyticsResult.status === 'rejected' || !analyticsResult.value.ok) {
        throw new Error('分析数据加载失败');
      }
      const data = await analyticsResult.value.json();
      if (data.metrics) {
        setMetrics(data.metrics);
        setTrendData(data.trendData || []);
        setMsgTrendData(data.messageTrendData || []);
        setRatingDist(data.ratingDistribution || []);
        setSourceDist(data.sourceDistribution || {});
        setAlerts(data.recentAlerts || []);
        setSatisfactionTrend(data.satisfactionTrend || []);
        setSatisfactionBySource(data.satisfactionBySource || {});
      }
      if (data.ticket_stats) {
        setTicketStats(data.ticket_stats);
        setTicketTrend(data.ticket_trend || []);
      }

      // 处理推送记录（失败时使用空数组降级）
      const pushRecordsResult = results[1];
      if (pushRecordsResult.status === 'fulfilled' && pushRecordsResult.value.ok) {
        const pushRecordsData = await pushRecordsResult.value.json();
        setPushRecords(pushRecordsData.records || []);
      } else {
        setPushRecords([]);
      }

      // 处理事件日志（失败时使用空数组降级）
      const pushEventsResult = results[2];
      if (pushEventsResult.status === 'fulfilled' && pushEventsResult.value.ok) {
        const pushEventsData = await pushEventsResult.value.json();
        setPushEvents((pushEventsData.events || []).slice(0, 5));
      } else {
        setPushEvents([]);
      }
    } catch (err) {
      logger.error('加载分析数据失败', { error: err });
      toast.error('加载分析数据失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  }, []);

  // 单独刷新告警数据
  const refreshAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAlerts(data.recentAlerts || []);
    } catch (err) {
      logger.error('加载告警数据失败', { error: err });
      toast.error('加载告警数据失败');
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sourceChartData = useMemo(() =>
    Object.entries(sourceDist).map(([key, value]) => ({
      name: SOURCE_LABELS[key] || key,
      value,
    })),
    [sourceDist]
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">数据分析</h1>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.97] transition-all duration-200"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          刷新数据
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Metric Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <MetricCard
            icon={MessageSquare}
            label="总对话数"
            value={metrics?.totalConversations || 0}
            subLabel="今日新增"
            subValue={metrics?.todayConversations || 0}
            trend={metrics?.todayConversations ? 'up' : 'neutral'}
            color="primary"
            delay={1}
          />
          <MetricCard
            icon={TrendingUp}
            label="总消息数"
            value={metrics?.totalMessages || 0}
            subLabel="平均每对话"
            subValue={metrics?.avgMessagesPerConv || 0}
            color="success"
            delay={2}
          />
          <MetricCard
            icon={Star}
            label="平均满意度"
            value={metrics?.avgRating || 0}
            subLabel="评分制"
            subValue="5分制"
            color="amber"
            delay={3}
          />
          <MetricCard
            icon={Zap}
            label="自动回复命中率"
            value={`${metrics?.autoReplyHitRate || 0}%`}
            subLabel="活跃对话"
            subValue={metrics?.activeConversations || 0}
            color="violet"
            delay={4}
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Conversation Trend */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">对话趋势（近7天）</h3>
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="h-56">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}
                    />
                    <Area type="monotone" dataKey="count" stroke="var(--chart-1)" fill="url(#colorConv)" strokeWidth={2} name="对话数" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
          </div>

          {/* Message Trend */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">消息趋势（近7天）</h3>
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="h-56">
              {msgTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={msgTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="user" name="用户消息" fill="var(--chart-1)" radius={[2, 2, 0, 0]} barSize={16} />
                    <Bar dataKey="assistant" name="AI回复" fill="var(--chart-2)" radius={[2, 2, 0, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Rating Distribution */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">评分分布</h3>
              <Star className="w-4 h-4 text-amber-400" />
            </div>
            <div className="h-56">
              {ratingDist.some((r) => r.count > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ratingDist} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="star"
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `${v}星`}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const value = payload[0]?.value;
                        return (
                          <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground shadow-sm">
                            {`数量：${value}`}
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="var(--chart-1)"
                      radius={[0, 4, 4, 0]}
                      barSize={20}
                      isAnimationActive
                      animationBegin={200}
                      animationDuration={800}
                      animationEasing="ease-out"
                    >
                      {ratingDist.map((entry, index) => (
                        <Cell key={entry.star} fill={RATING_COLORS[index]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">暂无评价数据</div>
              )}
            </div>
          </div>

          {/* Source Distribution */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">对话来源分布</h3>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="h-56 flex items-center justify-center">
              {sourceChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sourceChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      isAnimationActive
                      animationBegin={200}
                      animationDuration={900}
                      animationEasing="ease-out"
                    >
                      {sourceChartData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={SOURCE_COLORS[index % SOURCE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    {/* 中心显示总数 */}
                    <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 600 }}>
                      {sourceChartData.reduce((sum, item) => sum + item.value, 0)}
                    </text>
                    <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
                      总对话
                    </text>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(value, entry: { payload?: { value?: number } }) => {
                        const item = sourceChartData.find(d => d.name === value);
                        return `${value} (${item?.value || 0})`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-sm text-muted-foreground">暂无数据</div>
              )}
            </div>
          </div>
        </div>

        {/* Charts Row 3 - Satisfaction Trend */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Satisfaction Trend Line */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">满意度趋势（近7天）</h3>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="h-56">
              {satisfactionTrend.some((s) => s.count > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={satisfactionTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}
                      formatter={(value: number, name: string) => {
                        if (name === 'avgRating') return [value.toFixed(1), '平均评分'];
                        return [value, '评价数'];
                      }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="avgRating" name="平均评分" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 4, fill: 'var(--chart-1)' }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="count" name="评价数" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: 'var(--chart-2)' }} yAxisId={0} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">暂无满意度数据</div>
              )}
            </div>
          </div>

          {/* Satisfaction by Source */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">各渠道满意度</h3>
              <Star className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="h-56">
              {Object.keys(satisfactionBySource).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={Object.entries(satisfactionBySource).map(([source, data]) => ({
                    name: SOURCE_LABELS[source] || source,
                    avgRating: data.avgRating,
                    count: data.count,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}
                      formatter={(value: number, name: string) => {
                        if (name === 'avgRating') return [value.toFixed(1), '平均评分'];
                        return [value, '评价数'];
                      }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="avgRating" name="平均评分" fill="var(--chart-1)" radius={[4, 4, 0, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">暂无渠道满意度数据</div>
              )}
            </div>
          </div>
        </div>

        {/* Alerts Section */}
        <div className="rounded-xl border border-border bg-card p-5 mb-4 card-hover-lift">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">异常告警</h3>
              {alerts.filter(a => !a.is_resolved).length > 0 && (
                <span className="min-w-[20px] h-5 flex items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-1.5 animate-scale-in">
                  {alerts.filter(a => !a.is_resolved).length}
                </span>
              )}
            </div>
            <button
              onClick={refreshAlerts}
              disabled={alertsLoading}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {alertsLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  刷新中
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  刷新
                </>
              )}
            </button>
          </div>
          {alerts.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-success/40" />
              暂无异常告警
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  onClick={() => {
                    if (!alert.conversation_id) {
                      toast.error('该告警暂无关联会话');
                      return;
                    }
                    const convId = alert.conversation_id;
                    if (alert.type === 'ticket_created' || alert.type === 'ticket_status_changed' || alert.type === 'ticket_assigned' || alert.type === 'ticket_unassigned' || alert.type === 'ticket_mention' || alert.type === 'ticket_handled' || alert.type === 'handoff' || alert.type === 'ticket_handed_over') {
                      router.push(`/tickets`);
                    } else {
                      router.push(`/?conversation=${convId}`);
                    }
                  }}
                  className={`flex items-start gap-3 p-3 rounded-lg border border-border transition-colors cursor-pointer hover:border-primary/30 ${
                    alert.is_resolved
                      ? 'border-border/50 bg-muted/20 opacity-60'
                      : alert.severity === 'critical'
                      ? 'border-destructive/20 bg-destructive/5'
                      : alert.severity === 'warning'
                      ? 'border-warning/20 bg-warning/5'
                      : 'bg-muted/30'
                  }`}
                >
                  <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${
                    alert.is_resolved
                      ? 'text-muted-foreground'
                      : alert.severity === 'critical'
                      ? 'text-destructive'
                      : 'text-warning'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{alert.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(alert.created_at).toLocaleString('zh-CN')}
                      {alert.is_resolved && ' · 已处理'}
                    </p>
                  </div>
                  {!alert.is_resolved && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await fetch(`/api/alerts?id=${alert.id}`, { method: 'PATCH' });
                          if (!res.ok) {
                            toast.error('标记失败');
                            return;
                          }
                          setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, is_resolved: true } : a));
                        } catch { /* ignore */ }
                      }}
                      className="text-[10px] px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      标记已处理
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ticket Statistics Section */}
        {ticketStats && ticketStats.total > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Ticket Overview */}
            <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
              <div className="flex items-center gap-2 mb-4">
                <Ticket className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">工单概览</h3>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-lg font-bold text-foreground">{ticketStats.total}</div>
                  <div className="text-[10px] text-muted-foreground">总工单</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-lg font-bold text-foreground">{ticketStats.avg_resolution_hours != null ? ticketStats.avg_resolution_hours.toFixed(1) + 'h' : '-'}</div>
                  <div className="text-[10px] text-muted-foreground">平均处理</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-lg font-bold text-foreground">{ticketStats.avg_first_response_hours != null ? ticketStats.avg_first_response_hours.toFixed(1) + 'h' : '-'}</div>
                  <div className="text-[10px] text-muted-foreground">平均响应</div>
                </div>
              </div>
              <div className="space-y-2">
                {Object.entries(ticketStats.by_status).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{TICKET_STATUS_LABELS[status] || status}</span>
                    <div className="flex items-center gap-2 flex-1 mx-3">
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${TICKET_STATUS_COLORS[status] || 'bg-gray-400'}`} style={{ width: `${ticketStats.total > 0 ? (count / ticketStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                    <span className="font-medium text-foreground">{count}</span>
                  </div>
                ))}
                {ticketStats.overdue_count > 0 && (
                  <div className="flex items-center justify-between text-xs text-red-500 pt-1 border-t border-border">
                    <span>超时工单</span>
                    <span className="font-medium">{ticketStats.overdue_count}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Ticket Trend */}
            <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">工单趋势 (7天)</h3>
              </div>
              {ticketTrend.length > 0 ? (
                <div className="space-y-1.5">
                  {ticketTrend.map(d => (
                    <div key={d.date} className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground w-16">{d.date.slice(5)}</span>
                      <div className="flex-1 flex items-center gap-1">
                        <div className="h-2 bg-blue-400/80 rounded-sm" style={{ width: `${Math.max(d.created * 8, d.created > 0 ? 4 : 0)}px` }} title={`新建 ${d.created}`} />
                        <div className="h-2 bg-emerald-400/80 rounded-sm" style={{ width: `${Math.max(d.closed * 8, d.closed > 0 ? 4 : 0)}px` }} title={`关闭 ${d.closed}`} />
                      </div>
                      <span className="text-muted-foreground w-12 text-right">{d.created}/{d.closed}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-4 pt-2 border-t border-border text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-400/80 rounded-sm" />新建</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400/80 rounded-sm" />关闭</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground text-center py-4">暂无趋势数据</div>
              )}
            </div>
          </div>
        )}

        {/* Push Records Section */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Push Records Table */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">推送记录</h3>
              </div>
              <span className="text-xs text-muted-foreground">{pushRecords.length} 条记录</span>
            </div>
            {pushRecords.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">暂无推送记录</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pushRecords.map((rec) => {
                  const eventInfo = PUSH_EVENT_TYPES[rec.trigger_event];
                  const statusIcon = rec.status === 'sent' ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : rec.status === 'failed' ? <XCircleIcon className="w-3.5 h-3.5 text-destructive" /> : <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />;
                  const recordTime = rec.sent_at || rec.created_at;
                  return (
                    <div key={rec.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {statusIcon}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-foreground truncate">{rec.recipient_id}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">{rec.content}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {eventInfo && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium ${eventInfo.color}`}>
                            {eventInfo.icon}
                            {eventInfo.label}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{recordTime ? new Date(recordTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Event Log */}
          <div className="rounded-xl border border-border bg-card p-5 card-hover-lift">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Webhook className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">最近事件日志</h3>
              </div>
              <span className="text-xs text-muted-foreground">近 5 条</span>
            </div>
            {pushEvents.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">暂无事件日志</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pushEvents.map((evt) => {
                  const eventInfo = PUSH_EVENT_TYPES[evt.event_type];
                  return (
                    <div key={evt.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center gap-2.5">
                        {eventInfo && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium ${eventInfo.color}`}>
                            {eventInfo.icon}
                            {eventInfo.label}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {JSON.stringify(evt.event_data).slice(0, 60)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs ${evt.status === 'processed' ? 'text-success' : evt.status === 'failed' ? 'text-destructive' : 'text-amber-500'}`}>
                          {evt.status === 'processed' ? '已处理' : evt.status === 'failed' ? '处理失败' : '待处理'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{new Date(evt.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats Footer */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 animate-stagger stagger-5 card-hover-lift">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">活跃对话</p>
              <p className="text-lg font-semibold text-foreground">{metrics?.activeConversations || 0}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 animate-stagger stagger-6 card-hover-lift">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">今日对话</p>
              <p className="text-lg font-semibold text-foreground">{metrics?.todayConversations || 0}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 animate-stagger stagger-7 card-hover-lift">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">满意度</p>
              <p className="text-lg font-semibold text-foreground">{metrics?.avgRating || 0} / 5</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subLabel,
  subValue,
  trend,
  color,
  delay = 1,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subLabel: string;
  subValue: string | number;
  trend?: 'up' | 'down' | 'neutral';
  color: 'primary' | 'success' | 'amber' | 'violet';
  delay?: number;
}) {
  const colorMap = {
    primary: { bg: 'bg-primary/10', text: 'text-primary' },
    success: { bg: 'bg-success/10', text: 'text-success' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-500' },
    violet: { bg: 'bg-violet-50 dark:bg-violet-950', text: 'text-violet-500' },
  };
  const c = colorMap[color];

  return (
    <div className={`rounded-xl border border-border bg-card p-5 animate-stagger stagger-${delay} card-hover-lift`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${c.text}`} />
        </div>
        {trend === 'up' && (
          <span className="flex items-center gap-0.5 text-xs text-success">
            <ArrowUpRight className="w-3.5 h-3.5" />
            上升
          </span>
        )}
        {trend === 'down' && (
          <span className="flex items-center gap-0.5 text-xs text-destructive">
            <ArrowDownRight className="w-3.5 h-3.5" />
            下降
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-foreground mb-0.5">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{subLabel}</span>
        <span className="text-xs font-medium text-foreground">{subValue}</span>
      </div>
    </div>
  );
}
