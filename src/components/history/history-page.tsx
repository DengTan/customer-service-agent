'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Search, Calendar, Star, MessageSquare, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Trash2, Eye, X, Download, CheckSquare, Square, RotateCcw, Loader2, ChevronsLeft, ChevronsRight,
} from 'lucide-react';

import { Conversation, Message } from '@/lib/types';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

export function HistoryPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'rated' | 'unrated'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailConv, setDetailConv] = useState<Conversation | null>(null);
  const [detailMessages, setDetailMessages] = useState<Message[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailTotalMessages, setDetailTotalMessages] = useState(0);
  const detailPageSize = 10;
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const [jumpPage, setJumpPage] = useState('');

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Search debounce
  const [searchInput, setSearchInput] = useState('');

  // Batch operations
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Debounced search value - use ref to avoid stale closure
  const debouncedSearch = useRef('');
  const searchInputRef = useRef(searchInput);
  useEffect(() => {
    const timer = setTimeout(() => {
      debouncedSearch.current = searchInput;
      searchInputRef.current = searchInput;
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Detail modal ref for focus management
  const detailModalRef = useRef<HTMLDivElement>(null);

  // Detail modal: focus + ESC key support
  useEffect(() => {
    if (detailConv === null) return;
    detailModalRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailConv(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [detailConv]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // Use searchInputRef to avoid stale closure
      if (searchInputRef.current) params.set('search', searchInputRef.current);
      // Use server-side has_rating filter
      if (statusFilter === 'rated') {
        params.set('has_rating', 'true');
      } else if (statusFilter === 'unrated') {
        params.set('has_rating', 'false');
      }
      if (sourceFilter !== 'all') {
        params.set('source', sourceFilter);
      }
      if (dateRange.start) {
        params.set('start_date', dateRange.start);
      }
      if (dateRange.end) {
        params.set('end_date', dateRange.end);
      }
      params.set('page', String(currentPage));
      params.set('limit', String(pageSize));
      const res = await fetch(`/api/conversations?${params.toString()}`);
      const data = await res.json();
      const convs: Conversation[] = data.conversations || [];
      if (data.total !== undefined) {
        setTotalCount(data.total || convs.length);
      }
      setConversations(convs);
    } catch (err) {
      logger.error('加载历史记录失败', { error: err });
      toast.error('加载历史记录失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter, dateRange, currentPage]);

  // 加载数据：初始 + 页码变化时触发
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 筛选条件变化时重置页码（currentPage 从非1变为1时不会触发 loadConversations 重建，需手动加载）
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentPage === 1) {
        loadConversations();
      } else {
        setCurrentPage(1);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, statusFilter, sourceFilter, dateRange.start, dateRange.end]);

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: '删除对话记录',
      description: '确定要删除这条对话记录吗？此操作不可撤销。',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除请求失败');
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setCurrentPage(1);
    } catch (err) {
      logger.error('删除失败', { error: err });
      toast.error('删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: '批量删除对话记录',
      description: `确定要删除选中的 ${selectedIds.size} 条对话记录吗？此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    toast.loading('正在删除...', { id: 'batch-delete' });
    try {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/conversations/${id}`, { method: 'DELETE' }).then(async (res) => {
            if (!res.ok) throw new Error(`删除失败: ${id}`);
            return id;
          })
        )
      );

      // Separate successful and failed deletions
      const successfulIds: string[] = [];
      const failedIds: string[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          successfulIds.push(result.value);
        } else {
          failedIds.push(result.reason?.message || '未知错误');
        }
      });

      // Update UI only with successful deletions
      if (successfulIds.length > 0) {
        setConversations((prev) => prev.filter((c) => !successfulIds.includes(c.id)));
        setTotalCount((prev) => Math.max(0, prev - successfulIds.length));
      }

      setSelectedIds(new Set());
      setBatchMode(false);

      // Show appropriate message
      if (failedIds.length === 0) {
        toast.success(`成功删除 ${successfulIds.length} 条对话记录`, { id: 'batch-delete' });
      } else if (successfulIds.length > 0) {
        toast.warning(`删除完成：成功 ${successfulIds.length} 条，失败 ${failedIds.length} 条`, { id: 'batch-delete' });
      } else {
        toast.error(`删除失败：${failedIds.length} 条`, { id: 'batch-delete' });
      }
    } catch (err) {
      logger.error('批量删除失败', { error: err });
      toast.error('批量删除失败，请重试', { id: 'batch-delete' });
    }
  };

  // CSV 导出工具函数
  const escapeCSV = (value: string | number | null | undefined): string => {
    if (value == null) return '';
    const str = String(value);
    // 转义双引号，包裹在引号中
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const handleBatchExport = async () => {
    try {
      const selectedConversations = conversations.filter((c) => selectedIds.has(c.id));
      if (selectedConversations.length === 0) {
        toast.error('请选择要导出的对话');
        return;
      }

      toast.loading(`正在准备导出 (0/${selectedConversations.length})...`, { id: 'export' });

      // CSV 表头
      const headers = ['对话ID', '对话标题', '状态', '评分', '来源', '创建时间', '角色', '消息时间', '消息内容'];
      const rows: string[][] = [headers];
      let exportSuccess = true;
      const maxMessagesPerConversation = 100; // Limit messages per conversation

      // 逐个获取对话详情
      for (let i = 0; i < selectedConversations.length; i++) {
        const conv = selectedConversations[i];
        try {
          // Update progress
          toast.loading(`正在获取对话 ${i + 1}/${selectedConversations.length}...`, { id: 'export' });

          const data = await fetchConversationWithMessages(conv.id);
          const messages = (data.messages || []).slice(0, maxMessagesPerConversation);

          if (messages.length === 0) {
            // 无消息的对话也保留一行
            rows.push([
              escapeCSV(conv.id),
              escapeCSV(conv.title || ''),
              escapeCSV(conv.status === 'active' ? '进行中' : '已结束'),
              escapeCSV(conv.rating || ''),
              escapeCSV(conv.source || 'web'),
              escapeCSV(conv.created_at),
              '', '', ''
            ]);
          } else {
            // 每条消息一行
            for (const msg of messages) {
              rows.push([
                escapeCSV(conv.id),
                escapeCSV(conv.title || ''),
                escapeCSV(conv.status === 'active' ? '进行中' : '已结束'),
                escapeCSV(conv.rating || ''),
                escapeCSV(conv.source || 'web'),
                escapeCSV(conv.created_at),
                escapeCSV(msg.role === 'user' ? '客户' : msg.role === 'assistant' ? 'AI客服' : '系统'),
                escapeCSV(msg.created_at),
                escapeCSV(msg.content),
              ]);
            }
          }
        } catch (convErr) {
          logger.error(`获取对话 ${conv.id} 失败`, { error: convErr });
          exportSuccess = false;
          // Still add a row for this conversation with error info
          rows.push([
            escapeCSV(conv.id),
            escapeCSV(conv.title || ''),
            escapeCSV(conv.status === 'active' ? '进行中' : '已结束'),
            escapeCSV(conv.rating || ''),
            escapeCSV(conv.source || 'web'),
            escapeCSV(conv.created_at),
            '导出失败', '', ''
          ]);
        }
      }

      // 生成 CSV 字符串
      const csvContent = rows.map((row) => row.join(',')).join('\n');
      const BOM = '\uFEFF'; // UTF-8 BOM
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `对话记录_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      setSelectedIds(new Set());
      setBatchMode(false);
      if (exportSuccess) {
        toast.success(`已导出 ${selectedConversations.length} 条对话`, { id: 'export' });
      } else {
        toast.warning(`导出完成，但部分对话获取失败`, { id: 'export' });
      }
    } catch (err) {
      logger.error('批量导出失败', { error: err });
      toast.error('批量导出失败，请重试', { id: 'export' });
    }
  };

  const handleViewDetail = async (conv: Conversation) => {
    setDetailConv(conv);
    setDetailMessages([]);
    setDetailPage(0);
    setDetailLoading(true);
    try {
      // Load newest messages first with DESC order
      const params = new URLSearchParams({ page: '1', limit: String(detailPageSize), order: 'desc' });
      const res = await fetch(`/api/conversations/${conv.id}?${params}`);
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setDetailMessages(data.messages || []);
      setDetailTotalMessages(data.total_messages || data.messages?.length || 0);
    } catch (err) {
      logger.error('加载详情失败', { error: err });
      toast.error('加载对话详情失败');
      setDetailConv(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!detailConv || detailLoading) return;
    // detailPage tracks how many pages have been loaded
    const nextPage = detailPage + 1;
    setDetailLoading(true);
    try {
      // Calculate offset for older messages (skip already loaded messages)
      const offset = nextPage * detailPageSize;
      const params = new URLSearchParams({
        page: '1',
        limit: String(detailPageSize),
        offset: String(offset),
        order: 'desc'
      });
      const res = await fetch(`/api/conversations/${detailConv.id}?${params}`);
      if (!res.ok) throw new Error('加载更多消息失败');
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        // Prepend older messages at the top (maintaining DESC order: newest first)
        setDetailMessages((prev) => [...data.messages, ...prev]);
        setDetailPage(nextPage);
      } else {
        // No more messages to load
        setDetailTotalMessages(detailMessages.length);
      }
    } catch (err) {
      logger.error('加载更多消息失败', { error: err });
      toast.error('加载更多消息失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // 公共：获取对话详情（含全部消息，最多1000条）
  const fetchConversationWithMessages = async (id: string) => {
    const res = await fetch(`/api/conversations/${id}?page=1&limit=1000`);
    if (!res.ok) throw new Error('获取对话详情失败');
    return res.json();
  };

  // 导出单个对话（含聊天记录）
  const handleExportConversation = async (conv: Conversation) => {
    try {
      const data = await fetchConversationWithMessages(conv.id);
      const messages = data.messages || [];

      // 构建导出内容
      const exportData = {
        对话信息: {
          ID: conv.id,
          标题: conv.title,
          状态: conv.status === 'active' ? '进行中' : '已结束',
          评分: conv.rating || '未评价',
          来源: conv.source || 'web',
          创建时间: conv.created_at,
        },
        聊天记录: messages.map((msg: Message) => ({
          角色: msg.role === 'user' ? '客户' : msg.role === 'assistant' ? 'AI客服' : '系统',
          时间: msg.created_at,
          内容: msg.content,
        })),
      };

      // 生成并下载 JSON 文件
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `对话导出_${sanitizeFilename(conv.title)}_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch (err) {
      logger.error('导出失败', { error: err });
      toast.error('导出失败，请重试');
    }
  };

  const handleExportDetail = () => {
    if (!detailConv || detailMessages.length === 0) return;
    const lines = detailMessages.map((m) => {
      const time = new Date(m.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '系统';
      return `[${time}] ${role}: ${m.content}`;
    });
    const content = `对话: ${detailConv.title}\n时间: ${new Date(detailConv.created_at).toLocaleString('zh-CN')}\n${'─'.repeat(40)}\n\n${lines.join('\n\n')}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${detailConv.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllSelected = conversations.length > 0 && conversations.every((c) => selectedIds.has(c.id));
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(conversations.map((c) => c.id)));
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    setStatusFilter('all');
    setSourceFilter('all');
    setDateRange({ start: '', end: '' });
    setShowDateFilter(false);
  };

  // Sanitize filename by removing/replacing invalid characters
  const sanitizeFilename = (name: string) => {
    return name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 50);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const SOURCE_LABELS: Record<string, string> = { web: '网页', qianniu: '千牛', doudian: '抖店' };

  return (
    <div className="h-full flex flex-col page-transition">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">对话历史</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBatchMode(!batchMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              batchMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {batchMode ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            {batchMode ? '退出批量' : '批量操作'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 border-b border-border/50 bg-card/50 shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 max-w-sm min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索对话..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            {(['all', 'rated', 'unrated'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'all' ? '全部' : s === 'rated' ? '已评价' : '未评价'}
              </button>
            ))}
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">所有来源</option>
            <option value="web">网页</option>
            <option value="qianniu">千牛</option>
            <option value="doudian">抖店</option>
          </select>
          <button
            onClick={() => setShowDateFilter(!showDateFilter)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              showDateFilter || dateRange.start || dateRange.end
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            日期筛选
          </button>
          {(searchInput || statusFilter !== 'all' || sourceFilter !== 'all' || dateRange.start || dateRange.end) && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3 h-3" />
              清除筛选
            </button>
          )}
        </div>

        {/* Date range picker */}
        {showDateFilter && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30 panel-expand transition-all duration-200">
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => {
                const newStart = e.target.value;
                if (dateRange.end && newStart > dateRange.end) {
                  toast.error('开始日期不能晚于结束日期');
                  return;
                }
                setDateRange((prev) => ({ ...prev, start: newStart }));
              }}
              className="px-3 py-1.5 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-xs text-muted-foreground">至</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => {
                const newEnd = e.target.value;
                if (dateRange.start && newEnd < dateRange.start) {
                  toast.error('结束日期不能早于开始日期');
                  return;
                }
                setDateRange((prev) => ({ ...prev, end: newEnd }));
              }}
              className="px-3 py-1.5 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}

        {/* Batch operation bar */}
        {batchMode && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30 animate-fadeIn">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {isAllSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {isAllSelected ? '取消全选' : '全选'}
            </button>
            <span className="text-xs text-muted-foreground">
              已选 {selectedIds.size} 项
            </span>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleBatchExport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-primary hover:bg-primary/10 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出 ({selectedIds.size})
                </button>
                <button
                  onClick={handleBatchDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  批量删除 ({selectedIds.size})
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 pb-24">
        {loading ? (
          <div className="space-y-3 max-w-4xl">
            {[...Array(5)].map((_, idx) => (
              <div
                key={idx}
                className="border border-border rounded-xl bg-card overflow-hidden animate-pulse"
              >
                <div className="flex items-center px-5 py-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                      <div className="h-4 w-16 bg-muted rounded-full animate-pulse" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-16 animate-fadeIn">
            <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm mb-2">暂无对话记录</p>
            <p className="text-muted-foreground/60 text-xs">开始一个新对话或连接平台坐席即可查看对话历史</p>
          </div>
        ) : (
          <div className={`space-y-2 max-w-4xl transition-all duration-300 ease-out ${loading ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}>
            {conversations.map((conv, idx) => (
              <div 
                key={conv.id} 
                className="border border-border rounded-xl bg-card overflow-hidden card-hover-lift animate-fadeInUp"
                style={{ animationDelay: `${Math.min(idx * 30, 500)}ms` }}
              >
                <div className="flex items-center">
                  {batchMode && (
                    <button
                      onClick={() => toggleSelect(conv.id)}
                      className="pl-4 pr-2 py-4 text-muted-foreground hover:text-primary transition-colors"
                    >
                      {selectedIds.has(conv.id) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => !batchMode && setExpandedId(expandedId === conv.id ? null : conv.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !batchMode && setExpandedId(expandedId === conv.id ? null : conv.id); } }}
                    className="flex-1 flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground truncate">
                          {conv.title}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                            conv.status === 'active'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {conv.status === 'active' ? '进行中' : '已结束'}
                        </span>
                        {conv.source && conv.source !== 'web' && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                            {SOURCE_LABELS[conv.source] || conv.source}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(conv.created_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {conv.message_count} 条消息
                        </span>
                        {conv.rating ? (
                          <span className="flex items-center gap-0.5 text-amber-500">
                            <Star className="w-3 h-3 fill-amber-400" />
                            {conv.rating}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">未评价</span>
                        )}
                      </div>
                    </div>
                    {!batchMode && (
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleViewDetail(conv); }}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          aria-label="查看详情"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }}
                          disabled={deletingId === conv.id}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                          aria-label="删除"
                        >
                          {deletingId === conv.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExportConversation(conv); }}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-green-600 hover:bg-green-50 transition-colors"
                          aria-label="导出对话"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        {expandedId === conv.id ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Expandable Content */}
                <div 
                  className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                  style={{ 
                    gridTemplateRows: expandedId === conv.id ? '1fr' : '0fr' 
                  }}
                >
                  <div className="overflow-hidden">
                    <div className="px-5 pb-4 pt-2 border-t border-border/50 animate-fadeIn">
                      {conv.summary ? (
                        <div className="mb-3">
                          <p className="text-xs text-muted-foreground mb-1">会话摘要</p>
                          <p className="text-sm text-foreground/80 line-clamp-2">{conv.summary}</p>
                        </div>
                      ) : null}
                      {conv.last_message ? (
                        <div className="flex items-start gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">最后消息:</span>
                          <p className="text-sm text-muted-foreground line-clamp-1">{conv.last_message}</p>
                        </div>
                      ) : !conv.summary ? (
                        <p className="text-sm text-muted-foreground italic">无消息内容</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>

        {/* Pagination */}
        {!loading && conversations.length > 0 && totalPages > 1 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[40%] rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-lg shrink-0 z-10">
            <div className="w-full mx-auto px-4 py-2.5 flex items-center justify-between">
              {/* First page */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="首页"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              
              {/* Previous page */}
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="上一页"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              {/* Page numbers */}
              <div className="flex items-center mx-1">
                {(() => {
                  const getPageNumbers = () => {
                    if (totalPages <= 5) {
                      return Array.from({ length: totalPages }, (_, i) => i + 1);
                    }
                    const pages: (number | 'ellipsis')[] = [];
                    pages.push(1);
                    if (currentPage > 3) pages.push('ellipsis');
                    const start = Math.max(2, currentPage - 1);
                    const end = Math.min(totalPages - 1, currentPage + 1);
                    for (let i = start; i <= end; i++) pages.push(i);
                    if (currentPage < totalPages - 2) pages.push('ellipsis');
                    pages.push(totalPages);
                    return pages;
                  };
                  const pageNumbers = getPageNumbers();
                  return pageNumbers.map((p, idx) =>
                    p === 'ellipsis' ? (
                      <span key={`e-${idx}`} className="px-1 text-xs text-muted-foreground">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={`min-w-[32px] h-8 px-1.5 rounded text-xs transition-all ${
                          currentPage === p
                            ? 'bg-primary text-primary-foreground font-semibold shadow-md scale-105'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}
              </div>
              
              {/* Next page */}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="下一页"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              
              {/* Last page */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="末页"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
              {/* Jump to page */}
              <div className="flex items-center gap-1.5 text-xs ml-3">
                <span className="text-muted-foreground">跳至</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  placeholder={String(currentPage)}
                  value={jumpPage}
                  onChange={(e) => setJumpPage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const page = parseInt(jumpPage);
                      if (page >= 1 && page <= totalPages) {
                        setCurrentPage(page);
                        setJumpPage('');
                      } else {
                        toast.error(`请输入 1 到 ${totalPages} 之间的页码`);
                      }
                    }
                  }}
                  onBlur={() => setJumpPage('')}
                  className="w-12 h-7 px-2 text-center border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                />
                <span className="text-muted-foreground">页</span>
              </div>
              <span className="text-xs text-muted-foreground ml-4">
                共 <span className="font-semibold text-foreground">{totalCount}</span> 条记录
              </span>
            </div>
          </div>
        )}

      {/* Detail Modal */}
      {detailConv !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fadeIn"
          onClick={() => setDetailConv(null)}
        >
          <div
            ref={detailModalRef}
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-2xl shadow-lg flex flex-col animate-fadeInUp outline-none"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">{detailConv.title}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportDetail}
                  disabled={detailMessages.length === 0}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出
                </button>
                <button onClick={() => setDetailConv(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="关闭">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {detailLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
                </div>
              ) : detailMessages.length > 0 ? (
                <>
                  {/* Load more button at the top */}
                  {detailMessages.length < detailTotalMessages && (
                    <div className="flex justify-center pb-2">
                      <button
                        onClick={loadMoreMessages}
                        disabled={detailLoading}
                        className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {detailLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                        加载更早消息 ({detailTotalMessages - detailMessages.length} 条)
                      </button>
                    </div>
                  )}
                  {detailMessages.map((msg, idx) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'} animate-slideInRight`}
                      style={{ animationDelay: `${Math.min(idx * 50, 1000)}ms` }}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed transition-all duration-200 hover:shadow-md ${
                          msg.role === 'user'
                            ? 'bg-muted text-foreground'
                            : 'bg-primary text-primary-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium ${
                            msg.role === 'user' ? 'text-muted-foreground' : 'text-primary-foreground/70'
                          }`}>
                            {msg.role === 'user' ? '客户' : msg.role === 'assistant' ? 'AI 客服' : '系统'}
                          </span>
                        </div>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                  暂无消息内容
                </div>
              )}
            </div>
            {detailConv?.rating && (
              <div className="px-6 py-3 border-t border-border flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">满意度：</span>
                <span className="flex items-center gap-0.5 text-amber-500">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${i < detailConv.rating! ? 'fill-amber-400' : 'fill-none'}`}
                    />
                  ))}
                </span>
                {detailConv.rating_comment && (
                  <span className="text-muted-foreground ml-2">— {detailConv.rating_comment}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
