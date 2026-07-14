'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  Search, Plus, Ticket, X, Play, MessageCircle, CheckCircle,
  Archive, Send, Clock, User, Link2, Loader2, UserCheck, AlertTriangle, Timer
} from 'lucide-react';
import {
  Ticket as TicketType, TicketComment, TicketStatusLog,
  TicketCategory, TicketPriority, TicketStatus,
  TICKET_CATEGORY_LABELS, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS,
  TICKET_STATUS_COLORS, TICKET_PRIORITY_COLORS, TICKET_CATEGORY_COLORS,
} from '@/lib/types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface TicketWithExtras extends TicketType {
  assignee_name?: string | null;
  creator_name?: string | null;
  comment_count?: number;
  is_overdue?: boolean;
  response_overdue?: boolean;
  resolve_overdue?: boolean;
  sla_remaining_ms?: number | null;
  sla_deadline_at?: string | null;
  parent_ticket_id?: string | null;
  sub_tickets_count?: number;
  related_tickets_count?: number;
}

interface TicketDetail {
  ticket: TicketWithExtras;
  comments: TicketComment[];
  status_log: TicketStatusLog[];
}

// Default page size - configurable via ticket_page_size setting
const DEFAULT_PAGE_SIZE = 20; // Note: hardcoded here for frontend; use TICKET.PAGE_SIZE for API

// Sub-component: Ticket Relations Panel
function TicketRelationsPanel({ ticketId }: { ticketId: string }) {
  const [relations, setRelations] = useState<Array<{ id: string; relation_type: string; target_ticket?: { id: string; ticket_number: string; title: string; status: string }; source_ticket?: { id: string; ticket_number: string; title: string; status: string } }>>([]);
  const [subTickets, setSubTickets] = useState<Array<{ id: string; ticket_number: string; title: string; status: string; priority: string }>>([]);
  const [subProgress, setSubProgress] = useState<{ total: number; closed: number; resolved: number; in_progress: number }>({ total: 0, closed: 0, resolved: 0, in_progress: 0 });
  const [showAddRelation, setShowAddRelation] = useState(false);
  const [targetTicketNumber, setTargetTicketNumber] = useState('');
  const [relationType, setRelationType] = useState('related');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/tickets/${ticketId}/relations`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setRelations(data.relations || []);
          setSubTickets(data.sub_tickets || []);
          setSubProgress(data.sub_ticket_progress || { total: 0, closed: 0, resolved: 0, in_progress: 0 });
        }
      })
      .catch((err) => logger.error('[TicketRelationsPanel] Failed to fetch relations', { error: err }))
      .finally(() => setIsLoading(false));
  }, [ticketId]);

  const handleAddRelation = async () => {
    if (!targetTicketNumber.trim()) return;
    try {
      // Find ticket by number first
      const searchRes = await fetch(`/api/tickets?search=${encodeURIComponent(targetTicketNumber.trim())}`);
      if (!searchRes.ok) { toast.error('查找工单失败'); return; }
      const searchData = await searchRes.json();
      const found = searchData.tickets?.find((t: { ticket_number: string }) => t.ticket_number === targetTicketNumber.trim());
      if (!found) { toast.error('未找到该工单编号'); return; }

      const res = await fetch(`/api/tickets/${ticketId}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_ticket_id: found.id, relation_type: relationType }),
      });
      if (res.ok) {
        toast.success('关联创建成功');
        setTargetTicketNumber('');
        setShowAddRelation(false);
        // Reload
        const data = await (await fetch(`/api/tickets/${ticketId}/relations`)).json();
        setRelations(data.relations || []);
      } else {
        const err = await res.json();
        toast.error(err.error || '创建关联失败');
      }
    } catch {
      toast.error('创建关联失败');
    }
  };

  const handleRemoveRelation = async (relationId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/relations?relation_id=${relationId}`, { method: 'DELETE' });
      if (res.ok) {
        setRelations(prev => prev.filter(r => r.id !== relationId));
        toast.success('已取消关联');
      }
    } catch {
      toast.error('取消关联失败');
    }
  };

  const RELATION_LABELS: Record<string, string> = { blocks: '阻塞', related: '关联', duplicates: '重复', blocked_by: '被阻塞', duplicated_by: '被重复' };

  return (
    <div className="px-5 py-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">关联与子工单</span>
        <button onClick={() => setShowAddRelation(!showAddRelation)} className="text-xs text-primary hover:underline">+ 关联</button>
      </div>

      {showAddRelation && (
        <div className="flex items-center gap-2 mb-3 p-2 bg-muted rounded">
          <input type="text" placeholder="工单编号" value={targetTicketNumber} onChange={e => setTargetTicketNumber(e.target.value)} className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs" />
          <select value={relationType} onChange={e => setRelationType(e.target.value)} className="bg-background border border-border rounded px-2 py-1 text-xs">
            <option value="related">关联</option>
            <option value="blocks">阻塞</option>
            <option value="duplicates">重复</option>
          </select>
          <button onClick={handleAddRelation} className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded">确认</button>
        </div>
      )}

      {subTickets.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-muted-foreground">子工单 ({subProgress.closed + subProgress.resolved}/{subProgress.total} 已完成)</span>
          <div className="mt-1 w-full bg-muted rounded-full h-1.5">
            <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${subProgress.total > 0 ? ((subProgress.closed + subProgress.resolved) / subProgress.total) * 100 : 0}%` }} />
          </div>
          <div className="mt-2 space-y-1">
            {subTickets.map(st => (
              <div key={st.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-primary">{st.ticket_number}</span>
                <span className="text-foreground truncate flex-1">{st.title}</span>
                <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-medium ${st.status === 'closed' || st.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {st.status === 'closed' ? '已关闭' : st.status === 'resolved' ? '已解决' : st.status === 'in_progress' ? '处理中' : '待处理'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {relations.length > 0 && (
        <div className="space-y-1.5">
          {relations.map(r => {
            const other = r.target_ticket || r.source_ticket;
            if (!other) return null;
            return (
              <div key={r.id} className="flex items-center gap-2 text-xs group">
                <span className="px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground font-medium">{RELATION_LABELS[r.relation_type] || r.relation_type}</span>
                <span className="font-mono text-primary">{other.ticket_number}</span>
                <span className="text-foreground truncate flex-1">{other.title}</span>
                <button onClick={() => handleRemoveRelation(r.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : relations.length === 0 && subTickets.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无关联工单</p>
      ) : null}
    </div>
  );
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<TicketWithExtras[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<string | null>(null);
  const [batchPriority, setBatchPriority] = useState<TicketPriority>('medium');
  const [batchCategory, setBatchCategory] = useState<TicketCategory>('other');
  const [now, setNow] = useState(new Date());

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('other');
  const [newPriority, setNewPriority] = useState<TicketPriority>('medium');
  const [newDescription, setNewDescription] = useState('');
  const [newConversationId, setNewConversationId] = useState('');
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  // 翻页时清除选择状态，避免跨页误操作
  const handlePageChange = (newPage: number) => {
    setSelectedIds(new Set<string>());
    setCurrentPage(newPage);
  };

  // Confirm dialog
  const { confirm } = useConfirmDialog();
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const pageSize = DEFAULT_PAGE_SIZE;

  // Dynamic categories & custom fields
  const [dynamicCategories, setDynamicCategories] = useState<{ id: string; name: string; color: string }[]>([]);
  const [customFields, setCustomFields] = useState<{ id: string; name: string; field_key: string; field_type: string; options: string[] | null; is_required: boolean }[]>([]);

  const loadCategoriesAndFields = useCallback(async () => {
    try {
      const [catRes, fieldRes, usersRes] = await Promise.all([
        fetch('/api/tickets/categories'),
        fetch('/api/tickets/custom-fields'),
        fetch('/api/users'),
      ]);
      if (catRes.ok) {
        const catData = await catRes.json();
        setDynamicCategories(catData.categories || []);
      }
      if (fieldRes.ok) {
        const fieldData = await fieldRes.json();
        setCustomFields(fieldData.fields || []);
      }
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData.users || usersData || []);
      }
    } catch {
      // Non-critical - will fall back to hardcoded categories
    }
  }, []);

  const loadTickets = useCallback(async () => {
    // Clear selection when loading new page to prevent stale selections
    setSelectedIds(new Set<string>());
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterPriority !== 'all') params.set('priority', filterPriority);
      if (filterCategory !== 'all') params.set('category', filterCategory);
      if (sortField) params.set('sort_by', sortField);
      if (sortOrder) params.set('sort_order', sortOrder);
      params.set('page', String(currentPage));
      params.set('page_size', String(pageSize));

      const res = await fetch(`/api/tickets?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.tickets) {
        setTickets(data.tickets);
        setStatusCounts(data.status_counts || {});
        setTotalCount(data.total_count || data.tickets.length);
      }
    } catch {
      toast.error('加载工单列表失败');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, filterStatus, filterPriority, filterCategory, sortField, sortOrder, currentPage, pageSize]);

  useEffect(() => {
    loadTickets();
    loadCategoriesAndFields();
  }, [loadTickets, loadCategoriesAndFields]);

  // SLA countdown timer - update every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadTicketDetail = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ticket) {
        setSelectedTicket(data as TicketDetail);
      }
    } catch {
      toast.error('加载工单详情失败');
    }
  }, []);

  const handleStatusChange = useCallback(async (ticketId: string, newStatus: TicketStatus) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`工单状态已更新为${TICKET_STATUS_LABELS[newStatus]}`);
        loadTickets();
        loadTicketDetail(ticketId);
      } else {
        toast.error(data.error || '状态更新失败');
      }
    } catch {
      toast.error('状态更新失败');
    }
  }, [loadTickets, loadTicketDetail]);

  const handleDeleteTicket = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        toast.success('工单已删除');
        setShowDeleteConfirm(null);
        setSelectedTicket(null);
        loadTickets();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  }, [loadTickets]);

  const handleCloseTicket = useCallback(async (ticketId: string) => {
    const confirmed = await confirm({
      title: '关闭工单',
      description: '确认关闭此工单？',
      confirmText: '关闭',
      cancelText: '取消',
    });
    if (!confirmed) return;
    await handleStatusChange(ticketId, 'closed');
  }, [handleStatusChange, confirm]);

  const handleAutoAssign = useCallback(async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_assign: true }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('已自动指派最优坐席');
        loadTickets();
        loadTicketDetail(ticketId);
      } else {
        toast.error(data.error || '自动指派失败');
      }
    } catch {
      toast.error('自动指派失败');
    }
  }, [loadTickets, loadTicketDetail]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === tickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tickets.map(t => t.id)));
    }
  }, [selectedIds.size, tickets]);

  const handleBatchAction = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const updates: Record<string, unknown> = { ids: Array.from(selectedIds) };
    if (batchAction === 'close') updates.status = 'closed';
    else if (batchAction === 'resolve') updates.status = 'resolved';
    else if (batchAction === 'priority') updates.priority = batchPriority;
    else if (batchAction === 'category') updates.category = batchCategory;

    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`已批量更新 ${data.updated_count} 个工单`);
        setSelectedIds(new Set());
        setBatchAction(null);
        loadTickets();
      } else {
        toast.error(data.error || '批量操作失败');
      }
    } catch {
      toast.error('批量操作失败');
    }
  }, [selectedIds, batchAction, batchPriority, batchCategory, loadTickets]);

  const handleCreateTicket = useCallback(async () => {
    if (!newTitle.trim()) {
      toast.error('标题不能为空');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          category: newCategory,
          priority: newPriority,
          description: newDescription.trim() || null,
          conversation_id: newConversationId.trim() || null,
          assignee_id: newAssigneeId || null,
          custom_field_values: Object.entries(customFieldValues)
            .filter(([, v]) => v.trim() !== '')
            .map(([field_id, field_value]) => ({ field_id, field_value })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('工单创建成功');
        setShowCreateModal(false);
        setNewTitle('');
        setNewCategory('other');
        setNewPriority('medium');
        setNewDescription('');
        setNewConversationId('');
        setNewAssigneeId('');
        setCustomFieldValues({});
        loadTickets();
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch {
      toast.error('创建失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [newTitle, newCategory, newPriority, newDescription, newConversationId, newAssigneeId, loadTickets]);

  const handleSubmitComment = useCallback(async () => {
    if (!selectedTicket || !commentText.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.ticket.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: commentText.trim(),
          is_internal: isInternalNote,
        }),
      });
      if (res.ok) {
        setCommentText('');
        loadTicketDetail(selectedTicket.ticket.id);
      } else {
        toast.error('提交评论失败');
      }
    } catch {
      toast.error('提交评论失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedTicket, commentText, isInternalNote, loadTicketDetail]);

  function formatTime(dateStr: string | null) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function formatRemaining(ms: number | null | undefined): string {
    if (ms == null) return '';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const remainMins = minutes % 60;
    if (hours < 24) return `${hours}小时${remainMins > 0 ? remainMins + '分' : ''}`;
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return `${days}天${remainHours > 0 ? remainHours + '小时' : ''}`;
  }

  function getInitial(name: string | null | undefined) {
    return (name || '?').charAt(0);
  }

  const activeCount = (statusCounts['open'] || 0) + (statusCounts['in_progress'] || 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-card/50 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">工单管理</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {statusCounts['open'] !== undefined && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-amber-500/15 text-amber-600">
                待处理 {statusCounts['open']}
              </span>
            )}
            {statusCounts['in_progress'] !== undefined && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-primary/15 text-primary">
                处理中 {statusCounts['in_progress']}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary text-primary-foreground px-4 py-1.5 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all inline-flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          创建工单
        </button>
      </div>

      {/* Main Content */}
      <div className="px-6 pb-6 pt-4 flex gap-5 flex-1 min-h-0">
        {/* Left - Ticket List */}
        <div className="flex flex-col" style={{ width: '60%' }}>
          {/* Filters */}
          <div className="bg-card rounded-lg shadow-card p-4 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜索工单编号、标题..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-muted border-none rounded-md pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              >
                <option value="all">全部状态</option>
                {Object.entries(TICKET_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              >
                <option value="all">全部优先级</option>
                {Object.entries(TICKET_PRIORITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={filterCategory}
                onChange={(e) => { setFilterCategory(e.target.value); handlePageChange(1); }}
                className="bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              >
                <option value="all">全部分类</option>
                {dynamicCategories.length > 0
                  ? dynamicCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)
                  : ['refund', 'logistics', 'product', 'account', 'other'].map((c) => <option key={c} value={c}>{c}</option>)
                }
              </select>
              <select
                value={`${sortField}:${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split(':');
                  setSortField(field);
                  setSortOrder(order as 'asc' | 'desc');
                  setCurrentPage(1);
                }}
                className="bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              >
                <option value="created_at:desc">创建时间 (新→旧)</option>
                <option value="created_at:asc">创建时间 (旧→新)</option>
                <option value="updated_at:desc">更新时间 (新→旧)</option>
                <option value="priority:desc">优先级 (高→低)</option>
                <option value="priority:asc">优先级 (低→高)</option>
              </select>
            </div>
          </div>

          {/* Ticket Table */}
          <div className="bg-card rounded-lg shadow-card overflow-hidden flex-1 flex flex-col">
            {/* Table Header */}
            <div className="grid grid-cols-9 px-4 py-3 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
              <span className="flex items-center">
                <input
                  type="checkbox"
                  checked={tickets.length > 0 && selectedIds.size === tickets.length}
                  onChange={toggleSelectAll}
                  className="rounded border-muted-foreground/30"
                />
              </span>
              <span>工单编号</span>
              <span className="col-span-2">标题</span>
              <span>分类</span>
              <span>优先级</span>
              <span>状态</span>
              <span>负责人</span>
              <span>操作</span>
            </div>
            {/* Table Body */}
            <div className="divide-y divide-border overflow-y-auto flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                </div>
              ) : tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Ticket className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">暂无工单</p>
                  <p className="text-xs text-muted-foreground/60 mb-4">点击上方「创建工单」按钮新建</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >创建工单</button>
                </div>
              ) : (
                tickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className={`grid grid-cols-9 px-4 py-3 hover:bg-primary/5 cursor-pointer transition-colors ${
                      selectedTicket?.ticket.id === ticket.id ? 'bg-primary/5' : ''
                    } ${ticket.is_overdue ? 'bg-red-500/5 hover:bg-red-500/10' : ''}`}
                    onClick={() => loadTicketDetail(ticket.id)}
                  >
                    <span className="flex items-center" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(ticket.id)}
                        onChange={() => toggleSelect(ticket.id)}
                        className="rounded border-muted-foreground/30"
                      />
                    </span>
                    <span
                      className="text-sm font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(ticket.ticket_number); toast.success('已复制工单编号'); }}
                      title="点击复制编号"
                    >
                      {ticket.is_overdue && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                      {ticket.ticket_number}
                    </span>
                    <span className="text-sm font-medium text-foreground col-span-2 truncate">{ticket.title}</span>
                    <span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${TICKET_CATEGORY_COLORS[ticket.category as TicketCategory] || 'bg-muted text-muted-foreground'}`}>
                        {TICKET_CATEGORY_LABELS[ticket.category as TicketCategory] || ticket.category}
                      </span>
                    </span>
                    <span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-medium ${TICKET_PRIORITY_COLORS[ticket.priority as TicketPriority] || 'bg-muted text-muted-foreground'}`}>
                        {TICKET_PRIORITY_LABELS[ticket.priority as TicketPriority] || ticket.priority}
                      </span>
                    </span>
                    <span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${TICKET_STATUS_COLORS[ticket.status as TicketStatus] || 'bg-muted text-muted-foreground'}`}>
                        {TICKET_STATUS_LABELS[ticket.status as TicketStatus] || ticket.status}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {ticket.assignee_name ? (
                        <>
                          <div className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-medium flex items-center justify-center shrink-0">
                            {getInitial(ticket.assignee_name)}
                          </div>
                          <span className="text-sm text-muted-foreground truncate">{ticket.assignee_name}</span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); loadTicketDetail(ticket.id); }}
                        className="text-primary text-xs font-medium hover:underline"
                      >
                        查看
                      </button>
                      {ticket.status !== 'closed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCloseTicket(ticket.id); }}
                          className="text-muted-foreground text-xs hover:text-destructive transition-colors"
                        >
                          关闭
                        </button>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
            {/* Batch Action Bar */}
            {selectedIds.size > 0 && (
              <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3 flex items-center gap-3 z-10">
                <span className="text-sm text-muted-foreground">已选择 {selectedIds.size} 个工单</span>
                <button onClick={() => { setBatchAction('close'); }} className="px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground rounded hover:bg-muted/80 transition-colors">批量关闭</button>
                <button onClick={() => { setBatchAction('resolve'); }} className="px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground rounded hover:bg-muted/80 transition-colors">批量完成</button>
                <button onClick={() => { setBatchAction('priority'); }} className="px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground rounded hover:bg-muted/80 transition-colors">改优先级</button>
                <button onClick={() => { setBatchAction('category'); }} className="px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground rounded hover:bg-muted/80 transition-colors">改分类</button>
                <button onClick={() => setSelectedIds(new Set())} className="ml-auto px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">取消选择</button>
              </div>
            )}
            {/* Batch Action Confirm Dialog */}
            {batchAction && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setBatchAction(null)}>
                <div className="bg-card rounded-lg shadow-lg p-5 w-80" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold mb-3">确认批量操作</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    {batchAction === 'close' && `关闭 ${selectedIds.size} 个工单`}
                    {batchAction === 'resolve' && `标记完成 ${selectedIds.size} 个工单`}
                    {batchAction === 'priority' && `修改 ${selectedIds.size} 个工单的优先级`}
                    {batchAction === 'category' && `修改 ${selectedIds.size} 个工单的分类`}
                  </p>
                  {batchAction === 'priority' && (
                    <select value={batchPriority} onChange={e => setBatchPriority(e.target.value as TicketPriority)} className="w-full mb-3 px-3 py-2 text-sm border border-border rounded bg-background">
                      <option value="urgent">紧急</option>
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  )}
                  {batchAction === 'category' && (
                    <select value={batchCategory} onChange={e => setBatchCategory(e.target.value as TicketCategory)} className="w-full mb-3 px-3 py-2 text-sm border border-border rounded bg-background">
                      <option value="refund">退款</option>
                      <option value="logistics">物流</option>
                      <option value="product">商品</option>
                      <option value="account">账户</option>
                      <option value="other">其他</option>
                    </select>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setBatchAction(null)} className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">取消</button>
                    <button onClick={handleBatchAction} className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors">确认</button>
                  </div>
                </div>
              </div>
            )}
            {/* Pagination */}
            {totalCount > pageSize && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  共 {totalCount} 条 · 第 {currentPage}/{Math.ceil(totalCount / pageSize)} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage <= 1}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >首页</button>
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >上一页</button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalCount / pageSize), p + 1))}
                    disabled={currentPage >= Math.ceil(totalCount / pageSize)}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >下一页</button>
                  <button
                    onClick={() => setCurrentPage(Math.ceil(totalCount / pageSize))}
                    disabled={currentPage >= Math.ceil(totalCount / pageSize)}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >末页</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right - Detail Panel or Empty State */}
        <div style={{ width: '40%' }}>
          {selectedTicket ? (
            <div className="bg-card rounded-lg shadow-card h-full flex flex-col overflow-hidden">
              {/* Detail Header */}
              <div className="px-5 pt-5 pb-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-primary">{selectedTicket.ticket.ticket_number}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium ${TICKET_STATUS_COLORS[selectedTicket.ticket.status as TicketStatus] || ''}`}>
                      {TICKET_STATUS_LABELS[selectedTicket.ticket.status as TicketStatus] || selectedTicket.ticket.status}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-medium ${TICKET_PRIORITY_COLORS[selectedTicket.ticket.priority as TicketPriority] || ''}`}>
                      {TICKET_PRIORITY_LABELS[selectedTicket.ticket.priority as TicketPriority] || selectedTicket.ticket.priority}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="p-1 rounded hover:bg-muted transition-colors"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                <h2 className="text-lg font-bold text-foreground">{selectedTicket.ticket.title}</h2>
              </div>

              {/* Basic Info */}
              <div className="px-5 py-4 border-b border-border">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-muted-foreground">分类</span>
                    <p className="text-sm font-medium text-foreground mt-0.5">
                      {TICKET_CATEGORY_LABELS[selectedTicket.ticket.category as TicketCategory] || selectedTicket.ticket.category}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">创建人</span>
                    <p className="text-sm font-medium text-foreground mt-0.5">
                      {selectedTicket.ticket.creator_name || '系统自动'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">负责人</span>
                    <p className="text-sm font-medium text-foreground mt-0.5 flex items-center gap-1.5">
                      {selectedTicket.ticket.assignee_name ? (
                        <>
                          <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[8px] font-medium flex items-center justify-center">
                            {getInitial(selectedTicket.ticket.assignee_name)}
                          </span>
                          {selectedTicket.ticket.assignee_name}
                        </>
                      ) : '-'}
                    </p>
                  </div>
                  {selectedTicket.ticket.conversation_id && (
                    <div>
                      <span className="text-xs text-muted-foreground">关联对话</span>
                      <p className="text-sm font-medium mt-0.5">
                        <a href={`/history`} className="text-primary hover:underline">
                          {selectedTicket.ticket.conversation_id.slice(0, 8)}...
                        </a>
                      </p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground">创建时间</span>
                    <p className="text-sm font-medium text-foreground mt-0.5">{formatTime(selectedTicket.ticket.created_at)}</p>
                  </div>
                  {selectedTicket.ticket.resolved_at && (
                    <div>
                      <span className="text-xs text-muted-foreground">解决时间</span>
                      <p className="text-sm font-medium text-foreground mt-0.5">{formatTime(selectedTicket.ticket.resolved_at)}</p>
                    </div>
                  )}
                  {/* SLA remaining time - computed from deadline + current time */}
                  {selectedTicket.ticket.sla_deadline_at && selectedTicket.ticket.status !== 'closed' && selectedTicket.ticket.status !== 'resolved' && (() => {
                    const remaining = Math.max(0, new Date(selectedTicket.ticket.sla_deadline_at).getTime() - now.getTime());
                    const isOverdue = remaining === 0;
                    return (
                      <div>
                        <span className="text-xs text-muted-foreground">SLA剩余</span>
                        <p className={`text-sm font-medium mt-0.5 flex items-center gap-1 ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                          <Timer className="w-3 h-3" />
                          {isOverdue ? '已超时' : formatRemaining(remaining)}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Description */}
              {selectedTicket.ticket.description && (
                <div className="px-5 py-4 border-b border-border">
                  <span className="text-xs text-muted-foreground">描述</span>
                  <p className="text-sm text-foreground mt-1 leading-relaxed">{selectedTicket.ticket.description}</p>
                </div>
              )}

              {/* Status Log */}
              {selectedTicket.status_log && selectedTicket.status_log.length > 0 && (
                <div className="px-5 py-3 border-b border-border">
                  <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">状态变更</span>
                  <div className="mt-2 space-y-2">
                    {selectedTicket.status_log.map((log, index) => (
                      <div key={log.id || `log-${index}`} className="flex items-center gap-2 text-xs">
                        <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">{formatTime(log.created_at)}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium ${TICKET_STATUS_COLORS[log.from_status as TicketStatus] || 'bg-muted text-muted-foreground'}`}>
                          {log.from_status ? TICKET_STATUS_LABELS[log.from_status as TicketStatus] : '创建'}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium ${TICKET_STATUS_COLORS[log.to_status as TicketStatus] || 'bg-muted text-muted-foreground'}`}>
                          {TICKET_STATUS_LABELS[log.to_status as TicketStatus] || log.to_status}
                        </span>
                        {log.operator_name && (
                          <span className="text-muted-foreground ml-1">by {log.operator_name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status Action Buttons */}
              {selectedTicket.ticket.status !== 'closed' && (
                <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
                  {selectedTicket.ticket.status === 'open' && (
                    <button
                      onClick={() => handleStatusChange(selectedTicket.ticket.id, 'in_progress')}
                      className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:opacity-90 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                    >
                      <Play className="w-3 h-3" />开始处理
                    </button>
                  )}
                  {!selectedTicket.ticket.assignee_id && (
                    <button
                      onClick={() => handleAutoAssign(selectedTicket.ticket.id)}
                      className="bg-blue-500/15 text-blue-600 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-blue-500/25 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3 h-3" />自动指派
                    </button>
                  )}
                  {['in_progress', 'pending_customer'].includes(selectedTicket.ticket.status) && (
                    <>
                      <button
                        onClick={() => handleStatusChange(selectedTicket.ticket.id, 'pending_customer')}
                        className="bg-muted text-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:bg-muted/80 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                      >
                        <MessageCircle className="w-3 h-3" />待客户回复
                      </button>
                      <button
                        onClick={() => handleStatusChange(selectedTicket.ticket.id, 'resolved')}
                        className="bg-success/15 text-success px-3 py-1.5 rounded-md text-xs font-medium hover:bg-success/25 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                      >
                        <CheckCircle className="w-3 h-3" />已解决
                      </button>
                    </>
                  )}
                  {selectedTicket.ticket.status === 'resolved' && (
                    <button
                      onClick={() => handleStatusChange(selectedTicket.ticket.id, 'closed')}
                      className="bg-muted text-muted-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:bg-muted/80 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                    >
                      <Archive className="w-3 h-3" />关闭工单
                    </button>
                  )}
                  <button
                    onClick={() => setShowDeleteConfirm(selectedTicket.ticket.id)}
                    className="ml-auto bg-red-500/10 text-red-500 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-red-500/20 active:scale-[0.98] transition-all inline-flex items-center gap-1.5"
                  >
                    删除
                  </button>
                </div>
              )}

              {/* Related Tickets & Sub-tickets */}
              <TicketRelationsPanel ticketId={selectedTicket.ticket.id} />

              {/* Comments */}
              <div className="px-5 py-4 flex-1 overflow-y-auto">
                <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">评论与备注</span>
                <div className="mt-3 space-y-4">
                  {selectedTicket.comments.map((comment) => (
                    <div key={comment.id} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-primary/20 text-primary text-[10px] font-medium flex items-center justify-center shrink-0 mt-0.5">
                        {getInitial(comment.author_name)}
                      </div>
                      <div className={`flex-1 min-w-0 ${comment.is_internal ? 'border-l-2 border-amber-500 pl-3' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{comment.author_name || '未知'}</span>
                          {comment.is_internal && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-amber-500/15 text-amber-600">内部备注</span>
                          )}
                          <span className="text-xs text-muted-foreground">{formatTime(comment.created_at)}</span>
                        </div>
                        <p className="text-sm text-foreground mt-1 leading-relaxed">{comment.content}</p>
                      </div>
                    </div>
                  ))}
                  {selectedTicket.comments.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">暂无评论</p>
                  )}
                </div>
              </div>

              {/* Comment Input */}
              <div className="px-5 py-4 border-t border-border bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-xs text-muted-foreground">内部备注</label>
                  <button
                    onClick={() => setIsInternalNote(!isInternalNote)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${isInternalNote ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                    role="switch"
                    aria-checked={isInternalNote}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isInternalNote ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="输入评论或备注..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); } }}
                    className="flex-1 bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  />
                  <button
                    onClick={handleSubmitComment}
                    disabled={isSubmitting || !commentText.trim()}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all shrink-0 disabled:opacity-50"
                  >
                    提交
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-lg shadow-card h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Ticket className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">点击左侧工单查看详情</p>
              <p className="text-xs text-muted-foreground/60 mt-1">选择一条工单以查看完整信息和操作</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-dialog max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-foreground">创建工单</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            {/* Modal Content */}
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  标题 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  placeholder="输入工单标题"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    分类 <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as TicketCategory)}
                    className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  >
                    {dynamicCategories.length > 0
                      ? dynamicCategories.map(cat => (
                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                      ))
                      : Object.entries(TICKET_CATEGORY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))
                    }
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    优先级 <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
                    className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                  >
                    {Object.entries(TICKET_PRIORITY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  关联对话ID <span className="text-muted-foreground text-xs font-normal">(可选)</span>
                </label>
                <input
                  type="text"
                  placeholder="如 CONV-88291"
                  value={newConversationId}
                  onChange={(e) => setNewConversationId(e.target.value)}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  指派人 <span className="text-muted-foreground text-xs font-normal">(可选)</span>
                </label>
                <select
                  value={newAssigneeId}
                  onChange={(e) => setNewAssigneeId(e.target.value)}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                >
                  <option value="">不指派</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">描述</label>
                <textarea
                  rows={4}
                  placeholder="详细描述工单内容..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors resize-none"
                />
              </div>
              {/* Dynamic Custom Fields */}
              {customFields.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">自定义字段</span>
                  {customFields.map(field => (
                    <div key={field.id}>
                      <label className="text-sm font-medium text-foreground mb-1.5 block">
                        {field.name}
                        {field.is_required && <span className="text-destructive ml-0.5">*</span>}
                      </label>
                      {field.field_type === 'select' && field.options ? (
                        <select
                          value={customFieldValues[field.id] || ''}
                          onChange={e => setCustomFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                        >
                          <option value="">请选择</option>
                          {field.options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : field.field_type === 'date' ? (
                        <input
                          type="date"
                          value={customFieldValues[field.id] || ''}
                          onChange={e => setCustomFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                        />
                      ) : field.field_type === 'number' ? (
                        <input
                          type="number"
                          placeholder={`输入${field.name}`}
                          value={customFieldValues[field.id] || ''}
                          onChange={e => setCustomFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={`输入${field.name}`}
                          value={customFieldValues[field.id] || ''}
                          onChange={e => setCustomFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                          className="w-full bg-muted border-none rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowCreateModal(false)}
                className="bg-muted text-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-muted/80 active:scale-[0.98] transition-all"
              >
                取消
              </button>
              <button
                onClick={handleCreateTicket}
                disabled={isSubmitting || !newTitle.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isSubmitting ? '创建中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-card rounded-lg shadow-lg p-5 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-destructive mb-2">确认删除</h3>
            <p className="text-xs text-muted-foreground mb-4">此操作不可撤销，工单及其所有评论将被永久删除。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={() => handleDeleteTicket(showDeleteConfirm)} className="px-3 py-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 transition-colors">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
