'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Library,
  Plus,
  Trash2,
  Edit2,
  Play,
  Upload,
  Download,
  Search,
  X,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
} from 'lucide-react';
import { logger } from '@/lib/logger';
import type { TestCaseStatus } from '@/lib/types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
const simLogger = logger.default;

interface SimulationTestCase {
  id: string;
  name: string;
  description: string | null;
  category: string;
  status: TestCaseStatus;
  scripts: string[];
  expected_outcomes: string | null;
  tags: string[];
  source_conversation_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

interface TestCaseFormData {
  name: string;
  description: string;
  category: string;
  status: TestCaseStatus;
  scripts: string[];
  expected_outcomes: string;
  tags: string;
}

const DEFAULT_FORM: TestCaseFormData = {
  name: '',
  description: '',
  category: 'general',
  status: 'draft',
  scripts: [],
  expected_outcomes: '',
  tags: '',
};

const STATUS_CONFIG: Record<TestCaseStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: '草稿', color: 'text-amber-600', bgColor: 'bg-amber-500/15' },
  active: { label: '启用', color: 'text-emerald-700', bgColor: 'bg-emerald-200' },
  archived: { label: '归档', color: 'text-muted-foreground', bgColor: 'bg-muted' },
};

const CATEGORIES = [
  { value: 'general', label: '通用' },
  { value: 'order_inquiry', label: '订单查询' },
  { value: 'refund', label: '退款申请' },
  { value: 'product', label: '产品咨询' },
  { value: 'complaint', label: '投诉处理' },
  { value: 'shipping', label: '物流咨询' },
  { value: 'return', label: '退换货' },
];

interface TestCaseLibraryProps {
  onRunTest?: (testCase: SimulationTestCase) => void;
  onImportFromSimulation?: (conversationId: string) => void;
}

export function TestCaseLibrary({ onRunTest, onImportFromSimulation }: TestCaseLibraryProps) {
  const [testCases, setTestCases] = useState<SimulationTestCase[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TestCaseFormData>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<TestCaseStatus | ''>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Confirm dialog
  const { confirm } = useConfirmDialog();
  const LIMIT = 12;

  // Fetch test cases
  const fetchTestCases = useCallback(async (pageNum: number, append = false) => {
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(LIMIT),
      });
      if (filterStatus) params.set('status', filterStatus);
      if (filterCategory) params.set('category', filterCategory);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/simulation-test-cases?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setTestCases(prev => append ? [...prev, ...(data.testCases || [])] : (data.testCases || []));
      setTotal(data.total || 0);
      setHasMore((data.testCases || []).length === LIMIT);
    } catch (err) {
      simLogger.error('加载测试用例失败', { error: err });
      toast.error('加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [filterStatus, filterCategory, searchQuery]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    setPage(1);
    fetchTestCases(1, false);
  }, [fetchTestCases]);

  // Infinite scroll - useCallback properly at component level
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    setIsLoading(true);
    const nextPage = page + 1;
    await fetchTestCases(nextPage, true);
    setPage(nextPage);
  }, [hasMore, isLoading, page, fetchTestCases]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  // Open create dialog
  const handleOpenCreate = () => {
    setEditingId(null);
    setFormData(DEFAULT_FORM);
    setShowDialog(true);
  };

  // Open edit dialog
  const handleOpenEdit = (tc: SimulationTestCase) => {
    setEditingId(tc.id);
    setFormData({
      name: tc.name,
      description: tc.description || '',
      category: tc.category,
      status: tc.status,
      scripts: [...tc.scripts],
      expected_outcomes: tc.expected_outcomes || '',
      tags: tc.tags.join(', '),
    });
    setShowDialog(true);
  };

  // Save test case
  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('请输入用例名称');
      return;
    }
    if (!formData.category) {
      toast.error('请选择分类');
      return;
    }
    if (formData.scripts.length === 0) {
      toast.error('请添加至少一条测试脚本');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        category: formData.category,
        status: formData.status,
        scripts: formData.scripts,
        expected_outcomes: formData.expected_outcomes.trim() || undefined,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        ...(editingId ? { id: editingId } : {}),
      };

      const res = await fetch('/api/simulation-test-cases', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '保存失败');
      }

      toast.success(editingId ? '更新成功' : '创建成功');
      setShowDialog(false);
      fetchTestCases(1, false);
    } catch (err) {
      simLogger.error('保存测试用例失败', { error: err });
      toast.error(String(err) || '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete test case
  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: '删除测试用例',
      description: '确定删除此测试用例？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/simulation-test-cases?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      toast.success('已删除');
      setTestCases(prev => prev.filter(tc => tc.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
    } catch (err) {
      simLogger.error('删除测试用例失败', { error: err });
      toast.error('删除失败');
    }
  };

  // Run test
  const handleRunTest = (tc: SimulationTestCase) => {
    if (onRunTest) {
      onRunTest(tc);
    } else {
      toast.info('运行测试：' + tc.name);
    }
  };

  // Add script
  const handleAddScript = (script: string) => {
    if (script.trim()) {
      setFormData(prev => ({ ...prev, scripts: [...prev.scripts, script.trim()] }));
    }
  };

  // Remove script
  const handleRemoveScript = (idx: number) => {
    setFormData(prev => ({ ...prev, scripts: prev.scripts.filter((_, i) => i !== idx) }));
  };

  // Import from JSON text
  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error('请输入导入内容');
      return;
    }

    setIsImporting(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(importText);
      } catch {
        toast.error('JSON 格式错误');
        setIsImporting(false);
        return;
      }

      const payload = Array.isArray(parsed) ? { test_cases: parsed } : parsed;
      if (!payload.test_cases || !Array.isArray(payload.test_cases)) {
        toast.error('数据格式错误：需要 { test_cases: [...] }');
        setIsImporting(false);
        return;
      }

      // P2-12: Validate each test case has required fields
      const invalidCases = payload.test_cases.filter(
        (tc: Record<string, unknown>) => !tc.content || !tc.expected_response
      );
      if (invalidCases.length > 0) {
        toast.error(`检测到 ${invalidCases.length} 个无效用例（缺少 content 或 expected_response 字段）`);
        setIsImporting(false);
        return;
      }

      const res = await fetch('/api/simulation-test-cases/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '导入失败');
      }

      const data = await res.json();
      toast.success(`成功导入 ${data.imported} 条测试用例`);
      setShowImportDialog(false);
      setImportText('');
      fetchTestCases(1, false);
    } catch (err) {
      simLogger.error('导入测试用例失败', { error: err });
      toast.error(String(err) || '导入失败');
    } finally {
      setIsImporting(false);
    }
  };

  // Toggle selection for a test case
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select/deselect all visible items
  const toggleSelectAll = () => {
    if (selectedIds.size === testCases.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(testCases.map(tc => tc.id)));
    }
  };

  // Export to JSON via API (supports all data, not just current page)
  const handleExport = async (exportAll: boolean = false) => {
    if (exportAll && selectedIds.size > 0) {
      // Export selected items only
      const ids = Array.from(selectedIds).join(',');
      try {
        setIsExporting(true);
        const res = await fetch(`/api/simulation-test-cases/import?ids=${encodeURIComponent(ids)}`);
        if (!res.ok) throw new Error('Export failed');
        const data = await res.json();
        downloadJson(data.data);
        toast.success(`已导出 ${selectedIds.size} 条测试用例`);
      } catch (err) {
        simLogger.error('导出测试用例失败', { error: err });
        toast.error('导出失败');
      } finally {
        setIsExporting(false);
      }
    } else if (exportAll) {
      // Export all via API
      try {
        setIsExporting(true);
        const res = await fetch('/api/simulation-test-cases/import');
        if (!res.ok) throw new Error('Export failed');
        const data = await res.json();
        downloadJson(data.data);
        toast.success(`已导出 ${data.data.test_cases?.length || 0} 条测试用例`);
      } catch (err) {
        simLogger.error('导出测试用例失败', { error: err });
        toast.error('导出失败');
      } finally {
        setIsExporting(false);
      }
    } else {
      // Fallback: export current page (legacy behavior)
      downloadJson({
        version: '1.0',
        exported_at: new Date().toISOString(),
        test_cases: testCases.map(tc => ({
          name: tc.name,
          description: tc.description,
          category: tc.category,
          scripts: tc.scripts,
          expected_outcomes: tc.expected_outcomes,
          tags: tc.tags,
        })),
      });
      toast.success(`已导出 ${testCases.length} 条测试用例`);
    }
  };

  const downloadJson = (data: object) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-cases-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">测试用例库</h1>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => handleExport(true)}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              导出已选 ({selectedIds.size})
            </button>
          )}
          <button
            onClick={() => setShowImportDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            导入
          </button>
          <button
            onClick={() => handleExport(false)}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            导出全部
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新建用例
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border/50 bg-card/50 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="搜索用例名称..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
          />
        </div>

        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value as TestCaseStatus | ''); setPage(1); }}
          className="px-3 py-1.5 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="active">启用</option>
          <option value="archived">归档</option>
        </select>

        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">全部分类</option>
          {CATEGORIES.map(cat => (
            <option key={cat.value} value={cat.value}>{cat.label}</option>
          ))}
        </select>

        <div className="text-xs text-muted-foreground">
          共 {total} 条
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && testCases.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : testCases.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <Library className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">暂无测试用例</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              点击「新建用例」创建第一个测试用例
            </p>
          </div>
        ) : (
          <div className="space-y-2 mb-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <button
                onClick={toggleSelectAll}
                className="p-0.5"
              >
                {selectedIds.size === testCases.length && testCases.length > 0 ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
              全选
            </label>
          </div>
        )}
        {testCases.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {testCases.map((tc) => (
              <div
                key={tc.id}
                className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-colors"
              >
                {/* Card Header */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSelection(tc.id)}
                        className="shrink-0 p-0.5"
                      >
                        {selectedIds.has(tc.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-medium text-foreground truncate">{tc.name}</h3>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_CONFIG[tc.status].bgColor} ${STATUS_CONFIG[tc.status].color}`}>
                            {STATUS_CONFIG[tc.status].label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {tc.description || '无描述'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {tc.scripts.length} 条脚本
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-muted">
                      {CATEGORIES.find(c => c.value === tc.category)?.label || tc.category}
                    </span>
                  </div>

                  {/* Tags */}
                  {tc.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {tc.tags.slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                      {tc.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{tc.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Expanded Scripts Preview */}
                {expandedId === tc.id && (
                  <div className="px-4 pb-3 border-t border-border/50 bg-muted/30">
                    <div className="pt-3 space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">测试脚本</div>
                      {tc.scripts.map((script, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-medium">
                            {idx + 1}
                          </span>
                          <span className="text-foreground">{script}</span>
                        </div>
                      ))}
                      {tc.expected_outcomes && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <div className="text-xs font-medium text-muted-foreground mb-1">预期结果</div>
                          <p className="text-xs text-foreground">{tc.expected_outcomes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Card Footer */}
                <div className="px-4 py-3 border-t border-border/50 bg-muted/20 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setExpandedId(expandedId === tc.id ? null : tc.id)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title={expandedId === tc.id ? '收起' : '展开'}
                    >
                      {expandedId === tc.id ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRunTest(tc)}
                      className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                      title="运行测试"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleOpenEdit(tc)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(tc.id)}
                      className="p-1.5 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more trigger */}
        {hasMore && (
          <div ref={sentinelRef} className="py-4 flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-xs text-muted-foreground">加载更多...</span>
            )}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {editingId ? '编辑测试用例' : '新建测试用例'}
              </h2>
              <button
                onClick={() => setShowDialog(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1.5">用例名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="输入用例名称"
                  className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1.5">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="输入用例描述（可选）"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>

              {/* Category & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">分类 *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">状态</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as TestCaseStatus }))}
                    className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="draft">草稿</option>
                    <option value="active">启用</option>
                    <option value="archived">归档</option>
                  </select>
                </div>
              </div>

              {/* Scripts */}
              <div>
                <label className="block text-sm font-medium mb-1.5">测试脚本 *</label>
                <div className="space-y-2">
                  {formData.scripts.map((script, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1 px-3 py-2 rounded-lg bg-muted text-sm">
                        {script}
                      </div>
                      <button
                        onClick={() => handleRemoveScript(idx)}
                        className="p-1.5 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <ScriptInput onAdd={handleAddScript} />
              </div>

              {/* Expected Outcomes */}
              <div>
                <label className="block text-sm font-medium mb-1.5">预期结果</label>
                <textarea
                  value={formData.expected_outcomes}
                  onChange={(e) => setFormData(prev => ({ ...prev, expected_outcomes: e.target.value }))}
                  placeholder="输入预期结果（可选）"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium mb-1.5">标签</label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="输入标签，用逗号分隔（可选）"
                  className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setShowDialog(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold">导入测试用例</h2>
              <button
                onClick={() => { setShowImportDialog(false); setImportText(''); }}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-muted-foreground mb-3">
                粘贴 JSON 格式的测试用例数据：
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'{\n  "test_cases": [\n    {\n      "name": "用例名称",\n      "category": "general",\n      "scripts": ["脚本1", "脚本2"]\n    }\n  ]\n}'}
                rows={12}
                className="w-full px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
              />
              <p className="text-xs text-muted-foreground mt-2">
                支持两种格式：数组 <code className="px-1 py-0.5 rounded bg-muted">{"[{...}, {...}]"}</code> 或对象{" "}
                <code className="px-1 py-0.5 rounded bg-muted">{"{ test_cases: [...] }"}</code>
              </p>
            </div>

            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowImportDialog(false); setImportText(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isImporting ? '导入中...' : '导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Script input sub-component
function ScriptInput({ onAdd }: { onAdd: (script: string) => void }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    if (input.trim()) {
      onAdd(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入测试消息后按回车添加..."
        className="flex-1 px-3 py-2 rounded-lg bg-muted text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <button
        onClick={handleAdd}
        disabled={!input.trim()}
        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        添加
      </button>
    </div>
  );
}
