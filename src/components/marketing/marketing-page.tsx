"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

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
        color: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
    },

    browsing_nurture: {
        label: "浏览培育",
        icon: Eye,
        color: "bg-blue-200 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400"
    },

    win_back: {
        label: "流失召回",
        icon: UserCheck,
        color: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400"
    },
    promotion: {
        label: "促销活动",
        icon: Megaphone,
        color: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
    },
    announcement: {
        label: "公告通知",
        icon: Send,
        color: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400"
    },
    loyalty: {
        label: "会员关怀",
        icon: Crown,
        color: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
    }
};

const STATUS_CONFIG: Record<string, {
    label: string;
    color: string;
}> = {
    draft: {
        label: "草稿",
        color: "bg-blue-200 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400"
    },

    running: {
        label: "运行中",
        color: "bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400"
    },

    paused: {
        label: "已暂停",
        color: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
    },

    completed: {
        label: "已完成",
        color: "bg-muted text-muted-foreground"
    },

    active: {
        label: "进行中",
        color: "bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400"
    },

    scheduled: {
        label: "待投放",
        color: "bg-orange-100 text-orange-700"
    }
};

export default function MarketingPage() {
    const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);

    // Confirm dialog
    const { confirm } = useConfirmDialog();

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
    const [viewingCampaign, setViewingCampaign] = useState<MarketingCampaign | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const buildSegment = () => {
        const seg: Record<string, unknown> = {};
        if (segmentForm.platform && segmentForm.platform !== "all") seg.platform = segmentForm.platform;
        if (segmentForm.tag && segmentForm.tag !== "all") seg.tag = segmentForm.tag;
        if (segmentForm.member_level && segmentForm.member_level !== "all") seg.member_level = segmentForm.member_level;
        if (segmentForm.inactive_days && segmentForm.inactive_days !== "all") seg.inactive_days = Number(segmentForm.inactive_days);
        if (segmentForm.new_customer_days && segmentForm.new_customer_days !== "all") seg.new_customer_days = Number(segmentForm.new_customer_days);
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
            logger.error("Failed to fetch analytics", { error: err });
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

    const handleOpenDetail = (campaign: MarketingCampaign) => {
        setViewingCampaign(campaign);
        setDetailOpen(true);
    };

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
            logger.error("Failed to fetch campaigns", { error: err });
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
            logger.error("Failed to save campaign", { error: err });
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
            logger.error("Failed to toggle campaign status", { error: err });
        }
    };

    const [executingCampaignId, setExecutingCampaignId] = useState<string | null>(null);

    const handleExecuteCampaign = async (campaign: MarketingCampaign) => {
        const confirmed = await confirm({
            title: '执行营销活动',
            description: `确定要执行「${campaign.name}」吗？将向匹配的客户发送消息。`,
            confirmText: '执行',
            cancelText: '取消',
        });
        if (!confirmed) return;
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
            logger.error('Failed to execute campaign', { error: err });
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
                                            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => handleOpenDetail(campaign)}>
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
                                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30"><TrendingUp className="h-5 w-5 text-purple-600 dark:text-purple-400" /></div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">总转化数</p>
                                        <p className="text-xl font-semibold text-foreground">{(analyticsData?.overall?.total_converted ?? stats.total_converted).toLocaleString()}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="p-4 flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30"><Target className="h-5 w-5 text-amber-600 dark:text-amber-400" /></div>
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
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto !rounded-2xl">
                    <DialogHeader className="space-y-2 pb-4 border-b">
                        <DialogTitle className="flex items-center gap-2">
                            {editingCampaign ? (
                                <>
                                    <div className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30">
                                        <Eye className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                    </div>
                                    编辑营销活动
                                </>
                            ) : (
                                <>
                                    <div className="p-1.5 rounded-md bg-green-100 dark:bg-green-900/30">
                                        <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    </div>
                                    创建营销活动
                                </>
                            )}
                        </DialogTitle>
                        {editingCampaign && (
                            <p className="text-sm text-muted-foreground pl-8">
                                修改活动配置后保存即可更新活动信息
                            </p>
                        )}
                    </DialogHeader>
                    <div className="space-y-5 py-4">
                        {/* 基础信息 */}
                        <Card className="border-0 shadow-sm bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-800/30">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900/30">
                                        <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <h3 className="text-sm font-semibold text-foreground">活动配置</h3>
                                </div>
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                            <span>活动名称</span>
                                            <span className="text-red-500">*</span>
                                        </label>
                                        <Input
                                            value={campaignForm.name}
                                            onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })}
                                            placeholder="输入活动名称" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">活动类型</label>
                                        <Select value={campaignForm.type} onValueChange={v => setCampaignForm({ ...campaignForm, type: v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="abandoned_cart">
                                                    <div className="flex items-center gap-2">
                                                        <ShoppingCart className="h-4 w-4 text-orange-500" />
                                                        <span>购物车挽回</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="browsing_nurture">
                                                    <div className="flex items-center gap-2">
                                                        <Eye className="h-4 w-4 text-blue-600" />
                                                        <span>浏览培育</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="win_back">
                                                    <div className="flex items-center gap-2">
                                                        <UserCheck className="h-4 w-4 text-purple-500" />
                                                        <span>流失客户召回</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="promotion">
                                                    <div className="flex items-center gap-2">
                                                        <Megaphone className="h-4 w-4 text-red-500" />
                                                        <span>促销活动</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="announcement">
                                                    <div className="flex items-center gap-2">
                                                        <Send className="h-4 w-4 text-teal-500" />
                                                        <span>公告通知</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="loyalty">
                                                    <div className="flex items-center gap-2">
                                                        <Crown className="h-4 w-4 text-yellow-500" />
                                                        <span>会员关怀</span>
                                                    </div>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 消息模板 */}
                        <Card className="border-0 shadow-sm bg-gradient-to-r from-green-50 to-emerald-50/50 dark:from-green-900/20 dark:to-emerald-900/10">
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-md bg-green-100 dark:bg-green-900/30">
                                        <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    </div>
                                    <h3 className="text-sm font-semibold text-foreground">消息内容</h3>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                        <span>消息模板</span>
                                        <span className="text-xs opacity-60">（支持变量替换）</span>
                                    </label>
                                    <textarea
                                        className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                        value={campaignForm.message_template}
                                        onChange={e => setCampaignForm({ ...campaignForm, message_template: e.target.value })}
                                        placeholder="您好，&#123;&#123;customer_name&#125;&#125;，&#123;&#123;campaign_name&#125;&#125;火热进行中，欢迎咨询！" />
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs">
                                    <span className="text-muted-foreground">可用变量：</span>
                                    <code className="px-2 py-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-mono">&#123;&#123;customer_name&#125;&#125;</code>
                                    <code className="px-2 py-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-mono">&#123;&#123;campaign_name&#125;&#125;</code>
                                </div>
                            </CardContent>
                        </Card>

                        {/* 投放设置 */}
                        <Card className="border-0 shadow-sm bg-gradient-to-r from-orange-50 to-amber-50/50 dark:from-orange-900/20 dark:to-amber-900/10">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-md bg-orange-100 dark:bg-orange-900/30">
                                        <CalendarDays className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                                    </div>
                                    <h3 className="text-sm font-semibold text-foreground">投放设置</h3>
                                </div>
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-muted-foreground">投放方式</label>
                                        <Select value={campaignForm.trigger_type} onValueChange={v => setCampaignForm({ ...campaignForm, trigger_type: v as 'manual' | 'scheduled' | 'event' })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="manual">
                                                    <div className="flex items-center gap-2">
                                                        <Play className="h-4 w-4 text-emerald-600" />
                                                        <span>立即投放（手动启动）</span>
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="scheduled">
                                                    <div className="flex items-center gap-2">
                                                        <CalendarDays className="h-4 w-4 text-orange-500" />
                                                        <span>定时投放（指定时间自动发送）</span>
                                                    </div>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {campaignForm.trigger_type === "scheduled" && (
                                        <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
                                            <label className="text-xs font-medium text-muted-foreground">投放时间</label>
                                            <input
                                                type="datetime-local"
                                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                value={campaignForm.scheduled_at}
                                                onChange={e => setCampaignForm({ ...campaignForm, scheduled_at: e.target.value })}
                                                min={new Date().toISOString().slice(0, 16)} />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* 客群定向 */}
                        <Card className="border-0 shadow-sm bg-gradient-to-r from-amber-50 to-orange-50/50 dark:from-amber-900/20 dark:to-orange-900/10">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30">
                                            <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-foreground">目标客群</h3>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={handlePreviewSegment} disabled={previewing}>
                                        {previewing ? (
                                            <span className="flex items-center gap-1">
                                                <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                                预览中...
                                            </span>
                                        ) : (
                                            <>预览匹配人数</>
                                        )}
                                    </Button>
                                </div>

                                {segmentPreview !== null && (
                                    <div className="bg-white/80 dark:bg-slate-800/50 rounded-lg p-3 border border-amber-200/50 dark:border-amber-800/30">
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-amber-600" />
                                            <span className="text-sm">
                                                匹配 <strong className="text-amber-600 text-base">{segmentPreview.total}</strong> 位客户
                                            </span>
                                            {segmentPreview.samples.length > 0 && (
                                                <span className="text-xs text-muted-foreground ml-2">
                                                    （{segmentPreview.samples.map(s => s.name).join('、')}）
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">来源平台</label>
                                        <Select value={segmentForm.platform} onValueChange={v => setSegmentForm({ ...segmentForm, platform: v })}>
                                            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">全部平台</SelectItem>
                                                <SelectItem value="web">🌐 网页</SelectItem>
                                                <SelectItem value="qianniu">🐮 千牛</SelectItem>
                                                <SelectItem value="doudian">🎵 抖店</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">客户标签</label>
                                        <Select value={segmentForm.tag} onValueChange={v => setSegmentForm({ ...segmentForm, tag: v })}>
                                            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">全部标签</SelectItem>
                                                {customerTags.map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">会员等级</label>
                                        <Select value={segmentForm.member_level} onValueChange={v => setSegmentForm({ ...segmentForm, member_level: v })}>
                                            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">全部等级</SelectItem>
                                                <SelectItem value="普通">🌱 普通</SelectItem>
                                                <SelectItem value="银卡">🥈 银卡</SelectItem>
                                                <SelectItem value="金卡">🥇 金卡</SelectItem>
                                                <SelectItem value="钻石">💎 钻石</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">活跃状态</label>
                                        <Select value={segmentForm.inactive_days} onValueChange={v => setSegmentForm({ ...segmentForm, inactive_days: v, new_customer_days: "" })}>
                                            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">全部状态</SelectItem>
                                                <SelectItem value="7">🟢 活跃（7天内）</SelectItem>
                                                <SelectItem value="30">🟡 一般（7-30天）</SelectItem>
                                                <SelectItem value="60">🔴 沉默（30天以上）</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-muted-foreground">客户类型</label>
                                        <Select value={segmentForm.new_customer_days} onValueChange={v => setSegmentForm({ ...segmentForm, new_customer_days: v, inactive_days: "" })}>
                                            <SelectTrigger><SelectValue placeholder="全部" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">全部类型</SelectItem>
                                                <SelectItem value="7">✨ 新客户（7天内）</SelectItem>
                                                <SelectItem value="30">⭐ 新客户（30天内）</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1 flex items-end">
                                        <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-background cursor-pointer hover:bg-muted/50 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={segmentForm.exclude_anonymous}
                                                onChange={e => setSegmentForm({ ...segmentForm, exclude_anonymous: e.target.checked })}
                                                className="rounded border-border" />
                                            <span className="text-sm">排除匿名访客</span>
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
                            </CardContent>
                        </Card>

                        {/* A/B 测试 */}
                        <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-50 to-purple-50/50 dark:from-violet-900/20 dark:to-purple-900/10">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-violet-100 dark:bg-violet-900/30">
                                            <Target className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-foreground">A/B 测试</h3>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <span className="text-sm text-muted-foreground">启用</span>
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                id="ab-test"
                                                checked={campaignForm.ab_enabled}
                                                onChange={e => setCampaignForm({ ...campaignForm, ab_enabled: e.target.checked })}
                                                className="sr-only peer" />
                                            <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-violet-500 transition-colors" />
                                            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform" />
                                        </div>
                                    </label>
                                </div>

                                {campaignForm.ab_enabled && (
                                    <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-2 duration-200">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                                <Badge variant="outline" className="bg-blue-200 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-300 dark:border-blue-700 h-5 px-1.5">A</Badge>
                                                对照组
                                            </label>
                                            <textarea
                                                className="w-full min-h-[80px] rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                                value={campaignForm.variant_a}
                                                onChange={e => setCampaignForm({ ...campaignForm, variant_a: e.target.value })}
                                                placeholder="输入变体A内容..." />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                                <Badge variant="outline" className="bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-300 dark:border-green-700 h-5 px-1.5">B</Badge>
                                                实验组
                                            </label>
                                            <textarea
                                                className="w-full min-h-[80px] rounded-md border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20 px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                                                value={campaignForm.variant_b}
                                                onChange={e => setCampaignForm({ ...campaignForm, variant_b: e.target.value })}
                                                placeholder="输入变体B内容..." />
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </DialogContent>
                <DialogFooter className="border-t pt-4 gap-2">
                    <Button variant="outline" onClick={() => setCreateOpen(false)}>
                        取消
                    </Button>
                    <Button onClick={handleSaveCampaign} disabled={!campaignForm.name}>
                        {editingCampaign ? (
                            <>
                                <Eye className="h-4 w-4 mr-1.5" />
                                保存修改
                            </>
                        ) : (
                            <>
                                <Plus className="h-4 w-4 mr-1.5" />
                                创建活动
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </Dialog>

            {/* 活动详情 Dialog */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto !rounded-2xl">
                    <DialogHeader className="space-y-3 pb-4 border-b">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                                <BarChart3 className="h-5 w-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-lg">{viewingCampaign?.name}</DialogTitle>
                                <div className="flex items-center gap-2 mt-1">
                                    {viewingCampaign && (
                                        <>
                                            <Badge className={TYPE_CONFIG[viewingCampaign.type]?.color}>
                                                {TYPE_CONFIG[viewingCampaign.type]?.label || viewingCampaign.type}
                                            </Badge>
                                            <Badge className={STATUS_CONFIG[viewingCampaign.status]?.color}>
                                                {STATUS_CONFIG[viewingCampaign.status]?.label || viewingCampaign.status}
                                            </Badge>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </DialogHeader>
                    {viewingCampaign && (
                        <div className="space-y-5 py-4">
                            {/* 基本信息 */}
                            <Card className="border-0 shadow-sm bg-gradient-to-r from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-800/30">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900/30">
                                            <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <p className="text-xs text-muted-foreground">触发方式</p>
                                            <p className="text-sm font-medium flex items-center gap-1.5">
                                                {viewingCampaign.trigger_type === 'manual' ? (
                                                    <><Play className="h-3.5 w-3.5 text-emerald-600" />手动投放</>
                                                ) : viewingCampaign.trigger_type === 'scheduled' ? (
                                                    <><CalendarDays className="h-3.5 w-3.5 text-orange-500" />定时投放</>
                                                ) : (
                                                    <><TrendingUp className="h-3.5 w-3.5 text-purple-500" />事件触发</>
                                                )}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs text-muted-foreground">创建时间</p>
                                            <p className="text-sm font-medium">{new Date(viewingCampaign.created_at).toLocaleString('zh-CN')}</p>
                                        </div>
                                        {viewingCampaign.scheduled_at && (
                                            <div className="space-y-1">
                                                <p className="text-xs text-muted-foreground">计划投放时间</p>
                                                <p className="text-sm font-medium">{new Date(viewingCampaign.scheduled_at).toLocaleString('zh-CN')}</p>
                                            </div>
                                        )}
                                        {viewingCampaign.bot_id && (
                                            <div className="space-y-1">
                                                <p className="text-xs text-muted-foreground">关联 Bot</p>
                                                <p className="text-sm font-medium">已关联</p>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 消息模板 */}
                            {viewingCampaign.message_template && (
                                <Card className="border-0 shadow-sm bg-gradient-to-r from-green-50 to-emerald-50/50 dark:from-green-900/20 dark:to-emerald-900/10">
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="p-1.5 rounded-md bg-green-100 dark:bg-green-900/30">
                                                <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
                                            </div>
                                            <h3 className="text-sm font-semibold text-foreground">消息模板</h3>
                                        </div>
                                        <div className="bg-white/80 dark:bg-slate-800/50 rounded-lg p-4 border border-green-200/50 dark:border-green-800/30">
                                            <p className="text-sm whitespace-pre-wrap leading-relaxed">{viewingCampaign.message_template}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                                            <span>支持变量：</span>
                                            <code className="px-1.5 py-0.5 rounded bg-muted text-xs">&#123;&#123;customer_name&#125;&#125;</code>
                                            <code className="px-1.5 py-0.5 rounded bg-muted text-xs">&#123;&#123;campaign_name&#125;&#125;</code>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* 目标客群 */}
                            <Card className="border-0 shadow-sm bg-gradient-to-r from-amber-50 to-orange-50/50 dark:from-amber-900/20 dark:to-orange-900/10">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30">
                                            <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-foreground">目标客群</h3>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(viewingCampaign.target_segment || {}).map(([key, value]) => {
                                            const label = key.replace(/_/g, ' ');
                                            return (
                                                <div key={key} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 dark:bg-slate-800/50 border border-amber-200/50 dark:border-amber-800/30">
                                                    <span className="text-xs text-muted-foreground capitalize">{label}：</span>
                                                    <span className="text-sm font-medium">
                                                        {key === 'exclude_anonymous' ? (value ? '是' : '否') :
                                                         Array.isArray(value) ? value.join('、') : String(value)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* A/B 测试 */}
                            {viewingCampaign.ab_variants?.enabled && (
                                <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-50 to-purple-50/50 dark:from-violet-900/20 dark:to-purple-900/10">
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="p-1.5 rounded-md bg-violet-100 dark:bg-violet-900/30">
                                                <Target className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                            </div>
                                            <h3 className="text-sm font-semibold text-foreground">A/B 测试</h3>
                                            {abWinners[viewingCampaign.id]?.winner && (
                                                <Badge variant="outline" className="ml-auto bg-amber-50 text-amber-700 border-amber-200">
                                                    <Crown className="h-3 w-3 mr-1" />
                                                    变体 {abWinners[viewingCampaign.id].winner} 领先
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-blue-50/80 dark:bg-blue-900/30 rounded-lg p-3 border border-blue-200/50 dark:border-blue-800/30">
                                                <div className="flex items-center gap-1.5 mb-2">
                                                    <Badge variant="outline" className="bg-blue-200 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-300 dark:border-blue-700">A</Badge>
                                                    <span className="text-xs text-muted-foreground">对照组</span>
                                                </div>
                                                <p className="text-sm whitespace-pre-wrap">{viewingCampaign.ab_variants.variant_a}</p>
                                            </div>
                                            <div className="bg-green-50/80 dark:bg-green-900/30 rounded-lg p-3 border border-green-200/50 dark:border-green-800/30">
                                                <div className="flex items-center gap-1.5 mb-2">
                                                    <Badge variant="outline" className="bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-300 dark:border-green-700">B</Badge>
                                                    <span className="text-xs text-muted-foreground">实验组</span>
                                                </div>
                                                <p className="text-sm whitespace-pre-wrap">{viewingCampaign.ab_variants.variant_b}</p>
                                            </div>
                                        </div>
                                        {abWinners[viewingCampaign.id]?.reason && (
                                            <p className="text-xs text-muted-foreground mt-2 text-center">
                                                判定原因：{abWinners[viewingCampaign.id].reason}
                                            </p>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* 活动效果 */}
                            <Card className="border-0 shadow-sm bg-gradient-to-r from-indigo-50 to-blue-50/50 dark:from-indigo-900/20 dark:to-blue-900/10">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-2 mb-4">
                                        <div className="p-1.5 rounded-md bg-indigo-100 dark:bg-indigo-900/30">
                                            <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-foreground">活动效果</h3>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="relative">
                                            <div className="text-center">
                                                <div className="text-3xl font-bold bg-gradient-to-b from-blue-600 to-blue-700 bg-clip-text text-transparent">
                                                    {viewingCampaign.stats?.sent ?? 0}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1">触达数</div>
                                            </div>
                                            <div className="absolute inset-x-0 -bottom-3 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent rounded-full opacity-50" />
                                        </div>
                                        <div className="relative">
                                            <div className="text-center">
                                                <div className="text-3xl font-bold bg-gradient-to-b from-green-600 to-green-700 bg-clip-text text-transparent">
                                                    {viewingCampaign.stats?.replied ?? 0}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1">回复数</div>
                                            </div>
                                            <div className="absolute inset-x-0 -bottom-3 h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent rounded-full opacity-50" />
                                        </div>
                                        <div className="relative">
                                            <div className="text-center">
                                                <div className="text-3xl font-bold bg-gradient-to-b from-purple-600 to-purple-700 bg-clip-text text-transparent">
                                                    {viewingCampaign.stats?.converted ?? 0}
                                                </div>
                                                <div className="text-xs text-muted-foreground mt-1">转化数</div>
                                            </div>
                                            <div className="absolute inset-x-0 -bottom-3 h-1 bg-gradient-to-r from-transparent via-purple-400 to-transparent rounded-full opacity-50" />
                                        </div>
                                    </div>
                                    {viewingCampaign.stats && viewingCampaign.stats.sent > 0 && (
                                        <div className="mt-4 pt-4 border-t border-indigo-200/50 dark:border-indigo-800/30">
                                            <div className="flex justify-center gap-8">
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-blue-600">
                                                        {((viewingCampaign.stats.replied / viewingCampaign.stats.sent) * 100).toFixed(1)}%
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">回复率</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-green-600">
                                                        {((viewingCampaign.stats.converted / viewingCampaign.stats.sent) * 100).toFixed(1)}%
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">转化率</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )}
                    <DialogFooter className="border-t pt-4 gap-2">
                        <Button variant="outline" onClick={() => setDetailOpen(false)}>
                            关闭
                        </Button>
                        <Button variant="default" onClick={() => {
                            setDetailOpen(false);
                            if (viewingCampaign) openEdit(viewingCampaign);
                        }}>
                            <Eye className="h-4 w-4 mr-1.5" />
                            编辑活动
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}