'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search,
  GraduationCap, Scan, Inbox, CheckCircle, XCircle, Target,
  Folder,
  ChevronLeft, ChevronRight, ChevronDown,
  X, Check,
} from 'lucide-react';
import { LearningItem, LearningStats, LEARNING_CATEGORIES } from './types';
import { logger } from '@/lib/logger';

export function LearningTab() {
  const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
  const [learningStats, setLearningStats] = useState<LearningStats>({
    pendingCount: 0,
    approvedWeekCount: 0,
    rejectedWeekCount: 0,
    coverage: 0,
  });
  const [learningTotal, setLearningTotal] = useState(0);
  const [learningPage, setLearningPage] = useState(1);
  const [learningPageSize] = useState(20);
  const [loadingLearning, setLoadingLearning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterConfidence, setFilterConfidence] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLearningIds, setSelectedLearningIds] = useState<Set<string>>(new Set());
  const [expandedLearningId, setExpandedLearningId] = useState<string | null>(null);
  const [showLearningBatchCategoryModal, setShowLearningBatchCategoryModal] = useState(false);
  const [learningBatchCategory, setLearningBatchCategory] = useState('');
  const [editModal, setEditModal] = useState<{
    open: boolean;
    item: LearningItem | null;
    question: string;
    answer: string;
    category: string;
  }>({ open: false, item: null, question: '', answer: '', category: '' });
  const [lastScanTime, setLastScanTime] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const fetchLearningItems = useCallback(async () => {
    setLoadingLearning(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterConfidence) {
        if (filterConfidence === 'high') { params.set('confidenceMin', '0.7'); params.set('confidenceMax', '1'); }
        else if (filterConfidence === 'medium') { params.set('confidenceMin', '0.4'); params.set('confidenceMax', '0.7'); }
        else if (filterConfidence === 'low') { params.set('confidenceMin', '0'); params.set('confidenceMax', '0.4'); }
      }
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', String(learningPage));
      params.set('pageSize', String(learningPageSize));

      const res = await fetch(`/api/knowledge-learning?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.items) {
        setLearningItems(data.items);
        setLearningTotal(data.total);
        setLearningStats(data.stats);
      }
    } catch (err) {
      logger.error('Failed to fetch learning items', { error: err });
      toast.error('加载知识学习队列失败，请重试');
    } finally {
      setLoadingLearning(false);
    }
  }, [filterStatus, filterConfidence, searchQuery, learningPage, learningPageSize]);

  const fetchLearningStats = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge-learning?pageSize=1');
      if (!res.ok) return;
      const data = await res.json();
      if (data.stats) {
        setLearningStats(data.stats);
      }
    } catch (err) {
      logger.error('Failed to fetch learning stats', { error: err });
    }
  }, []);

  useEffect(() => {
    fetchLearningStats();
  }, [fetchLearningStats]);

  useEffect(() => {
    fetchLearningItems();
  }, [fetchLearningItems]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/knowledge-learning', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLastScanTime(new Date().toLocaleString('zh-CN'));
      if (data.extracted > 0) {
        await fetchLearningItems();
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
      await fetchLearningItems();
      setSelectedLearningIds(prev => { const next = new Set(prev); next.delete(id); return next; });
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
      await fetchLearningItems();
      setSelectedLearningIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err) {
      logger.error('Reject failed', { error: err });
      toast.error('拒绝失败，请重试');
    }
  };

  const handleBatchApprove = async () => {
    if (selectedLearningIds.size === 0) return;
    try {
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedLearningIds), action: 'approve' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        alert(data.errors.join('\n'));
      }
      setSelectedLearningIds(new Set());
      await fetchLearningItems();
    } catch (err) {
      logger.error('Batch approve failed', { error: err });
      toast.error('批量通过失败，请重试');
    }
  };

  const handleBatchReject = async () => {
    if (selectedLearningIds.size === 0) return;
    try {
      const res = await fetch('/api/knowledge-learning', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedLearningIds), action: 'reject' }),
      });
      if (!res.ok) {
        toast.error('批量拒绝失败');
        return;
      }
      setSelectedLearningIds(new Set());
      await fetchLearningItems();
    } catch (err) {
      logger.error('Batch reject failed', { error: err });
      toast.error('批量拒绝失败，请重试');
    }
  };

  const handleLearningBatchUpdateCategory = async () => {
    if (selectedLearningIds.size === 0) return;
    if (!learningBatchCategory.trim()) {
      toast.error('请选择分类');
      return;
    }
    try {
      const promises = Array.from(selectedLearningIds).map(id =>
        fetch('/api/knowledge-learning', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, category: learningBatchCategory }),
        })
      );
      const results = await Promise.all(promises);
      const failed = results.filter(r => !r.ok).length;
      if (failed > 0) {
        toast.error(`部分更新失败，${failed} 个`);
      } else {
        toast.success(`已更新 ${selectedLearningIds.size} 个条目的分类`);
      }
      setShowLearningBatchCategoryModal(false);
      setLearningBatchCategory('');
      setSelectedLearningIds(new Set());
      await fetchLearningItems();
    } catch (err) {
      logger.error('Batch update category failed', { error: err });
      toast.error('批量更新失败');
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
    setSaving(true);
    try {
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
      await fetchLearningItems();
    } catch (err) {
      logger.error('Edit & approve failed', { error: err });
      toast.error('编辑审核失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const toggleLearningSelect = (id: string) => {
    setSelectedLearningIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllLearning = () => {
    if (selectedLearningIds.size === learningItems.length) {
      setSelectedLearningIds(new Set());
    } else {
      setSelectedLearningIds(new Set(learningItems.map(i => i.id)));
    }
  };

  const learningTotalPages = Math.ceil(learningTotal / learningPageSize);

  const getConfidenceStyle = (confidence: number) => {
    if (confidence > 0.7) return 'bg-success/15 text-success';
    if (confidence >= 0.4) return 'bg-warning/15 text-warning';
    return 'bg-destructive/15 text-destructive';
  };

  const getLearningStatusStyle = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-warning/15 text-warning';
      case 'approved': return 'bg-success/15 text-success';
      case 'rejected': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getLearningStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return '待审核';
      case 'approved': return '已通过';
      case 'rejected': return '已拒绝';
      default: return status;
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <>
      <div className="p-6">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">系统自动扫描对话中的候选QA，经人工审核后入库知识库</p>
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
            <div className="text-3xl font-bold text-primary">{learningStats.pendingCount}</div>
          </div>
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">本周已入库</span>
              <div className="w-8 h-8 rounded-md bg-success/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-success" />
              </div>
            </div>
            <div className="text-3xl font-bold text-success">{learningStats.approvedWeekCount}</div>
          </div>
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">本周已拒绝</span>
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                <XCircle className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
            <div className="text-3xl font-bold text-muted-foreground">{learningStats.rejectedWeekCount}</div>
          </div>
          <div className="bg-card rounded-lg shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">知识覆盖率</span>
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-primary" />
              </div>
            </div>
            <div className="text-3xl font-bold text-primary">{learningStats.coverage}<span className="text-lg">%</span></div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between mb-4">
          <div />
          <div className="flex items-center gap-2">
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setLearningPage(1); }}
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
              onChange={(e) => { setFilterConfidence(e.target.value); setLearningPage(1); }}
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
                onChange={(e) => { setSearchQuery(e.target.value); setLearningPage(1); }}
                className="bg-muted border-none rounded-md pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 w-52"
              />
            </div>
          </div>
        </div>

        {/* Batch Action Bar */}
        {selectedLearningIds.size > 0 && (
          <div className="bg-primary/5 rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground">已选 {selectedLearningIds.size} 项</span>
              <button onClick={toggleSelectAllLearning} className="text-xs text-primary font-medium hover:underline">
                {selectedLearningIds.size === learningItems.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLearningBatchCategoryModal(true)}
                className="bg-primary/10 text-primary px-3 py-1.5 rounded-md text-xs font-medium hover:bg-primary/20 transition-all inline-flex items-center gap-1.5"
              >
                <Folder className="w-3 h-3" />批量分类
              </button>
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
                checked={learningItems.length > 0 && selectedLearningIds.size === learningItems.length}
                onChange={toggleSelectAllLearning}
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
          {loadingLearning ? (
            <div className="py-20 text-center text-muted-foreground">
              <GraduationCap className="w-8 h-8 mx-auto mb-2 animate-pulse" />
              <p className="text-sm">加载中...</p>
            </div>
          ) : learningItems.length === 0 ? (
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
              {learningItems.map((item) => (
                <div key={item.id}>
                  {/* Main row */}
                  <div
                    className="grid grid-cols-[40px_1fr_1fr_90px_140px_110px_90px_160px] px-4 py-3 hover:bg-muted/50 transition-all duration-200 items-center"
                  >
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedLearningIds.has(item.id)}
                        onChange={() => toggleLearningSelect(item.id)}
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
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExpandedLearningId(expandedLearningId === item.id ? null : item.id)}
                        className="text-sm text-primary hover:underline truncate inline-flex items-center gap-1 max-w-[100px]"
                        title={item.conversation_title || '未知对话'}
                      >
                        {item.conversation_title || '未知对话'}
                        {item.source_context && (
                          <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${expandedLearningId === item.id ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                    <span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${getLearningStatusStyle(item.status)} w-fit`}>
                        {getLearningStatusLabel(item.status)}
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
                  {/* Expanded source context */}
                  {expandedLearningId === item.id && item.source_context && (
                    <div className="px-4 pb-3 bg-muted/30 -mt-1">
                      <div className="text-xs text-muted-foreground mb-1 font-medium">原始对话上下文:</div>
                      <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap font-mono">
                        {item.source_context}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {learningTotalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted-foreground">共 {learningTotal} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLearningPage(p => Math.max(1, p - 1))}
                disabled={learningPage === 1}
                className="w-8 h-8 rounded-md bg-card shadow-card flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-foreground">{learningPage} / {learningTotalPages}</span>
              <button
                onClick={() => setLearningPage(p => Math.min(learningTotalPages, p + 1))}
                disabled={learningPage === learningTotalPages}
                className="w-8 h-8 rounded-md bg-card shadow-card flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal for Learning */}
      {editModal.open && editModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-xl shadow-dialog w-[640px] max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border/30">
              <h2 className="text-base font-semibold text-foreground">编辑并入库</h2>
              <p className="text-xs text-muted-foreground mt-0.5">编辑问题和答案后确认入库知识库，确认后将直接创建知识条目</p>
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
                  {LEARNING_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/30 flex items-center justify-end gap-3">
              <button
                onClick={() => setEditModal({ open: false, item: null, question: '', answer: '', category: '' })}
                className="px-4 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleEditSubmit}
                className="bg-success hover:bg-success/90 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {saving ? '入库中...' : '确认入库'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Category Modal for Learning */}
      {showLearningBatchCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] bg-card rounded-xl border border-border shadow-lg">
            <div className="h-12 border-b border-border px-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold">批量编辑分类</h3>
              <button onClick={() => setShowLearningBatchCategoryModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                将为 <span className="text-primary font-medium">{selectedLearningIds.size}</span> 个条目设置分类
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">分类名称</label>
                <select
                  value={learningBatchCategory}
                  onChange={(e) => setLearningBatchCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm"
                >
                  <option value="">请选择分类</option>
                  {LEARNING_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setShowLearningBatchCategoryModal(false)} className="px-3 py-1.5 rounded-lg text-xs">
                  取消
                </button>
                <button
                  onClick={handleLearningBatchUpdateCategory}
                  disabled={!learningBatchCategory.trim()}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs"
                >
                  确认修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
