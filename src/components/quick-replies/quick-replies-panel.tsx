"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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

const SCOPE_COLORS: Record<string, string> = {
  global: "bg-blue-200 text-blue-800",
  agent: "bg-green-200 text-green-800",
  ai: "bg-purple-100 text-purple-700",
};

interface QuickReply {
  id: string;
  title: string;
  content: string;
  category?: string;
  scope: string;
  variables?: unknown[];
  usage_count: number;
  creator_id?: string;
  created_at: string;
  updated_at?: string;
}

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

export function QuickRepliesPanel({
  open = true,
  onOpenChange,
  onSelect,
  showActions = true,
  className,
}: QuickRepliesPanelProps) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    content: "",
    category: "其他",
    scope: "global",
  });

  // 加载话术列表 (API端筛选)
  const loadReplies = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter && categoryFilter !== "全部") params.set("category", categoryFilter);
      if (scopeFilter && scopeFilter !== "全部") params.set("scope", scopeFilter);
      if (search.trim()) params.set("search", search.trim());
      const url = `${API_BASE}${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setReplies(data.items || []);
      }
    } catch (error) {
      logger.error('加载话术失败', { error });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadReplies();
    }
  }, [open, categoryFilter, scopeFilter, search]);

  // API端筛选后直接使用
  const filteredReplies = replies;

  // 获取所有分类
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
        loadReplies();
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
        loadReplies();
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
      const res = await fetch(`${API_BASE}/export?format=${format}`);
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
        loadReplies();
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
      {/* 搜索筛选栏 */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索话术..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm bg-background"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[100px] h-8 text-xs">
            <SelectValue placeholder="分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-[80px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="global">全局</SelectItem>
            <SelectItem value="agent">坐席</SelectItem>
            <SelectItem value="ai">AI</SelectItem>
          </SelectContent>
        </Select>

        <Button size="sm" onClick={openCreate} className="h-8 gap-1 shrink-0">
          <Plus className="w-3.5 h-3.5" />
          新建
        </Button>
      </div>

      {/* 统计和操作栏 */}
      {showActions && (
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/20">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              共 <span className="font-medium text-foreground">{filteredReplies.length}</span> 条话术
            </span>
            {(search || categoryFilter !== "all" || scopeFilter !== "all") && (
              <span className="text-orange-600">
                筛选中
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                  <Download className="w-3 h-3" />
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("xlsx")}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-2" />
                  Excel 格式
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("csv")}>
                  <FileText className="w-3.5 h-3.5 mr-2" />
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
              <Upload className="w-3 h-3" />
              导入
            </Button>
          </div>
        </div>
      )}

      {/* 话术列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            <div className="animate-pulse">加载中...</div>
          </div>
        ) : filteredReplies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <BookOpen className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">
              {search || categoryFilter !== "all" || scopeFilter !== "all"
                ? "未找到匹配的话术"
                : "暂无话术"}
            </p>
            {!search && categoryFilter === "all" && scopeFilter === "all" && (
              <Button
                variant="link"
                size="sm"
                onClick={openCreate}
                className="mt-2 text-xs"
              >
                点击添加第一条话术
              </Button>
            )}
          </div>
        ) : (
          filteredReplies.map((reply) => (
            <div
              key={reply.id}
              className={cn(
                "group relative p-3 rounded-lg border bg-card transition-all duration-150",
                "hover:shadow-sm hover:border-primary/30",
                onSelect && "cursor-pointer hover:bg-primary/5"
              )}
              onClick={() => handleSelect(reply)}
            >
              {/* 标题行 */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-medium text-sm truncate">{reply.title}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0 font-normal",
                        SCOPE_COLORS[reply.scope]
                      )}
                    >
                      {SCOPE_LABELS[reply.scope]}
                    </Badge>
                    {reply.category && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                        {reply.category}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* 内容预览 */}
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {reply.content}
              </p>

              {/* 底部信息栏 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    使用 {reply.usage_count} 次
                  </span>
                  {reply.updated_at && (
                    <span>
                      {formatDistanceToNow(new Date(reply.updated_at), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </span>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onSelect && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(reply);
                      }}
                    >
                      使用
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => handleCopy(reply, e)}
                  >
                    {copiedId === reply.id ? (
                      <Check className="w-3 h-3 text-green-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(reply);
                    }}
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-destructive/60 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(reply.id);
                    }}
                    disabled={deletingId === reply.id}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑话术" : "新建话术"}</DialogTitle>
            <DialogDescription className="text-xs">
              {editingId ? "修改话术内容" : "创建新的快捷回复话术"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">标题</label>
              <Input
                placeholder="输入话术标题"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">内容</label>
              <textarea
                className="w-full min-h-[120px] px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                placeholder="输入话术内容，支持变量占位符 {customer_name}、{product_name} 等"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">分类</label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">适用范围</label>
                <Select
                  value={form.scope}
                  onValueChange={(v) => setForm({ ...form, scope: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">
                      <div className="flex items-center gap-2">
                        <Users className="w-3 h-3" />
                        全局
                      </div>
                    </SelectItem>
                    <SelectItem value="agent">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">坐席</Badge>
                        仅坐席可见
                      </div>
                    </SelectItem>
                    <SelectItem value="ai">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        AI 专用
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
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
