"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useLazyList } from '@/hooks/use-lazy-list';
import type { QuickReply } from '@/lib/types';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Download,
  Upload,
  ChevronDown,
  BookOpen,
  Sparkles,
  Users,
  X,
  Copy,
  Check,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Clock,
  Eye,
  Sparkle,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

const API_BASE = "/api/quick-replies";

const DEFAULT_CATEGORIES = ["售前咨询", "售后问题", "物流咨询", "优惠活动", "投诉建议", "其他"];

const SCOPE_LABELS: Record<string, string> = {
  global: "全局",
  agent: "坐席",
  ai: "AI",
};

const SCOPE_CONFIG: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  global: { bg: "bg-blue-50", border: "border-l-blue-400", text: "text-blue-600", icon: <Users className="w-3 h-3" /> },
  agent: { bg: "bg-emerald-50", border: "border-l-emerald-400", text: "text-emerald-600", icon: <MessageSquare className="w-3 h-3" /> },
  ai: { bg: "bg-violet-50", border: "border-l-violet-400", text: "text-violet-600", icon: <Sparkle className="w-3 h-3" /> },
};

const CATEGORY_ICONS: Record<string, string> = {
  "售前咨询": "💬",
  "售后问题": "🔧",
  "物流咨询": "📦",
  "优惠活动": "🎁",
  "投诉建议": "💭",
  "其他": "📝",
};

interface QuickRepliesPanelProps {
  /** 面板打开状态，由外部 Dialog 控制 */
  open?: boolean;
  /** 面板状态变更回调 */
  onOpenChange?: (open: boolean) => void;
  /** 选中话术回调 */
  onSelect?: (reply: QuickReply) => void;
  /** 是否显示导入导出操作 */
  showActions?: boolean;
  className?: string;
}

// ReplyList sub-component with IntersectionObserver for lazy loading
interface ReplyListProps {
  replies: QuickReply[];
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect?: (reply: QuickReply) => void;
  onCopy: (reply: QuickReply, e: React.MouseEvent) => void;
  onEdit: (reply: QuickReply) => void;
  onDelete: (id: string) => void;
  onCreateFirst: () => void;
  copiedId: string | null;
  deletingId: string | null;
  search: string;
  categoryFilter: string;
  scopeFilter: string;
}

function ReplyList({
  replies,
  isInitialLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onSelect,
  onCopy,
  onEdit,
  onDelete,
  onCreateFirst,
  copiedId,
  deletingId,
  search,
  categoryFilter,
  scopeFilter,
}: ReplyListProps) {
  const observerTarget = useRef<HTMLDivElement>(null);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!observerTarget.current || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { threshold: 0.1 }
    );
    observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);
  if (isInitialLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 py-16">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <Layers className="w-8 h-8 text-primary/60" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-background border-2 border-primary/20 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-primary/40 animate-pulse" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">正在加载话术库...</p>
        </div>
      </div>
    );
  }

  if (!isInitialLoading && replies.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 px-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-muted/50 to-muted/30 flex items-center justify-center">
            <BookOpen className="w-10 h-10 text-muted-foreground/40" />
          </div>
          <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Plus className="w-4 h-4 text-primary/60" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-medium text-foreground">暂无话术</p>
          {(search || categoryFilter !== 'all' || scopeFilter !== 'all') ? (
            <p className="text-sm text-muted-foreground">调整筛选条件试试</p>
          ) : (
            <p className="text-sm text-muted-foreground">创建第一条话术开启使用</p>
          )}
        </div>
        {(search || categoryFilter !== 'all' || scopeFilter !== 'all') ? null : (
          <Button variant="outline" onClick={onCreateFirst} className="gap-2 mt-2">
            <Plus className="w-4 h-4" />
            新建话术
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
        {replies.map((reply, index) => {
          const isCopied = copiedId === reply.id;
          const isDeleting = deletingId === reply.id;
          const scopeConfig = SCOPE_CONFIG[reply.scope] || SCOPE_CONFIG.global;
          const hasVariables = /\{[^}]+\}/.test(reply.content);
          
          return (
            <div
              key={reply.id}
              className={cn(
                'group relative rounded-xl bg-card transition-all duration-200',
                'hover:shadow-md hover:scale-[1.01]',
                'border-l-4 border-l-transparent',
                scopeConfig.border,
                isDeleting && 'opacity-50 pointer-events-none',
              )}
              onClick={() => onSelect?.(reply)}
            >
              {/* 复制成功提示 */}
              {isCopied && (
                <div className="absolute inset-0 bg-green-500/10 rounded-xl flex items-center justify-center z-10 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-full text-sm font-medium shadow-lg">
                    <Check className="w-4 h-4" />
                    已复制
                  </div>
                </div>
              )}
              
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* 标题行 */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground truncate">{reply.title}</h3>
                      <div className={cn('shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', scopeConfig.bg, scopeConfig.text)}>
                        {scopeConfig.icon}
                        <span>{SCOPE_LABELS[reply.scope] || reply.scope}</span>
                      </div>
                      {hasVariables && (
                        <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-xs">
                          <Sparkles className="w-3 h-3" />
                          含变量
                        </div>
                      )}
                    </div>
                    
                    {/* 内容预览 */}
                    <div className="text-sm text-muted-foreground leading-relaxed">
                      {highlightVariables(reply.content.slice(0, 120) + (reply.content.length > 120 ? '...' : ''))}
                    </div>
                    
                    {/* 底部元信息 */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50 flex-wrap">
                      {reply.category && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="text-base">{CATEGORY_ICONS[reply.category] || '📝'}</span>
                          <span>{reply.category}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                        <Clock className="w-3 h-3" />
                        <span>{formatDistanceToNow(new Date(reply.created_at), { addSuffix: true, locale: zhCN })}</span>
                      </div>
                      {reply.usage_count > 0 && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                          <Eye className="w-3 h-3" />
                          <span>使用 {reply.usage_count} 次</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮组 */}
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 w-8 p-0",
                        isCopied ? "text-green-500 bg-green-50 hover:bg-green-100" : "hover:bg-primary/10"
                      )}
                      onClick={(e) => { e.stopPropagation(); onCopy(reply, e); }}
                      title="复制内容"
                    >
                      {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 hover:bg-primary/10"
                      onClick={(e) => { e.stopPropagation(); onEdit(reply); }}
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); onDelete(reply.id); }}
                      title="删除"
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <div className="w-4 h-4 rounded-full border-2 border-destructive/30 border-t-destructive animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* IntersectionObserver target + load more indicator */}
      <div ref={observerTarget} className="h-4" />
      {isLoadingMore && (
        <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
          <div className="w-5 h-5 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <span>加载更多话术...</span>
        </div>
      )}
      {!hasMore && replies.length > 0 && (
        <div className="py-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 text-xs text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
            已展示全部 {replies.length} 条话术
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to highlight variables in content
function highlightVariables(content: string): React.ReactNode {
  const variablePattern = /\{([^}]+)\}/g;
  const parts = content.split(variablePattern);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return (
        <span key={i} className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-primary/10 text-primary font-medium text-xs">
          {part}
        </span>
      );
    }
    return part;
  });
}

export function QuickRepliesPanel({
  open = true,
  onOpenChange,
  onSelect,
  showActions = true,
  className,
}: QuickRepliesPanelProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [showPreview, setShowPreview] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    content: '',
    category: '其他',
    scope: 'global',
  });

  // Fetch function — ref ensures hook always sees the latest version
  const fetchFnRef = useRef<(page: number, pageSize: number) => Promise<{ items: QuickReply[]; total: number }>>(
    async (page, pageSize) => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (categoryFilter && categoryFilter !== 'all' && categoryFilter !== '全部') {
        params.set('category', categoryFilter);
      }
      if (scopeFilter && scopeFilter !== 'all' && scopeFilter !== '全部') {
        params.set('scope', scopeFilter);
      }
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      const res = await fetch(`${API_BASE}?${params}`);
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      return { items: (data.items || []) as QuickReply[], total: (data.total || 0) as number };
    }
  );

  // Keep ref current with latest filter values (no stale closure)
  fetchFnRef.current = (page, pageSize) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(pageSize));
    if (categoryFilter && categoryFilter !== 'all' && categoryFilter !== '全部') {
      params.set('category', categoryFilter);
    }
    if (scopeFilter && scopeFilter !== 'all' && scopeFilter !== '全部') {
      params.set('scope', scopeFilter);
    }
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    const res = fetch(`${API_BASE}?${params}`);
    return res.then(r => {
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }).then(data => ({
      items: (data.items || []) as QuickReply[],
      total: (data.total || 0) as number,
    }));
  };

  const PAGE_SIZE = 20;
  const {
    items: replies,
    total,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    loadMore,
    loadInitial,
    refresh,
    updateItems,
  } = useLazyList<QuickReply>({ fetchFn: fetchFnRef.current, pageSize: PAGE_SIZE });

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Trigger initial load on mount
  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when debounced search or filter changes
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, categoryFilter, scopeFilter]);

  // Get all categories from loaded replies
  const categories = useMemo(() => {
    const cats = new Set(replies.map((r) => r.category).filter((c): c is string => Boolean(c)));
    return Array.from(cats).sort();
  }, [replies]);

  // 打开新建
  const openCreate = () => {
    setEditingId(null);
    setForm({ title: "", content: "", category: "其他", scope: "global" });
    setDialogOpen(true);
  };

  // 打开编辑
  const openEdit = (reply: QuickReply) => {
    setEditingId(reply.id);
    setForm({
      title: reply.title,
      content: reply.content,
      category: reply.category || "其他",
      scope: reply.scope,
    });
    setDialogOpen(true);
  };

  // 保存
  const handleSave = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      toast.error("请填写标题和内容");
      return;
    }

    setSaving(true);
    try {
      const url = editingId ? `${API_BASE}?id=${editingId}` : API_BASE;
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
      });

      if (res.ok) {
        toast.success(editingId ? "话术已更新" : "话术已创建");
        setDialogOpen(false);
        await refresh();
      } else {
        toast.error("保存失败");
      }
    } catch (error) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("话术已删除");
        await refresh();
      } else {
        toast.error("删除失败");
      }
    } catch (error) {
      toast.error("删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  // 复制内容
  const handleCopy = async (reply: QuickReply, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(reply.content);
      setCopiedId(reply.id);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  // 选中话术
  const handleSelect = (reply: QuickReply) => {
    if (onSelect) {
      onSelect(reply);
    }
  };

  // 导出
  const handleExport = async (format: "xlsx" | "csv") => {
    try {
      const res = await fetch(`${API_BASE}/export?format=${format}&page=1&limit=10000`);
      if (!res.ok) throw new Error("导出失败");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `话术库_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出为 ${format.toUpperCase()}`);
    } catch (error) {
      toast.error("导出失败");
    }
  };

  // 导入
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const loadingToast = toast.loading("正在导入...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        // 构建成功消息，失败时展示前几条错误
        const successMsg = `导入完成：成功 ${data.success} 条`;
        if (data.failed > 0 && data.errors && data.errors.length > 0) {
          const errorList = data.errors.slice(0, 3).map((e: { row: number; message: string }) =>
            `第${e.row}行: ${e.message}`
          ).join("\n");
          const more = data.errors.length > 3 ? `\n还有 ${data.errors.length - 3} 条错误...` : "";
          toast.error(
            <div className="whitespace-pre-line">
              {successMsg}，失败 {data.failed} 条
              {errorList}
              {more}
            </div>,
            { id: loadingToast, duration: 8000 }
          );
        } else if (data.failed > 0) {
          toast.success(`${successMsg}，失败 ${data.failed} 条`, { id: loadingToast });
        } else {
          toast.success(successMsg, { id: loadingToast });
        }
        setImportDialogOpen(false);
        await refresh();
      } else {
        toast.error(data.error || "导入失败", { id: loadingToast });
      }
    } catch (error) {
      toast.error("导入失败");
    } finally {
      setImporting(false);
      // 重置 file input
      setTimeout(() => {
        document.getElementById("import-file")?.setAttribute("value", "");
      }, 100);
    }
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* 搜索和筛选栏 */}
      <div className="px-4 pb-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索话术标题或内容..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm bg-muted/50 border-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        
        {/* 快速筛选标签 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-7 text-xs w-auto min-w-[80px] gap-1.5">
              <span className="text-muted-foreground">分类:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              {DEFAULT_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  <span className="mr-1">{CATEGORY_ICONS[cat] || '📝'}</span>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="h-7 text-xs w-auto min-w-[80px] gap-1.5">
              <span className="text-muted-foreground">范围:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="global">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3 h-3 text-blue-600" />
                  全局
                </div>
              </SelectItem>
              <SelectItem value="agent">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3 h-3 text-emerald-600" />
                  坐席
                </div>
              </SelectItem>
              <SelectItem value="ai">
                <div className="flex items-center gap-1.5">
                  <Sparkle className="w-3 h-3 text-violet-600" />
                  AI
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* 清空筛选按钮 */}
          {(search || categoryFilter !== "all" || scopeFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => {
                setSearch('');
                setCategoryFilter('all');
                setScopeFilter('all');
              }}
            >
              <X className="w-3 h-3" />
              清空
            </Button>
          )}

          <div className="flex-1" />

          <Button size="sm" onClick={openCreate} className="h-8 gap-1.5 shrink-0">
            <Plus className="w-4 h-4" />
            新建话术
          </Button>
        </div>
      </div>

      {/* 统计和操作栏 */}
      {showActions && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-b bg-muted/20 mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                已加载 <span className="font-bold text-primary text-base">{replies.length}</span> 条
                {replies.length < total && (
                  <span className="text-muted-foreground/60"> / 共 <span className="font-medium text-foreground">{total}</span> 条</span>
                )}
              </span>
            </div>
            {(search || categoryFilter !== "all" || scopeFilter !== "all") && (
              <Badge variant="secondary" className="h-5 text-[10px] gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {isLoadingMore ? "筛选中" : "已筛选"}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  <Download className="w-3.5 h-3.5" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Excel 格式
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("csv")}>
                  <FileText className="w-4 h-4 mr-2" />
                  CSV 格式
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setImportDialogOpen(true)}
            >
              <Upload className="w-3.5 h-3.5" />
              导入
            </Button>
          </div>
        </div>
      )}

      {/* 话术列表 */}
      <ReplyList
        replies={replies}
        isInitialLoading={isInitialLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        onSelect={onSelect ? handleSelect : undefined}
        onCopy={handleCopy}
        onEdit={openEdit}
        onDelete={(id) => setConfirmDeleteId(id)}
        onCreateFirst={openCreate}
        copiedId={copiedId}
        deletingId={deletingId}
        search={search}
        categoryFilter={categoryFilter}
        scopeFilter={scopeFilter}
      />

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="pb-3 border-b">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center",
                editingId ? "bg-amber-100" : "bg-primary/10"
              )}>
                {editingId ? (
                  <Edit2 className="w-4 h-4 text-amber-600" />
                ) : (
                  <Plus className="w-4 h-4 text-primary" />
                )}
              </div>
              <div>
                <DialogTitle>{editingId ? "编辑话术" : "新建话术"}</DialogTitle>
                <DialogDescription className="text-xs">
                  {editingId ? "修改话术内容，保存后将立即生效" : "创建新的快捷回复话术"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4 py-4">
              {/* 左侧：表单 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <span className="text-destructive">*</span>
                    标题
                  </label>
                  <Input
                    placeholder="例如：产品介绍开场白"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <span className="text-destructive">*</span>
                    内容
                  </label>
                  <textarea
                    className="w-full min-h-[160px] px-3 py-2.5 rounded-lg border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none font-mono"
                    placeholder="输入回复内容，支持使用变量：{客服姓名}、{工号} 等"
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    💡 可使用 <code className="px-1 py-0.5 bg-muted rounded text-primary">{'{'}变量名{'}'}</code> 格式插入动态内容
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-foreground">分类</span>
                    <Select
                      value={form.category}
                      onValueChange={(v) => setForm({ ...form, category: v })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            <div className="flex items-center gap-2">
                              <span>{CATEGORY_ICONS[cat] || '📝'}</span>
                              <span>{cat}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <span className="text-sm font-medium text-foreground">适用范围</span>
                    <Select
                      value={form.scope}
                      onValueChange={(v) => setForm({ ...form, scope: v })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-blue-600" />
                            <div>
                              <span className="font-medium">全局</span>
                              <p className="text-[10px] text-muted-foreground">所有坐席和AI可见</p>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="agent">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-emerald-600" />
                            <div>
                              <span className="font-medium">坐席</span>
                              <p className="text-[10px] text-muted-foreground">仅坐席可见</p>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="ai">
                          <div className="flex items-center gap-2">
                            <Sparkle className="w-4 h-4 text-violet-600" />
                            <div>
                              <span className="font-medium">AI</span>
                              <p className="text-[10px] text-muted-foreground">仅AI自动回复使用</p>
                            </div>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* 右侧：预览 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">预览效果</span>
                  <div className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    SCOPE_CONFIG[form.scope]?.bg,
                    SCOPE_CONFIG[form.scope]?.text
                  )}>
                    {SCOPE_CONFIG[form.scope]?.icon}
                    <span className="ml-1">{SCOPE_LABELS[form.scope]}</span>
                  </div>
                </div>
                <div className="flex-1 rounded-xl bg-gradient-to-b from-muted/30 to-muted/10 p-4 space-y-3">
                  {form.title ? (
                    <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                      <h4 className="font-semibold text-sm">{form.title}</h4>
                    </div>
                  ) : (
                    <div className="h-8 flex items-center">
                      <p className="text-xs text-muted-foreground/50 italic">标题将显示在这里</p>
                    </div>
                  )}
                  
                  <div className={cn(
                    "rounded-lg p-3 text-sm leading-relaxed min-h-[100px]",
                    "bg-background border border-border/50 shadow-sm"
                  )}>
                    {form.content ? (
                      <div className="prose prose-sm max-w-none">
                        {highlightVariables(form.content)}
                      </div>
                    ) : (
                      <p className="text-muted-foreground/50 italic text-xs">内容将显示在这里</p>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-2 border-t border-border/30">
                    <div className="flex items-center gap-1">
                      <span>{CATEGORY_ICONS[form.category] || '📝'}</span>
                      <span>{form.category}</span>
                    </div>
                    <span>实时预览</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-3 border-t gap-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} className="gap-1.5 border border-border/50">
              <X className="w-4 h-4" />
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-background/30 border-t-background animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {editingId ? "保存修改" : "创建话术"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导入对话框 */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>批量导入话术</DialogTitle>
            <DialogDescription className="text-xs">
              从 Excel 或 CSV 文件批量导入话术
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 文件上传区 */}
            <div className="relative">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImport}
                disabled={importing}
                className="hidden"
                id="import-file"
              />
              <label
                htmlFor="import-file"
                className={cn(
                  "flex flex-col items-center justify-center p-8 rounded-lg border-2 border-dashed cursor-pointer transition-colors",
                  "hover:border-primary/50 hover:bg-primary/5",
                  importing && "opacity-50 cursor-not-allowed"
                )}
              >
                {importing ? (
                  <>
                    <div className="w-10 h-10 mb-3 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                    <p className="text-sm font-medium">正在导入...</p>
                    <p className="text-xs text-muted-foreground mt-1">请稍候</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium mb-1">点击选择文件</p>
                    <p className="text-xs text-muted-foreground">
                      支持 .xlsx、.xls、.csv 格式
                    </p>
                  </>
                )}
              </label>
            </div>

            {/* 导入说明 */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-foreground">导入格式要求：</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-start gap-1.5">
                  <span className="text-primary">•</span>
                  <span>
                    <strong>标题</strong> - 必填，话术名称
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-primary">•</span>
                  <span>
                    <strong>内容</strong> - 必填，话术正文
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-primary">•</span>
                  <span>
                    <strong>分类</strong> - 可选，默认为&ldquo;其他&rdquo;
                  </span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-primary">•</span>
                  <span>
                    <strong>适用范围</strong> - 可选：global/agent/ai，默认 global
                  </span>
                </li>
              </ul>
            </div>

            {/* 重复处理说明 */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 rounded-lg p-2">
              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>相同标题的话术会被自动跳过，不会重复创建</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条话术吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteId(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId) {
                  handleDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
