"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
    Megaphone,
    Play,
    Pause,
    Plus,
    Send,
    Eye,
    MessageSquare,
    TrendingUp,
    BarChart3,
    Target,
    Users,
    ShoppingCart,
    UserCheck,
    Crown,
    CalendarDays,
} from "lucide-react";
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";

interface MarketingCampaign {
    id: string;
    name: string;
    type: string;
    target_segment: Record<string, unknown>;
    bot_id: string | null;
    status: string;
    ab_variants: {
        enabled?: boolean;
        variant_a?: string;
        variant_b?: string;
    } | null;
    message_template?: string | null;
    trigger_type?: string;
    scheduled_at?: string | null;
    created_at: string;
    updated_at: string | null;
    stats?: {
        sent: number;
        replied: number;
        converted: number;
    };
}

interface MarketingStats {
    total_sent: number;
    total_replied: number;
    total_converted: number;
    avg_reply_rate: number;
}

const TYPE_CONFIG: Record<string, {
    label: string;
    icon: React.ElementType;
    color: string;
}> = {
    abandoned_cart: {
        label: "购物车挽回",
        icon: ShoppingCart,
        color: "bg-orange-100 text-orange-700"
    },

    browsing_nurture: {
        label: "浏览培育",
        icon: Eye,
        color: "bg-blue-100 text-blue-700"
    },

    win_back: {
        label: "流失召回",
        icon: UserCheck,
        color: "bg-purple-100 text-purple-700"
    },
    promotion: {
        label: "促销活动",
        icon: Megaphone,
        color: "bg-red-100 text-red-700"
    },
    announcement: {
        label: "公告通知",
        icon: Send,
        color: "bg-teal-100 text-teal-700"
    },
    loyalty: {
        label: "会员关怀",
        icon: Crown,
        color: "bg-yellow-100 text-yellow-700"
    }
};

const STATUS_CONFIG: Record<string, {
    label: string;
    color: string;
}> = {
    draft: {
        label: "草稿",
        color: "bg-blue-100 text-blue-700"
    },

    running: {
        label: "运行中",
        color: "bg-green-100 text-green-700"
    },

    paused: {
        label: "已暂停",
        color: "bg-amber-100 text-amber-700"
    },

    completed: {
        label: "已完成",
        color: "bg-muted text-muted-foreground"
    },

    active: {
        label: "进行中",
        color: "bg-green-100 text-green-700"
    },

    scheduled: {
        label: "待投放",
        color: "bg-orange-100 text-orange-700"
    }
};

export default function MarketingPage() {
    const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);

    const [stats, setStats] = useState<MarketingStats>({
        total_sent: 0,
        total_replied: 0,
        total_converted: 0,
        avg_reply_rate: 0
    });

    // Analytics data
    const [analyticsData, setAnalyticsData] = useState<{
        overall: { total_sent: number; total_replied: number; total_converted: number; reply_rate: string };
        trend: Array<{ date: string; sent: number; replied: number; converted: number }>;
        by_type: Record<string, { sent: number; replied: number; converted: number }>;
        top_campaigns: Array<{ id: string; name: string; type: string; sent: number; replied: number; converted: number; reply_rate: string }>;
    } | null>(null);
    const analyticsDataLoadedRef = useRef(false);
    const [analyticsDays, setAnalyticsDays] = useState(30);
    const [loadingAnalytics, setLoadingAnalytics] = useState(false);

    // AB winner per campaign
    const [abWinners, setAbWinners] = useState<Record<string, { winner: string | null; confidence: number; reason: string }>>({});
    const [promoting, setPromoting] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<"campaigns" | "analytics">("campaigns");
    const [statusFilter, setStatusFilter] = useState("all");
    // Shared campaign form state (create + edit)
    const [campaignForm, setCampaignForm] = useState({
        name: "",
        type: "abandoned_cart",
        ab_enabled: false,
        variant_a: "",
        variant_b: "",
        message_template: "",
        trigger_type: "manual" as "manual" | "scheduled" | "event",
        scheduled_at: "",
    });

    // Structured segment form
    const [segmentForm, setSegmentForm] = useState({
        platform: "",
        tag: "",
        member_level: "",
        inactive_days: "",
        new_customer_days: "",
        min_conversations: "",
        max_conversations: "",
        exclude_anonymous: false,
    });

    // Customer tags for dynamic dropdown
    const [customerTags, setCustomerTags] = useState<Array<{ id: string; name: string }>>([]);
    const [segmentPreview, setSegmentPreview] = useState<{ total: number; samples: Array<{ id: string; name: string }> } | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [editingCampaign, setEditingCampaign] = useState<MarketingCampaign | null>(null);

    const buildSegment = () => {
        const seg: Record<string, unknown> = {};
        if (segmentForm.platform) seg.platform = segmentForm.platform;
        if (segmentForm.tag) seg.tag = segmentForm.tag;
        if (segmentForm.member_level) seg.member_level = segmentForm.member_level;
        if (segmentForm.inactive_days) seg.inactive_days = Number(segmentForm.inactive_days);
        if (segmentForm.new_customer_days) seg.new_customer_days = Number(segmentForm.new_customer_days);
        if (segmentForm.min_conversations) seg.min_conversations = Number(segmentForm.min_conversations);
        if (segmentForm.max_conversations) seg.max_conversations = Number(segmentForm.max_conversations);
        if (segmentForm.exclude_anonymous) seg.exclude_anonymous = true;
        return seg;
    };

    const handlePreviewSegment = async () => {
        setPreviewing(true);
        try {
            const res = await fetch('/api/marketing/preview-segment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target_segment: buildSegment() }),
            });
            const data = await res.json();
            setSegmentPreview(data.data ?? { total: 0, samples: [] });
        } catch {
            setSegmentPreview(null);
        } finally {
            setPreviewing(false);
        }
    };

    const fetchCustomerTags = useCallback(async () => {
        try {
            const res = await fetch('/api/customer-tags');
            const data = await res.json();
            setCustomerTags(data.data?.tags ?? []);
        } catch { /* ignore */ }
    }, []);

    const fetchAnalytics = useCallback(async () => {
        setLoadingAnalytics(true);
        try {
            const res = await fetch(`/api/marketing/analytics?days=${analyticsDays}`);
            const data = await res.json();
            if (data.data) {
                setAnalyticsData(data.data);
                analyticsDataLoadedRef.current = true;
                // Also update the summary stats
                setStats(data.data.overall ?? {
                    total_sent: 0, total_replied: 0, total_converted: 0, avg_reply_rate: 0
                });
            }
        } catch (err) {
            console.error("Failed to fetch analytics:", err);
        } finally {
            setLoadingAnalytics(false);
        }
    }, [analyticsDays]);

    const fetchAbWinners = useCallback(async () => {
        for (const c of campaigns) {
            if (!c.ab_variants?.enabled) continue;
            try {
                const res = await fetch('/api/marketing/ab-winner', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ campaign_id: c.id }),
                });
                const data = await res.json();
                if (data.data) setAbWinners(prev => ({ ...prev, [c.id]: data.data }));
            } catch { /* ignore */ }
        }
    }, [campaigns]);

    const handlePromoteWinner = async (campaignId: string, winner: string) => {
        setPromoting(campaignId);
        try {
            const res = await fetch('/api/marketing/ab-winner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaign_id: campaignId, action: 'promote', winner }),
            });
            if (res.ok) {
                toast.success('已推广获胜变体，A/B测试已关闭');
                setAbWinners(prev => ({ ...prev, [campaignId]: { winner: null, confidence: 0, reason: '已推广' } }));
                fetchCampaigns();
            } else {
                toast.error('推广失败');
            }
        } catch {
            toast.error('推广失败');
        } finally {
            setPromoting(null);
        }
    };

    const fetchCampaigns = useCallback(async () => {
        try {
            const res = await fetch("/api/marketing");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setCampaigns(data.campaigns || []);
            if (!analyticsDataLoadedRef.current) {
                setStats(data.stats || data.overall_stats || {
                    total_sent: 0,
                    total_replied: 0,
                    total_converted: 0,
                    avg_reply_rate: 0
                });
            }
        } catch (err) {
            console.error("Failed to fetch campaigns:", err);
        }
    }, []);

    useEffect(() => {
        fetchCampaigns();
        fetchCustomerTags();
        if (activeTab === "analytics") {
            fetchAnalytics();
            fetchAbWinners();
        }
    }, [fetchCampaigns, fetchCustomerTags, activeTab, fetchAnalytics, fetchAbWinners]);

    const openCreate = () => {
        setEditingCampaign(null);
        setCampaignForm({ name: "", type: "abandoned_cart", ab_enabled: false, variant_a: "", variant_b: "", message_template: "", trigger_type: "manual", scheduled_at: "" });
        setSegmentForm({ platform: "", tag: "", member_level: "", inactive_days: "", new_customer_days: "", min_conversations: "", max_conversations: "", exclude_anonymous: false });
        setSegmentPreview(null);
        setCreateOpen(true);
    };

    const openEdit = (c: MarketingCampaign) => {
        setEditingCampaign(c);
        const seg = (c.target_segment ?? {}) as Record<string, unknown>;
        setSegmentForm({
            platform: String(seg.platform ?? ""),
            tag: String(seg.tag ?? ""),
            member_level: String(seg.member_level ?? ""),
            inactive_days: seg.inactive_days ? String(seg.inactive_days) : "",
            new_customer_days: seg.new_customer_days ? String(seg.new_customer_days) : "",
            min_conversations: seg.min_conversations ? String(seg.min_conversations) : "",
            max_conversations: seg.max_conversations ? String(seg.max_conversations) : "",
            exclude_anonymous: Boolean(seg.exclude_anonymous),
        });
        const variants = c.ab_variants as { enabled?: boolean; variant_a?: string; variant_b?: string } | null;
        setCampaignForm({
            name: c.name,
            type: c.type,
            ab_enabled: variants?.enabled ?? false,
            variant_a: variants?.variant_a ?? "",
            variant_b: variants?.variant_b ?? "",
            message_template: (c as unknown as { message_template?: string }).message_template ?? "",
            trigger_type: ((c as unknown as { trigger_type?: string }).trigger_type ?? "manual") as "manual" | "scheduled" | "event",
            scheduled_at: (c as unknown as { scheduled_at?: string }).scheduled_at ? ((c as unknown as { scheduled_at?: string }).scheduled_at ?? "").slice(0, 16) : "",
        });
        setSegmentPreview(null);
        setCreateOpen(true);
    };

    const handleSaveCampaign = async () => {
        try {
            const body: Record<string, unknown> = {
                name: campaignForm.name,
                type: campaignForm.type,
                target_segment: buildSegment(),
            };
            if (campaignForm.ab_enabled) {
                body.ab_variants = {
                    enabled: true,
                    variant_a: campaignForm.variant_a,
                    variant_b: campaignForm.variant_b,
                };
            }
            if (campaignForm.message_template) {
                body.message_template = campaignForm.message_template;
            }
            if (campaignForm.trigger_type) {
                body.trigger_type = campaignForm.trigger_type;
            }
            if (campaignForm.scheduled_at) {
                body.scheduled_at = new Date(campaignForm.scheduled_at).toISOString();
            }
            const res = await fetch("/api/marketing", {
                method: editingCampaign ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editingCampaign ? { ...body, id: editingCampaign.id, status: editingCampaign.status } : body),
            });
            if (!res.ok) { toast.error(editingCampaign ? "更新活动失败" : "创建活动失败"); return; }
            setCreateOpen(false);
            fetchCampaigns();
        } catch (err) {
            console.error("Failed to save campaign:", err);
        }
    };

    const handleToggleStatus = async (campaign: MarketingCampaign) => {
        const newStatus = campaign.status === "running" ? "paused" : "running";

        try {
            const res = await fetch("/api/marketing", {
                method: "PATCH",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    id: campaign.id,
                    status: newStatus
                })
            });

            if (!res.ok) {
                toast.error("状态更新失败");
                return;
            }

            fetchCampaigns();
        } catch (err) {
            console.error("Failed to toggle campaign status:", err);
        }
    };

    const [executingCampaignId, setExecutingCampaignId] = useState<string | null>(null);

    const handleExecuteCampaign = async (campaign: MarketingCampaign) => {
        if (!confirm(`确定要执行「${campaign.name}」吗？将向匹配的客户发送消息。`)) return;
        setExecutingCampaignId(campaign.id);
        try {
            const res = await fetch('/api/marketing/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaign_id: campaign.id }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error?.message || '执行失败');
                return;
            }
            const result = data.data;
            toast.success(`活动已执行：触达 ${result.totalTargeted} 位客户，成功 ${result.successCount}，失败 ${result.failCount}`);
            fetchCampaigns();
        } catch (err) {
            console.error('Failed to execute campaign:', err);
            toast.error('执行失败');
        } finally {
            setExecutingCampaignId(null);
        }
    };

    const filteredCampaigns = campaigns.filter(c => statusFilter === "all" || c.status === statusFilter);

    return (
        <div className="h-full flex flex-col page-transition">
            {/* Header */}
            <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
                <h1 className="text-base font-semibold text-foreground">营销管理</h1>
                <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1" />创建活动
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* Tab bar */}
                <div className="px-6 py-3 border-b border-border/50">
                    <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
                        <button
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "campaigns" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                            onClick={() => setActiveTab("campaigns")}>营销活动
                        </button>
                        <button
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "analytics" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                            onClick={() => setActiveTab("analytics")}>效果分析
                        </button>
                    </div>
                </div>

                {activeTab === "campaigns" && <div className="p-6 space-y-4">
                    {/* Filter bar */}
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                            {["all", "active", "running", "paused", "completed", "draft"].map(s => <button
                                key={s}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                                onClick={() => setStatusFilter(s)}>
                                {s === "all" ? "全部" : STATUS_CONFIG[s]?.label || s}
                            </button>)}
                        </div>
                    </div>
                    {/* Campaign grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredCampaigns.map(campaign => {
                            const typeConfig = TYPE_CONFIG[campaign.type] || {
                                label: campaign.type,
                                icon: Target,
                                color: "bg-muted text-muted-foreground"
                            };

                            const statusConfig = STATUS_CONFIG[campaign.status] || {
                                label: campaign.status,
                                color: "bg-muted text-muted-foreground"
                            };

                            const TypeIcon = typeConfig.icon;

                            return (
                                <Card key={campaign.id} className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-5">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <TypeIcon className="h-5 w-5 text-muted-foreground" />
                                                <h3 className="font-medium text-foreground">{campaign.name}</h3>
                                            </div>
                                            <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                                        </div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <Badge variant="outline" className={typeConfig.color}>{typeConfig.label}</Badge>
                                            {campaign.ab_variants?.enabled && (
                                                abWinners[campaign.id]?.winner ? (
                                                    <Badge variant="outline" className={`${abWinners[campaign.id].winner === 'A' ? 'bg-green-50 text-green-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                        变体{abWinners[campaign.id].winner}领先
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="bg-violet-50 text-violet-700">A/B测试</Badge>
                                                )
                                            )}
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 mb-4">
                                            <div className="text-center">
                                                <div
                                                    className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                                                    <Send className="h-3 w-3" />
                                                    <span className="text-xs">触达</span>
                                                </div>
                                                <p className="text-lg font-semibold text-foreground">{campaign.stats?.sent ?? 0}</p>
                                            </div>
                                            <div className="text-center">
                                                <div
                                                    className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                                                    <MessageSquare className="h-3 w-3" />
                                                    <span className="text-xs">回复</span>
                                                </div>
                                                <p className="text-lg font-semibold text-foreground">{campaign.stats?.replied ?? 0}</p>
                                            </div>
                                            <div className="text-center">
                                                <div
                                                    className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                                                    <TrendingUp className="h-3 w-3" />
                                                    <span className="text-xs">转化</span>
                                                </div>
                                                <p className="text-lg font-semibold text-foreground">{campaign.stats?.converted ?? 0}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {campaign.status === "active" && <Button variant="default" size="sm" onClick={() => handleExecuteCampaign(campaign)} disabled={executingCampaignId === campaign.id}>
                                                <Send className="h-3 w-3 mr-1" />{executingCampaignId === campaign.id ? "执行中..." : "投放"}
                                            </Button>}
                                            {(campaign.status === "running" || campaign.status === "paused") && <Button variant="outline" size="sm" onClick={() => handleToggleStatus(campaign)}>
                                                {campaign.status === "running" ? <><Pause className="h-3 w-3 mr-1" />暂停</> : <><Play className="h-3 w-3 mr-1" />启动</>}
                                            </Button>}
                                            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => openEdit(campaign)}>
                                                <Eye className="h-3 w-3 mr-1" />编辑
                                            </Button>
                                            {campaign.ab_variants?.enabled && abWinners[campaign.id]?.winner && (
                                                <Button variant="ghost" size="sm" className="text-green-600" onClick={() => handlePromoteWinner(campaign.id, abWinners[campaign.id].winner!)} disabled={promoting === campaign.id}>
                                                    {promoting === campaign.id ? "推广中..." : "推广获胜变体"}
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="sm" className="text-muted-foreground">
                                                <BarChart3 className="h-3 w-3 mr-1" />详情
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                        {filteredCampaigns.length === 0 && <div className="col-span-2 py-12 text-center text-muted-foreground">暂无营销活动</div>}
                    </div>
                </div>}
                {activeTab === "analytics" && (
                    <div className="p-6 space-y-6">
                        {/* Header + time range */}
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-foreground">营销分析</h2>
                            <div className="flex items-center gap-2">
                                <Select value={String(analyticsDays)} onValueChange={v => setAnalyticsDays(Number(v))}>
                                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="7">近 7 天</SelectItem>
                                        <SelectItem value="14">近 14 天</SelectItem>
                                        <SelectItem value="30">近 30 天</SelectItem>
                                        <SelectItem value="90">近 90 天</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" onClick={fetchAnalytics} disabled={loadingAnalytics}>
                                    {loadingAnalytics ? "加载中..." : "刷新"}
                                </Button>
                            </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-4 gap-4">
                            <Card>
                                <CardContent className="p-4 flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-blue-100"><Send className="h-5 w-5 text-blue-600" /></div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">总触达数</p>
                                        <p className="text-xl font-semibold text-foreground">{(analyticsData?.overall?.total_sent ?? stats.total_sent).toLocaleString()}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4 flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-green-100"><MessageSquare className="h-5 w-5 text-green-600" /></div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">总回复数</p>
                                        <p className="text-xl font-semibold text-foreground">{(analyticsData?.overall?.total_replied ?? stats.total_replied).toLocaleString()}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4 flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-purple-100"><TrendingUp className="h-5 w-5 text-purple-600" /></div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">总转化数</p>
                                        <p className="text-xl font-semibold text-foreground">{(analyticsData?.overall?.total_converted ?? stats.total_converted).toLocaleString()}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4 flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-amber-100"><Target className="h-5 w-5 text-amber-600" /></div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">平均回复率</p>
                                        <p className="text-xl font-semibold text-foreground">{analyticsData?.overall?.reply_rate ?? "0.0"}%</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Trend chart + Type breakdown */}
                        <div className="grid grid-cols-3 gap-4">
                            <Card className="col-span-2">
                                <CardContent className="p-0">
                                    <div className="px-5 py-3 border-b">
                                        <h3 className="font-medium text-foreground">触达趋势</h3>
                                    </div>
                                    {loadingAnalytics ? (
                                        <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
                                    ) : analyticsData?.trend && analyticsData.trend.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={260}>
                                            <LineChart data={analyticsData.trend} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} stroke="hsl(var(--muted-foreground))" />
                                                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                                                <Tooltip contentStyle={{ fontSize: 12 }} labelFormatter={d => String(d)} />
                                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                                <Line type="monotone" dataKey="sent" stroke="#3b82f6" name="触达" dot={false} />
                                                <Line type="monotone" dataKey="replied" stroke="#22c55e" name="回复" dot={false} />
                                                <Line type="monotone" dataKey="converted" stroke="#a855f7" name="转化" dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="flex items-center justify-center h-64 text-muted-foreground">暂无趋势数据</div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Type breakdown */}
                            <Card>
                                <CardContent className="p-0">
                                    <div className="px-5 py-3 border-b">
                                        <h3 className="font-medium text-foreground">活动类型分布</h3>
                                    </div>
                                    {analyticsData?.by_type && Object.keys(analyticsData.by_type).length > 0 ? (
                                        <div className="p-4 space-y-3">
                                            {Object.entries(analyticsData.by_type).map(([type, s]) => {
                                                const typeName: Record<string, string> = {
                                                    abandoned_cart: "购物车挽回", browsing_nurture: "浏览培育",
                                                    win_back: "流失召回", promotion: "促销活动",
                                                    announcement: "公告通知", loyalty: "会员关怀"
                                                };
                                                return (
                                                    <div key={type} className="space-y-1">
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-foreground">{typeName[type] ?? type}</span>
                                                            <span className="text-muted-foreground">{s.sent} 触达</span>
                                                        </div>
                                                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                            <div className="h-full bg-blue-500 rounded-full"
                                                                style={{ width: `${Math.min(100, (s.sent / Math.max(1, analyticsData.overall?.total_sent ?? 1)) * 100)}%` }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-64 text-muted-foreground">暂无数据</div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Comparison table */}
                        <Card>
                            <CardContent className="p-0">
                                <div className="px-5 py-3 border-b">
                                    <h3 className="font-medium text-foreground">活动效果对比</h3>
                                </div>
                                <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b bg-muted/50">
                                            <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">活动名称</th>
                                            <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">触达数</th>
                                            <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">回复数</th>
                                            <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">回复率</th>
                                            <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">转化数</th>
                                            <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">转化率</th>
                                            <th className="text-center px-5 py-3 text-xs font-medium text-muted-foreground">A/B获胜</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {campaigns.map(c => {
                                            const s = c.stats || { sent: 0, replied: 0, converted: 0 };
                                            const replyRate = s.sent > 0 ? (s.replied / s.sent * 100).toFixed(1) : "0.0";
                                            const convRate = s.sent > 0 ? (s.converted / s.sent * 100).toFixed(1) : "0.0";
                                            return (
                                                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                                                    <td className="px-5 py-3 text-sm text-foreground">{c.name}</td>
                                                    <td className="px-5 py-3 text-sm text-center text-foreground">{s.sent}</td>
                                                    <td className="px-5 py-3 text-sm text-center text-foreground">{s.replied}</td>
                                                    <td className="px-5 py-3 text-sm text-center text-foreground">{replyRate}%</td>
                                                    <td className="px-5 py-3 text-sm text-center text-foreground">{s.converted}</td>
                                                    <td className="px-5 py-3 text-sm text-center text-foreground">{convRate}%</td>
                                                    <td className="px-5 py-3 text-sm text-center text-muted-foreground">
                                                        {c.ab_variants?.enabled ? "变体A" : "-"}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingCampaign ? '编辑营销活动' : '创建营销活动'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-5 py-4">
                        {/* 基础信息 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">活动名称</label>
                            <Input
                                value={campaignForm.name}
                                onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })}
                                placeholder="输入活动名称" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">活动类型</label>
                            <Select value={campaignForm.type} onValueChange={v => setCampaignForm({ ...campaignForm, type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="abandoned_cart">购物车挽回</SelectItem>
                                    <SelectItem value="browsing_nurture">浏览培育</SelectItem>
                                    <SelectItem value="win_back">流失客户召回</SelectItem>
                                    <SelectItem value="promotion">促销活动</SelectItem>
                                    <SelectItem value="announcement">公告通知</SelectItem>
                                    <SelectItem value="loyalty">会员关怀</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* 消息模板 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">消息模板 <span className="text-xs text-muted-foreground font-normal">（支持变量：&#123;&#123;customer_name&#125;&#125;、&#123;&#123;campaign_name&#125;&#125;）</span></label>
                            <textarea
                                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={campaignForm.message_template}
                                onChange={e => setCampaignForm({ ...campaignForm, message_template: e.target.value })}
                                placeholder="您好，&#123;&#123;customer_name&#125;&#125;，&#123;&#123;campaign_name&#125;&#125;火热进行中，欢迎咨询！" />
                        </div>

                        {/* 投放方式 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">投放方式</label>
                            <Select value={campaignForm.trigger_type} onValueChange={v => setCampaignForm({ ...campaignForm, trigger_type: v as 'manual' | 'scheduled' | 'event' })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="manual">立即投放（手动启动）</SelectItem>
                                    <SelectItem value="scheduled">定时投放（指定时间自动发送）</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {campaignForm.trigger_type === "scheduled" && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">投放时间</label>
                                <input
                                    type="datetime-local"
                                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    value={campaignForm.scheduled_at}
                                    onChange={e => setCampaignForm({ ...campaignForm, scheduled_at: e.target.value })}
                                    min={new Date().toISOString().slice(0, 16)}
                                />
                            </div>
                        )}

                        {/* 客群定向 */}
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-foreground">目标客群</label>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">来源平台</label>
                                    <Select value={segmentForm.platform} onValueChange={v => setSegmentForm({ ...segmentForm, platform: v })}>
                                        <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">全部</SelectItem>
                                            <SelectItem value="web">网页</SelectItem>
                                            <SelectItem value="qianniu">千牛</SelectItem>
                                            <SelectItem value="doudian">抖店</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">客户标签</label>
                                    <Select value={segmentForm.tag} onValueChange={v => setSegmentForm({ ...segmentForm, tag: v })}>
                                        <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">全部</SelectItem>
                                            {customerTags.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">会员等级</label>
                                    <Select value={segmentForm.member_level} onValueChange={v => setSegmentForm({ ...segmentForm, member_level: v })}>
                                        <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">全部</SelectItem>
                                            <SelectItem value="普通">普通</SelectItem>
                                            <SelectItem value="银卡">银卡</SelectItem>
                                            <SelectItem value="金卡">金卡</SelectItem>
                                            <SelectItem value="钻石">钻石</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">活跃状态</label>
                                    <Select value={segmentForm.inactive_days} onValueChange={v => setSegmentForm({ ...segmentForm, inactive_days: v, new_customer_days: "" })}>
                                        <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">全部</SelectItem>
                                            <SelectItem value="7">活跃（7天内）</SelectItem>
                                            <SelectItem value="30">一般（7-30天）</SelectItem>
                                            <SelectItem value="60">沉默（30天以上）</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-muted-foreground">客户类型</label>
                                    <Select value={segmentForm.new_customer_days} onValueChange={v => setSegmentForm({ ...segmentForm, new_customer_days: v, inactive_days: "" })}>
                                        <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">全部</SelectItem>
                                            <SelectItem value="7">新客户（7天内）</SelectItem>
                                            <SelectItem value="30">新客户（30天内）</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex items-end gap-2">
                                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={segmentForm.exclude_anonymous}
                                            onChange={e => setSegmentForm({ ...segmentForm, exclude_anonymous: e.target.checked })}
                                            className="rounded border-border" />
                                        排除匿名访客
                                    </label>
                                </div>
                                <div className="col-span-2 space-y-1">
                                    <label className="text-xs text-muted-foreground">对话数区间</label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            min="0"
                                            value={segmentForm.min_conversations}
                                            onChange={e => setSegmentForm({ ...segmentForm, min_conversations: e.target.value })}
                                            placeholder="最小" className="w-28" />
                                        <span className="text-muted-foreground">—</span>
                                        <Input
                                            type="number"
                                            min="0"
                                            value={segmentForm.max_conversations}
                                            onChange={e => setSegmentForm({ ...segmentForm, max_conversations: e.target.value })}
                                            placeholder="最大" className="w-28" />
                                    </div>
                                </div>
                            </div>
                            {/* 客群预览 */}
                            <div className="flex items-center gap-3">
                                <Button variant="outline" size="sm" onClick={handlePreviewSegment} disabled={previewing}>
                                    {previewing ? "预览中..." : "预览匹配人数"}
                                </Button>
                                {segmentPreview !== null && (
                                    <span className="text-sm text-muted-foreground">
                                        匹配 <strong className="text-foreground">{segmentPreview.total}</strong> 位客户
                                        {segmentPreview.samples.length > 0 && (
                                            <span className="ml-1">（{segmentPreview.samples.map(s => s.name).join('、')}）</span>
                                        )}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* A/B 测试 */}
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="ab-test"
                                checked={campaignForm.ab_enabled}
                                onChange={e => setCampaignForm({ ...campaignForm, ab_enabled: e.target.checked })}
                                className="rounded border-border" />
                            <label htmlFor="ab-test" className="text-sm font-medium text-foreground">启用A/B测试</label>
                        </div>
                        {campaignForm.ab_enabled && <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">变体 A</label>
                                <Input
                                    value={campaignForm.variant_a}
                                    onChange={e => setCampaignForm({ ...campaignForm, variant_a: e.target.value })}
                                    placeholder="变体A内容" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground">变体 B</label>
                                <Input
                                    value={campaignForm.variant_b}
                                    onChange={e => setCampaignForm({ ...campaignForm, variant_b: e.target.value })}
                                    placeholder="变体B内容" />
                            </div>
                        </div>}
                    </div>
                </DialogContent>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                    <Button onClick={handleSaveCampaign} disabled={!campaignForm.name}>{editingCampaign ? '保存' : '创建'}</Button>
                </DialogFooter>
            </Dialog>
        </div>
    );
}