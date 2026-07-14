'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  Search, Scan, Inbox, CheckCircle, XCircle, Target,
  Check, X, Pencil, GraduationCap, ChevronLeft, ChevronRight,
} from 'lucide-react';

interface LearningItem {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  conversation_id: string | null;
  conversation_title: string | null;
  source_context: string | null;
  category: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
  knowledge_item_id: string | null;
  created_at: string;
}

interface LearningStats {
  pendingCount: number;
  approvedWeekCount: number;
  rejectedWeekCount: number;
  coverage: number;
}

const CATEGORIES = ['产品相关', '物流相关', '售后相关', '支付相关', '优惠相关', '财务相关', '会员相关', '未分类'];

function getConfidenceStyle(confidence: number) {
  if (confidence > 0.7) return 'bg-success/15 text-success';
  if (confidence >= 0.4) return 'bg-warning/15 text-warning';
  return 'bg-destructive/15 text-destructive';
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'pending': return 'bg-warning/15 text-warning';
    case 'approved': return 'bg-success/15 text-success';
    case 'rejected': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'pending': return '待审核';
    case 'approved': return '已通过';
    case 'rejected': return '已拒绝';
    default: return status;
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function KnowledgeLearningPage() {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [stats, setStats] = useState<LearningStats>({
    pendingCount: 0,
    approvedWeekCount: 0,
    rejectedWeekCount: 0,
    coverage: 0,
  });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterConfidence, setFilterConfidence] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Edit modal
  const [editModal, setEditModal] = useState<{
    open: boolean;
    item: LearningItem | null;
    question: string;
    answer: string;
    category: string;
  }>({ open: false, item: null, question: '', answer: '', category: '' });

  // Last scan time
  const [lastScanTime, setLastScanTime] = useState<string>('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterConfidence) {
        if (filterConfidence === 'high') { params.set('confidenceMin', '0.7'); params.set('confidenceMax', '1'); }
        else if (filterConfidence === 'medium') { params.set('confidenceMin', '0.4'); params.set('confidenceMax', '0.7'); }
        else if (filterConfidence === 'low') { params.set('confidenceMin', '0'); params.set('confidenceMax', '0.4'); }
      }
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`/api/knowledge-learning?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.items) {
        setItems(data.items);
        setTotal(data.total);
        setStats(data.stats);
      }
    } catch (err) {
      logger.error('Failed to fetch learning items', { error: err });
      toast.error('加载知识学习队列失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterConfidence, searchQuery, page, pageSize]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/knowledge-learning', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLastScanTime(new Date().toLocaleString('zh-CN'));
      if (data.extracted > 0) {
        await fetchItems();
      }
      alert(data.message || '扫描完成');
    } catch (err) {
      logger.error('Scan failed', { error: err });
      alert('扫描失败，请重试');
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], action: 'approve' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        alert(data.errors.join('\n'));
      }
      await fetchItems();
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err) {
      logger.error('Approve failed', { error: err });
      toast.error('审核通过失败，请重试');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], action: 'reject' }),
      });
      if (!res.ok) {
        toast.error('拒绝失败');
        return;
      }
      await fetchItems();
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err) {
      logger.error('Reject failed', { error: err });
      toast.error('拒绝失败，请重试');
    }
  };

  const handleBatchApprove = async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), action: 'approve' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        alert(data.errors.join('\n'));
      }
      setSelectedIds(new Set());
      await fetchItems();
    } catch (err) {
      logger.error('Batch approve failed', { error: err });
      toast.error('批量通过失败，请重试');
    }
  };

  const handleBatchReject = async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), action: 'reject' }),
      });
      if (!res.ok) {
        toast.error('批量拒绝失败');
        return;
      }
      setSelectedIds(new Set());
      await fetchItems();
    } catch (err) {
      logger.error('Batch reject failed', { error: err });
      toast.error('批量拒绝失败，请重试');
    }
  };

  const handleEditApprove = (item: LearningItem) => {
    setEditModal({
      open: true,
      item,
      question: item.question,
      answer: item.answer,
      category: item.category,
    });
  };

  const handleEditSubmit = async () => {
    if (!editModal.item) return;
    try {
      // Update the item content first
      const updateRes = await fetch('/api/knowledge-learning', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editModal.item.id,
          question: editModal.question,
          answer: editModal.answer,
          category: editModal.category,
        }),
      });
      if (!updateRes.ok) {
        toast.error('更新内容失败');
        return;
      }
      // Then approve with the edited content
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [editModal.item.id],
          action: 'approve',
          question: editModal.question,
          answer: editModal.answer,
          category: editModal.category,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        alert(data.errors.join('\n'));
      }
      setEditModal({ open: false, item: null, question: '', answer: '', category: '' });
      await fetchItems();
    } catch (err) {
      logger.error('Edit & approve failed', { error: err });
      toast.error('编辑审核失败，请重试');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-full flex flex-col bg-background page-transition">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">知识自学习</h1>
          <p className="text-sm text-muted-foreground mt-1">系统自动扫描对话中的候选QA，经人工审核后入库知识库</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">待审核</span>
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Inbox className="w-4 h-4 text-primary" />
              </div>
            </div>
            <div className="text-3xl font-bold text-primary">{stats.pendingCount}</div>
          </div>
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">本周已入库</span>
              <div className="w-8 h-8 rounded-md bg-success/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-success" />
              </div>
            </div>
            <div className="text-3xl font-bold text-success">{stats.approvedWeekCount}</div>
          </div>
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">本周已拒绝</span>
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                <XCircle className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
            <div className="text-3xl font-bold text-muted-foreground">{stats.rejectedWeekCount}</div>
          </div>
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">知识覆盖率</span>
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-primary" />
              </div>
            </div>
            <div className="text-3xl font-bold text-primary">{stats.coverage}<span className="text-lg">%</span></div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Scan className="w-3.5 h-3.5" />{scanning ? '扫描中...' : '扫描对话'}
            </button>
            {lastScanTime && (
              <span className="text-xs text-muted-foreground">上次扫描：{lastScanTime}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none pr-8"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23637089' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="">全部状态</option>
              <option value="pending">待审核</option>
              <option value="approved">已通过</option>
              <option value="rejected">已拒绝</option>
            </select>
            <select
              value={filterConfidence}
              onChange={(e) => { setFilterConfidence(e.target.value); setPage(1); }}
              className="bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none pr-8"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23637089' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="">全部置信度</option>
              <option value="high">高 (&gt;0.7)</option>
              <option value="medium">中 (0.4-0.7)</option>
              <option value="low">低 (&lt;0.4)</option>
            </select>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                type="text"
                placeholder="搜索问题或回复..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="bg-muted border-none rounded-md pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 w-52"
              />
            </div>
          </div>
        </div>

        {/* Batch Action Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-primary-container rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-primary">已选 {selectedIds.size} 项</span>
              <button onClick={toggleSelectAll} className="text-xs text-primary font-medium hover:underline">
                {selectedIds.size === items.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBatchApprove}
                className="bg-success text-white px-3 py-1.5 rounded-md text-xs font-medium hover:opacity-90 transition-all inline-flex items-center gap-1.5"
              >
                <Check className="w-3 h-3" />批量通过
              </button>
              <button
                onClick={handleBatchReject}
                className="bg-surface-container-high text-muted-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:opacity-90 transition-all inline-flex items-center gap-1.5"
              >
                <X className="w-3 h-3" />批量拒绝
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-card rounded-lg shadow-card overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[40px_1fr_1fr_90px_140px_110px_90px_160px] px-4 py-3 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wide items-center">
            <span>
              <input
                type="checkbox"
                checked={items.length > 0 && selectedIds.size === items.length}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 rounded accent-primary"
              />
            </span>
            <span>问题描述</span>
            <span>AI原始回复</span>
            <span>置信度</span>
            <span>来源对话</span>
            <span>提取时间</span>
            <span>状态</span>
            <span>操作</span>
          </div>

          {/* Table Body */}
          {loading ? (
            <div className="py-20 text-center text-muted-foreground">
              <GraduationCap className="w-8 h-8 mx-auto mb-2 animate-pulse" />
              <p className="text-sm">加载中...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="py-20 text-center">
              <GraduationCap className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground mb-3">暂无待审核的候选知识</p>
              <button
                onClick={handleScan}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all"
              >
                立即扫描
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[40px_1fr_1fr_90px_140px_110px_90px_160px] px-4 py-3 hover:bg-muted/50 transition-all duration-200 items-center"
                >
                  <span>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="w-3.5 h-3.5 rounded accent-primary"
                    />
                  </span>
                  <span className="text-sm font-medium text-foreground line-clamp-2 pr-2" title={item.question}>
                    {item.question}
                  </span>
                  <span className="text-sm text-muted-foreground line-clamp-2 pr-2" title={item.answer}>
                    {item.answer}
                  </span>
                  <span className="inline-flex items-center justify-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-semibold ${getConfidenceStyle(item.confidence)}`}>
                      {item.confidence.toFixed(2)}
                    </span>
                  </span>
                  <a
                    href={item.conversation_id ? `/history?conv=${item.conversation_id}` : '#'}
                    className="text-sm text-primary hover:underline truncate"
                  >
                    {item.conversation_title || '未知对话'}
                  </a>
                  <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                  <span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${getStatusStyle(item.status)} w-fit`}>
                      {getStatusLabel(item.status)}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {item.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(item.id)}
                          className="text-xs font-medium px-2 py-1 rounded bg-success/10 text-success hover:bg-success/20 transition-colors"
                        >
                          通过
                        </button>
                        <button
                          onClick={() => handleEditApprove(item)}
                          className="text-xs font-medium px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                        >
                          编辑通过
                        </button>
                        <button
                          onClick={() => handleReject(item.id)}
                          className="text-xs font-medium px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                        >
                          拒绝
                        </button>
                      </>
                    )}
                    {item.status === 'approved' && (
                      <span className="text-xs text-success">已入库</span>
                    )}
                    {item.status === 'rejected' && (
                      <span className="text-xs text-muted-foreground">已拒绝</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted-foreground">共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-8 h-8 rounded-md bg-card shadow-card flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-foreground">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-8 h-8 rounded-md bg-card shadow-card flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editModal.open && editModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-xl shadow-dialog w-[640px] max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border/30">
              <h2 className="text-base font-semibold text-foreground">编辑并入库</h2>
              <p className="text-xs text-muted-foreground mt-0.5">编辑问题和答案后确认入库知识库</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">问题</label>
                <textarea
                  value={editModal.question}
                  onChange={(e) => setEditModal(prev => ({ ...prev, question: e.target.value }))}
                  rows={2}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">答案</label>
                <textarea
                  value={editModal.answer}
                  onChange={(e) => setEditModal(prev => ({ ...prev, answer: e.target.value }))}
                  rows={5}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">分类</label>
                <select
                  value={editModal.category}
                  onChange={(e) => setEditModal(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              {editModal.item.source_context && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">来源对话摘要</label>
                  <div className="bg-muted/60 rounded-md px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {editModal.item.source_context}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border/30 flex items-center justify-end gap-3">
              <button
                onClick={() => setEditModal({ open: false, item: null, question: '', answer: '', category: '' })}
                className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleEditSubmit}
                className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all inline-flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />确认入库
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
