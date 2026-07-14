'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Search, Upload, X,
  FileText, Link as LinkIcon, Type, Trash2, Folder,
  FileSpreadsheet, Pencil, Check, History, RotateCcw, ImageIcon,
  File, FileImage, Eye, Archive, ArchiveRestore,
  Merge, ThumbsUp,
  StickyNote, ZoomIn,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageUploadInput } from '@/components/common/image-upload-input';
import { ImagePreviewDialog } from '@/components/common/image-preview-dialog';
import { Pagination } from '@/components/common/pagination';
import { QuickRepliesPanel } from '@/components/quick-replies/quick-replies-panel';
import { ImportProgress } from './import-progress';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import {
  KnowledgeItem,
  CategoryOption,
  ChunkItem,
  VersionItem,
  FILE_TYPE_MAP,
  FILE_EXTENSIONS_LABEL,
  formatFileSize,
  escapeHtml,
  CATEGORIES,
} from './types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function KnowledgeTab() {
  // Search state
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ content: string; score: number }>>([]);
  const [searching, setSearching] = useState(false);

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importType, setImportType] = useState<'text' | 'url' | 'file' | 'image'>('text');
  const [importText, setImportText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importName, setImportName] = useState('');
  const [importCategory, setImportCategory] = useState('');
  const [importParentCategory, setImportParentCategory] = useState('');
  const [customParentCategory, setCustomParentCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importImageUrl, setImportImageUrl] = useState('');
  const [importDescription, setImportDescription] = useState('');
  const [importMode, setImportMode] = useState<'quick' | 'enhanced'>('quick');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // P1-7: 防 race：保存最新的 AbortController，组件卸载或新请求时取消上一轮
  const listAbortRef = useRef<AbortController | null>(null);

  // Knowledge items state
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [itemCategories, setItemCategories] = useState<Record<string, number>>({});
  const [itemCategoryTree, setItemCategoryTree] = useState<Record<string, { count: number; children: Record<string, number> }>>({});
  const [itemFilterCat, setItemFilterCat] = useState('全部');
  const [loadingItems, setLoadingItems] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [versionHistoryItemId, setVersionHistoryItemId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<{ title: string; content: string; version: number } | null>(null);
  const [editExpiresAt, setEditExpiresAt] = useState<string>('');

  // Image preview state (lightbox)
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  // Chunks state
  const [showChunksDialog, setShowChunksDialog] = useState(false);
  const [chunksItemId, setChunksItemId] = useState<string | null>(null);
  const [chunksItemName, setChunksItemName] = useState<string>('');
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  // Batch operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [showBatchCategoryModal, setShowBatchCategoryModal] = useState(false);
  const [batchCategory, setBatchCategory] = useState('');
  const [batchParentCategory, setBatchParentCategory] = useState('');
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [batchOperating, setBatchOperating] = useState(false);

  // Load chunks when dialog opens
  useEffect(() => {
    if (!showChunksDialog) {
      setChunks([]);
      setChunksItemId(null);
      setChunksItemName('');
      return;
    }
    if (!chunksItemId) return;
    setLoadingChunks(true);
    fetch(`/api/knowledge/items/${chunksItemId}/chunks`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => setChunks(data.chunks || []))
      .catch(() => { toast.error('加载分块失败'); setChunks([]); })
      .finally(() => setLoadingChunks(false));
  }, [showChunksDialog, chunksItemId]);

  // Load knowledge items
  const loadKnowledgeItems = useCallback(async (pageArg = page, pageSizeArg = pageSize) => {
    // P1-7: 取消上一次未结束的请求，避免竞态覆盖最新数据
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    setLoadingItems(true);
    try {
      const url = new URL('/api/knowledge/items', window.location.origin);
      if (showArchived) url.searchParams.set('only_archived', 'true');
      const trimmedSearch = search.trim();
      if (trimmedSearch) url.searchParams.set('search', trimmedSearch);
      if (itemFilterCat && itemFilterCat !== '全部') {
        url.searchParams.set('category', itemFilterCat);
      }
      url.searchParams.set('page', String(pageArg));
      url.searchParams.set('limit', String(pageSizeArg));
      const res = await fetch(url.toString(), { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // P1-7: 若本轮已被取消，丢弃返回值避免覆盖更新数据
      if (ac.signal.aborted) return;
      setKnowledgeItems(data.items || []);
      setItemCategories(data.categories || {});
      setItemCategoryTree(data.categoryTree || {});
      const nextTotal = typeof data.total === 'number' ? data.total : 0;
      const nextTotalPages = typeof data.totalPages === 'number' ? data.totalPages : 0;
      setTotal(nextTotal);
      setTotalPages(nextTotalPages);
      setPage(typeof data.page === 'number' ? data.page : pageArg);
      // If current page is out of bounds (e.g., after deletion), step back.
      if (nextTotalPages > 0 && pageArg > nextTotalPages) {
        const target = Math.max(1, nextTotalPages);
        setPage(target);
        // Defer reload to next tick to avoid double-fetch inside this same render cycle.
        setTimeout(() => loadKnowledgeItems(target, pageSizeArg), 0);
      }
    } catch (err) {
      // P1-7: 忽略主动 abort 引起的错误
      if ((err as { name?: string })?.name === 'AbortError') return;
      // ignore
    } finally {
      if (!ac.signal.aborted) setLoadingItems(false);
    }
  }, [showArchived, search, itemFilterCat, page, pageSize]);

  // P1-7: 组件卸载时取消未结束请求
  useEffect(() => () => listAbortRef.current?.abort(), []);

  // Reload the currently active page; defined separately so callers stay readable.
  const reloadCurrentPage = useCallback(() => {
    return loadKnowledgeItems(page, pageSize);
  }, [loadKnowledgeItems, page, pageSize]);

  const loadCategoryOptions = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/categories');
      if (!res.ok) return;
      const data = await res.json();
      setCategoryOptions(data.categories || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCategoryOptions();
  }, [loadCategoryOptions]);

  // Reload items when archive toggle / search / category changes; reset to page 1 on filter changes.
  useEffect(() => {
    setPage(1);
  }, [showArchived, search, itemFilterCat, pageSize]);

  useEffect(() => {
    const handle = setTimeout(() => {
      loadKnowledgeItems(1, pageSize);
    }, 300);
    return () => clearTimeout(handle);
    // loadKnowledgeItems is intentionally omitted; we use page/pageSize as a stable proxy
    // after the previous effect already reset page to 1 on filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived, search, itemFilterCat]);

  // Search
  const handleSearch = useCallback(async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/knowledge?query=${encodeURIComponent(search)}&topK=5`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [search]);

  // Import handlers
  const handleImport = async () => {
    setImporting(true);
    // Get actual category values (convert __custom__ to empty string for submission)
    const actualParentCategory = getActualParentCategory(importParentCategory);
    const actualCategory = getActualCategory(importCategory);

    try {
      if (importType === 'image') {
        if (!importImageUrl.trim()) {
          toast.error('请上传图片或输入图片URL');
          setImporting(false);
          return;
        }
        const body: Record<string, string> = {
          type: 'image',
          name: importName || '导入图片',
          image_url: importImageUrl.trim(),
        };
        if (importDescription.trim()) body.content = importDescription.trim();
        if (actualCategory) body.category = actualCategory;
        if (actualParentCategory) body.parent_category = actualParentCategory;
        const res = await fetch('/api/knowledge/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.success) {
          resetImportState();
          // P1-8: 导入成功后跳到第 1 页，确保用户立即看到新增的条目
          loadKnowledgeItems(1, pageSize);
          toast.success('图片导入成功！');
        } else {
          toast.error(data.error?.message || data.error || '导入失败');
        }
      } else if (importType === 'file' && importFile) {
        const formData = new FormData();
        formData.append('file', importFile);
        formData.append('name', importName || importFile.name);
        if (actualCategory) formData.append('category', actualCategory);
        if (actualParentCategory) formData.append('parent_category', actualParentCategory);
        if (importImageUrl.trim()) formData.append('image_url', importImageUrl.trim());
        if (importDescription.trim()) formData.append('description', importDescription.trim());

        const res = await fetch('/api/knowledge/import-jobs', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.code === 0 && data.data?.job_id) {
          setImportJobId(data.data.job_id);
        } else if (data.success && data.job_id) {
          // apiSuccess format: { success: true, job_id: "xxx", status: "pending" }
          setImportJobId(data.job_id);
        } else {
          throw new Error(data.message || data.error || '创建导入任务失败');
        }
      } else if (importType === 'file' && !importFile) {
        toast.error('请选择要上传的文件');
        setImporting(false);
        return;
      } else {
        const body: Record<string, string> = { type: importType };
        if (importType === 'text') {
          body.content = importText;
          body.name = importName || '导入文本';
        } else {
          body.url = importUrl;
          body.name = importName || '导入网页';
        }
        if (actualCategory) body.category = actualCategory;
        if (actualParentCategory) body.parent_category = actualParentCategory;
        if (importImageUrl.trim()) body.image_url = importImageUrl.trim();
        const res = await fetch('/api/knowledge/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.success) {
          resetImportState();
          // P1-8: 导入成功后跳到第 1 页，确保用户立即看到新增的条目
          loadKnowledgeItems(1, pageSize);
          toast.success('资料导入成功！');
        } else {
          toast.error(data.error?.message || data.error || '导入失败');
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  const handleImportComplete = () => {
    resetImportState();
    // P1-8: 增强导入完成后跳到第 1 页，确保用户立即看到新增的条目
    loadKnowledgeItems(1, pageSize);
  };

  const handleImportClose = () => {
    setImportJobId(null);
    resetImportState();
  };

  const resetImportState = () => {
    setShowImport(false);
    setImportText('');
    setImportUrl('');
    setImportName('');
    setImportCategory('');
    setImportParentCategory('');
    setCustomParentCategory('');
    setCustomCategory('');
    setImportFile(null);
    setImportImageUrl('');
    setImportDescription('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Get actual category values (handle custom input mode and "none" placeholder)
  const getActualCategory = (value: string) => value === '__custom__' ? customCategory : (value === 'none' ? '' : value);
  const getActualParentCategory = (value: string) => value === '__custom__' ? customParentCategory : (value === 'none' ? '' : value);

  const isImportDisabled = () => {
    if (importing) return true;
    if (importType === 'text') return !importText.trim();
    if (importType === 'url') return !importUrl.trim();
    if (importType === 'file') return !importFile;
    if (importType === 'image') return !importImageUrl.trim();
    return true;
  };

  // CRUD operations
  const handleDeleteItem = async (id: string) => {
    const confirmed = await confirm({
      title: '删除知识库资料',
      description: '确定要删除这条知识库资料吗？此操作无法撤销。',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/knowledge/items?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('删除失败');
        return;
      }
      toast.success('已删除');
      // 给 Supabase 缓存同步的时间
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch {
      toast.error('删除失败');
    }
  };

  const startEdit = (item: KnowledgeItem) => {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditContent(item.content || '');
    setEditCategory(item.category || '');
    if (item.expires_at) {
      const d = new Date(item.expires_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      setEditExpiresAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setEditExpiresAt('');
    }
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditName('');
    setEditContent('');
    setEditCategory('');
    setEditExpiresAt('');
  };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: editName,
          content: editContent,
          category: editCategory,
          expires_at: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const versionRes = await fetch('/api/knowledge/versions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: id,
            title: editName,
            content: editContent,
            change_summary: '编辑更新',
          }),
        });
        if (!versionRes.ok) {
          toast.error('版本记录创建失败');
        }
        cancelEdit();
        reloadCurrentPage();
        toast.success('已保存');
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch {
      toast.error('更新失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // Version history
  const loadVersionHistory = useCallback(async (itemId: string) => {
    setVersionHistoryItemId(itemId);
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/knowledge/versions?item_id=${itemId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVersions(data.versions || []);
    } catch {
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  const handleRollback = async (versionId: string) => {
    const confirmed = await confirm({
      title: '回滚到历史版本',
      description: '确认回滚到此版本？将创建新版本记录。',
      confirmText: '确认回滚',
      cancelText: '取消',
    });
    if (!confirmed) return;
    try {
      const res = await fetch('/api/knowledge/versions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: versionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.version) {
        loadVersionHistory(versionHistoryItemId!);
        reloadCurrentPage();
        setViewingVersion(null);
        toast.success('已回滚到指定版本');
      } else {
        toast.error(data.error || '回滚失败');
      }
    } catch {
      toast.error('回滚失败，请重试');
    }
  };

  const handleViewVersion = async (versionId: string) => {
    try {
      const res = await fetch(`/api/knowledge/versions?item_id=${versionHistoryItemId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const v = (data.versions || []).find((ver: { id: string }) => ver.id === versionId);
      if (v) {
        setViewingVersion({ title: v.title, content: v.content, version: v.version_number });
      }
    } catch {
      // ignore
    }
  };

  const handleViewChunks = (itemId: string, itemName: string) => {
    setChunksItemId(itemId);
    setChunksItemName(itemName);
    setShowChunksDialog(true);
  };

  // Archive operations
  const handleArchiveItem = async (id: string) => {
    const confirmed = await confirm({
      title: '归档知识库资料',
      description: '确定要归档这条知识库资料吗？归档后默认不参与检索。',
      confirmText: '归档',
      cancelText: '取消',
    });
    if (!confirmed) return;
    try {
      const res = await fetch('/api/knowledge/items/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        toast.error('归档失败');
        return;
      }
      toast.success('已归档');
      // 给 Supabase 缓存同步的时间
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch {
      toast.error('归档失败');
    }
  };

  const handleUnarchiveItem = async (id: string) => {
    try {
      const res = await fetch('/api/knowledge/items/unarchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        toast.error('恢复失败');
        return;
      }
      toast.success('已恢复');
      // 给 Supabase 缓存同步的时间
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch {
      toast.error('恢复失败');
    }
  };

  const handleBatchArchive = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: '批量归档',
      description: `确认归档已选的 ${selectedIds.size} 条资料？`,
      confirmText: '确认归档',
      cancelText: '取消',
    });
    if (!confirmed) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '批量归档失败');
        return;
      }
      toast.success(`已归档 ${data.count} 条`);
      setSelectedIds(new Set());
      // 给 Supabase 缓存同步的时间
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch {
      toast.error('批量归档失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleBatchUnarchive = async () => {
    if (selectedIds.size === 0) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-unarchive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '批量恢复失败');
        return;
      }
      toast.success(`已恢复 ${data.count} 条`);
      setSelectedIds(new Set());
      // 给 Supabase 缓存同步的时间
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch {
      toast.error('批量恢复失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleBatchUpdateCategory = async () => {
    if (selectedIds.size === 0) return;
    if (!batchCategory.trim()) {
      toast.error('请输入新分类');
      return;
    }
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          category: batchCategory.trim(),
          parent_category: batchParentCategory.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '批量修改分类失败');
        return;
      }
      toast.success(`已修改 ${data.count} 条的分类`);
      setShowBatchCategoryModal(false);
      setBatchCategory('');
      setBatchParentCategory('');
      setSelectedIds(new Set());
      reloadCurrentPage();
      loadCategoryOptions();
    } catch {
      toast.error('批量修改分类失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: '批量删除',
      description: `确认删除已选的 ${selectedIds.size} 条资料？此操作无法撤销。`,
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '批量删除失败');
        return;
      }
      toast.success(`已删除 ${data.count} 条`);
      setSelectedIds(new Set());
      // 给 Supabase 缓存同步的时间
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch {
      toast.error('批量删除失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleMergeCategory = async () => {
    if (!mergeFrom.trim() || !mergeTo.trim()) {
      toast.error('请输入源分类与目标分类');
      return;
    }
    if (mergeFrom.trim() === mergeTo.trim()) {
      toast.error('源分类与目标分类不能相同');
      return;
    }
    const confirmed = await confirm({
      title: '合并分类',
      description: `确认将「${mergeFrom}」下所有条目合并到「${mergeTo}」？此操作不可撤销。`,
      confirmText: '确认合并',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/merge-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: mergeFrom.trim(), to: mergeTo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || '合并分类失败');
        return;
      }
      toast.success(`已将 ${data.count} 条从「${mergeFrom}」合并到「${mergeTo}」`);
      setShowMergeModal(false);
      setMergeFrom('');
      setMergeTo('');
      reloadCurrentPage();
      loadCategoryOptions();
    } catch {
      toast.error('合并分类失败');
    } finally {
      setBatchOperating(false);
    }
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [selectingAll, setSelectingAll] = useState(false);

  const buildAllIdsUrl = useCallback(() => {
    const url = new URL('/api/knowledge/items/all-ids', window.location.origin);
    if (showArchived) url.searchParams.set('only_archived', 'true');
    const trimmedSearch = search.trim();
    if (trimmedSearch) url.searchParams.set('search', trimmedSearch);
    if (itemFilterCat && itemFilterCat !== '全部') {
      url.searchParams.set('category', itemFilterCat);
    }
    return url.toString();
  }, [showArchived, search, itemFilterCat]);

  const toggleSelectAllVisible = async () => {
    const allSelected = selectedIds.size === total && total > 0;
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const res = await fetch(buildAllIdsUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ids: string[] = Array.isArray(data.ids) ? data.ids : [];
      setSelectedIds(new Set(ids));
    } catch {
      // ignore
    } finally {
      setSelectingAll(false);
    }
  };

  const visibleSelectedCount = useMemo(
    () => knowledgeItems.filter(i => selectedIds.has(i.id)).length,
    [knowledgeItems, selectedIds]
  );
  const allIdsSelected = total > 0 && selectedIds.size === total;
  const selectAllChecked = allIdsSelected || (knowledgeItems.length > 0 && visibleSelectedCount === knowledgeItems.length);
  const selectedItems = knowledgeItems.filter(i => selectedIds.has(i.id));
  const hasArchivedSelected = selectedItems.some(i => !!i.archived_at);
  const allSelectedArchived = selectedItems.length > 0 && selectedItems.every(i => !!i.archived_at);

  // Icon helpers
  const getItemIcon = (type: string, name?: string) => {
    if (type === 'file') {
      const ext = name ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
      if (['.xlsx', '.xls', '.csv'].includes(ext)) return <FileSpreadsheet className="w-4 h-4 text-amber-600" />;
      if (['.pdf'].includes(ext)) return <FileImage className="w-4 h-4 text-red-500" />;
      if (['.docx', '.doc'].includes(ext)) return <File className="w-4 h-4 text-blue-500" />;
      return <FileText className="w-4 h-4 text-amber-600" />;
    }
    if (type === 'url') return <LinkIcon className="w-4 h-4 text-success" />;
    if (type === 'image') return <ImageIcon className="w-4 h-4 text-primary" />;
    return <Type className="w-4 h-4 text-primary" />;
  };

  const getItemIconBg = (type: string, name?: string) => {
    if (type === 'file') {
      const ext = name ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
      if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'bg-amber-500/10';
      if (['.pdf'].includes(ext)) return 'bg-red-500/10';
      if (['.docx', '.doc'].includes(ext)) return 'bg-blue-500/10';
      return 'bg-amber-500/10';
    }
    if (type === 'url') return 'bg-success/10';
    if (type === 'image') return 'bg-primary/10';
    return 'bg-primary/10';
  };

  return (
    <>
      {/* Search bar */}
      <div className="px-6 py-4 border-b border-border/50">
        <div className="flex gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索知识库..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            <Upload className="w-4 h-4" />
            导入资料
          </button>
        </div>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="px-6 py-3 space-y-2 border-b border-border/50">
          <h3 className="text-sm font-medium text-foreground">搜索结果</h3>
          {searchResults.map((result, i) => (
            <div key={i} className="p-3 rounded-lg bg-muted/50 text-sm text-foreground">
              {result.content}
              <span className="ml-2 text-xs text-muted-foreground">相关度: {(result.score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Stats bar */}
      <div className="px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium">
            <FileText className="w-4 h-4" />
            {total} 条资料
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Folder className="w-4 h-4" />
            {Object.keys(itemCategories).length} 个分类
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showArchived
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Archive className="w-3.5 h-3.5" />
            {showArchived ? '显示全部' : '已归档资料'}
          </button>
        </div>
      </div>

      {/* Category filter */}
      {Object.keys(itemCategoryTree).length > 0 && (
        <div className="px-6 py-3 flex gap-2 overflow-x-auto flex-wrap">
          <button
            onClick={() => setItemFilterCat('全部')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              itemFilterCat === '全部'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            全部 ({total})
          </button>
          {Object.entries(itemCategoryTree).map(([parentCat, { count, children }]) => (
            <div key={parentCat} className="flex items-center gap-1">
              <button
                onClick={() => setItemFilterCat(parentCat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  itemFilterCat === parentCat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {parentCat} ({count})
              </button>
              {Object.entries(children).map(([childCat, childCount]) => (
                <button
                  key={childCat}
                  onClick={() => setItemFilterCat(childCat)}
                  className={`px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                    itemFilterCat === childCat
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted/50 text-muted-foreground/70 hover:text-foreground'
                  }`}
                >
                  └ {childCat} ({childCount})
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="px-6 py-3 border-b border-border/50 bg-primary/5 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            已选 <span className="text-primary">{selectedIds.size}</span> 条
          </span>
          <div className="flex-1" />
          {allSelectedArchived ? (
            <button
              onClick={handleBatchUnarchive}
              disabled={batchOperating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-foreground text-xs hover:bg-muted transition-colors disabled:opacity-50"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
              批量恢复
            </button>
          ) : (
            <button
              onClick={handleBatchArchive}
              disabled={batchOperating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-foreground text-xs hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Archive className="w-3.5 h-3.5" />
              批量归档
            </button>
          )}
          <button
            onClick={() => setShowBatchCategoryModal(true)}
            disabled={batchOperating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-foreground text-xs hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Folder className="w-3.5 h-3.5" />
            批量改分类
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={batchOperating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            批量删除
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            取消选择
          </button>
        </div>
      )}

      {/* Items list */}
      <div className="px-6 py-4 space-y-2 max-w-4xl">
        {/* Select-all row */}
        {(knowledgeItems.length > 0 || total > 0) && (
          <div className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={selectAllChecked}
              onChange={toggleSelectAllVisible}
              disabled={selectingAll}
              className="w-3.5 h-3.5 rounded border-border disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="全选当前筛选的全部条目"
            />
            <span className="text-xs text-muted-foreground">
              全选 {allIdsSelected
                ? `（已选全部 ${total} 条）`
                : selectingAll
                  ? '（加载中...）'
                  : `（${visibleSelectedCount}/${total}）`}
            </span>
          </div>
        )}
        {loadingItems ? (
          <div className="text-center py-12 text-sm text-muted-foreground">加载中...</div>
        ) : knowledgeItems.length === 0 ? (
          <div className="text-center py-16">
            <Folder className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground mb-1">暂无知识库资料</p>
            <p className="text-xs text-muted-foreground/60">点击右上角「导入资料」开始添加</p>
          </div>
        ) : (
          knowledgeItems.map((item) => {
            const isArchived = !!item.archived_at;
            const isExpired = !!(item.expires_at && new Date(item.expires_at).getTime() < Date.now());
            const adoptTotal = (item.adopted_count || 0) + (item.rejected_count || 0);
            const adoptRate = adoptTotal > 0 ? (item.adopted_count || 0) / adoptTotal : null;
            return (
              <div key={item.id} className={`border rounded-xl bg-card p-4 card-hover-lift ${isArchived ? 'border-amber-400/60 bg-amber-50/50' : 'border-border'} ${selectedIds.has(item.id) ? 'ring-2 ring-primary/30' : ''}`}>
                {editingItemId === item.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">名称</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">分类</label>
                      <input
                        type="text"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors shadow-sm"
                        placeholder="如：产品介绍、技术支持..."
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">失效时间（可选，到期后从检索中隐藏）</label>
                      <input
                        type="datetime-local"
                        value={editExpiresAt}
                        onChange={(e) => {
                          const val = e.target.value;
                          // Validate format: YYYY-MM-DDTHH:mm (4-digit year only)
                          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val) || val === '') {
                            setEditExpiresAt(val);
                          } else if (/^\d{5,}/.test(val)) {
                            // Truncate extra digits in year (e.g., 123456 → 1234)
                            const truncated = val.replace(/^(\d{4})\d+/, '$1');
                            setEditExpiresAt(truncated);
                          } else {
                            // For partial input, only update if still valid partial
                            if (/^\d{0,4}(-\d{0,2}(-\d{0,2}(T\d{0,2}(:\d{0,2})?)?)?)?$/.test(val)) {
                              setEditExpiresAt(val);
                            }
                          }
                        }}
                        min="2000-01-01T00:00"
                        className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors shadow-sm"
                      />
                      {editExpiresAt && (
                        <button
                          type="button"
                          onClick={() => setEditExpiresAt('')}
                          className="text-xs text-muted-foreground hover:text-foreground mt-1"
                        >
                          清除失效时间
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">内容</label>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={5}
                        className="w-full resize-none px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors shadow-sm"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => handleSaveEdit(item.id)}
                        disabled={saving || !editName.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" />
                        {saving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 mt-1 rounded border-border shrink-0"
                      aria-label={`选择 ${item.name}`}
                    />
                    <div className="flex items-start justify-between flex-1 min-w-0">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {item.image_url ? (
                          <button
                            type="button"
                            onClick={() => setPreviewImage({ url: item.image_url!, title: item.name })}
                            className="relative w-12 h-12 rounded-lg overflow-hidden border border-border bg-muted shrink-0 group cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary/40"
                            title="点击预览图片"
                            aria-label={`预览图片：${item.name}`}
                          >
                            <img
                              src={item.image_url}
                              alt={item.name}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => {
                                const target = e.currentTarget;
                                target.style.display = 'none';
                                target.parentElement?.classList.add('flex', 'items-center', 'justify-center', 'bg-primary/10');
                                const icon = document.createElement('div');
                                icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-primary"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>';
                                target.parentElement?.appendChild(icon.firstElementChild!);
                              }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <ZoomIn className="w-4 h-4 text-white drop-shadow" />
                            </div>
                          </button>
                        ) : (
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getItemIconBg(item.type, item.name)}`}>
                            {getItemIcon(item.type, item.name)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-sm font-medium truncate ${isArchived ? 'text-muted-foreground' : 'text-foreground'}`}>{item.name}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                              {FILE_TYPE_MAP[item.type] || item.type}
                            </span>
                            {item.category && item.category !== '未分类' && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                                {item.category}
                              </span>
                            )}
                            {isArchived && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 shrink-0">
                                已归档
                              </span>
                            )}
                            {!isArchived && isExpired && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">
                                已过期
                              </span>
                            )}
                          </div>
                          {item.content && (
                            <p className="text-xs text-muted-foreground line-clamp-3">{item.content}</p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/60 flex-wrap">
                            <span>{new Date(item.created_at).toLocaleDateString('zh-CN')}</span>
                            {item.chunk_count > 0 && (
                              <button
                                onClick={() => handleViewChunks(item.id, item.name)}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                                title="查看分块内容"
                              >
                                {item.chunk_count} 个分块
                              </button>
                            )}
                            {(item.hit_count ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1" title={`被引用 ${item.hit_count} 次${item.last_hit_at ? `，最近 ${new Date(item.last_hit_at).toLocaleDateString('zh-CN')}` : ''}`}>
                                <Eye className="w-3 h-3" />
                                {item.hit_count} 次引用
                              </span>
                            )}
                            {item.image_url && (
                              <button
                                type="button"
                                onClick={() => setPreviewImage({ url: item.image_url!, title: item.name })}
                                className="inline-flex items-center gap-1 text-primary/70 hover:text-primary hover:underline cursor-zoom-in"
                                title="点击查看大图"
                              >
                                <ImageIcon className="w-3 h-3" />
                                查看图片
                              </button>
                            )}
                            {item.expires_at && !isExpired && (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                失效：{new Date(item.expires_at).toLocaleDateString('zh-CN')}
                              </span>
                            )}
                            {adoptRate !== null && (
                              <span
                                className={`inline-flex items-center gap-1 ${adoptRate >= 0.7 ? 'text-emerald-700' : adoptRate >= 0.4 ? 'text-amber-700' : 'text-red-700'}`}
                                title={`采纳 ${item.adopted_count || 0} / 拒绝 ${item.rejected_count || 0}`}
                              >
                                <ThumbsUp className="w-3 h-3" />
                                采纳率 {(adoptRate * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {isArchived ? (
                          <button
                            onClick={() => handleUnarchiveItem(item.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="恢复"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleArchiveItem(item.id)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="归档"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => startEdit(item)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title="编辑"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => loadVersionHistory(item.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title="版本历史"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Pagination */}
        <div className="pt-2 border-t border-border/40">
          {totalPages === 0 && loadingItems ? (
            <div className="text-center py-6 text-sm text-muted-foreground">加载中...</div>
          ) : totalPages > 0 ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={(p) => {
                setPage(p);
                loadKnowledgeItems(p, pageSize);
              }}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
                loadKnowledgeItems(1, size);
              }}
              disabled={loadingItems}
            />
          ) : null}
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => resetImportState()}>
          <div className="w-full max-w-lg bg-card rounded-2xl shadow-lg p-6 popup-enter" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-foreground">导入资料</h3>
              <button onClick={() => resetImportState()} className="p-1.5 rounded-lg hover:bg-muted">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Type tabs */}
            <div className="flex gap-1 bg-muted rounded-lg p-0.5 mb-4">
              <button
                onClick={() => setImportType('text')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  importType === 'text' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <Type className="w-4 h-4" />
                文本粘贴
              </button>
              <button
                onClick={() => setImportType('url')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  importType === 'url' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <LinkIcon className="w-4 h-4" />
                URL 导入
              </button>
              <button
                onClick={() => setImportType('file')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  importType === 'file' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                文件上传
              </button>
              <button
                onClick={() => setImportType('image')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  importType === 'image' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                图片
              </button>
            </div>

            {/* Name */}
            <div className="mb-3">
              <label className="text-sm font-medium text-foreground mb-1 block">资料名称</label>
              <input
                type="text"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder={importType === 'file' ? '不填则使用文件名' : '输入资料名称'}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Parent & Sub Category - Same Row */}
            <div className="mb-3 flex gap-3">
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground mb-1 block">父分类（可选）</label>
                <div className="flex gap-2">
                  <Select
                    value={importParentCategory || "none"}
                    onValueChange={(val) => {
                      if (val === '__custom__') {
                        setImportParentCategory('__custom__');
                      } else if (val === 'none') {
                        setImportParentCategory('');
                        setImportCategory('');
                      } else {
                        setImportParentCategory(val);
                        setImportCategory('');
                      }
                    }}
                  >
                    <SelectTrigger className="w-full h-9 bg-muted border-none text-sm">
                      <SelectValue placeholder="不设置" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不设置</SelectItem>
                      {CATEGORIES.filter(c => c !== '未分类').map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">+ 自定义...</SelectItem>
                    </SelectContent>
                  </Select>
                  {importParentCategory === '__custom__' && (
                    <input
                      type="text"
                      value={customParentCategory}
                      onChange={(e) => setCustomParentCategory(e.target.value)}
                      placeholder="输入名称"
                      className="w-24 px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 shrink-0"
                    />
                  )}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground mb-1 block">子分类（可选）</label>
                <div className="flex gap-2">
                  <Select
                    value={importCategory || "none"}
                    onValueChange={(val) => {
                      if (val === '__custom__') {
                        setImportCategory('__custom__');
                      } else if (val === 'none') {
                        setImportCategory('');
                      } else {
                        setImportCategory(val);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full h-9 bg-muted border-none text-sm">
                      <SelectValue placeholder="不设置" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不设置</SelectItem>
                      {CATEGORIES.filter(c => c !== '未分类').map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">+ 自定义...</SelectItem>
                    </SelectContent>
                  </Select>
                  {importCategory === '__custom__' && (
                    <input
                      type="text"
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="输入名称"
                      className="w-24 px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 shrink-0"
                    />
                  )}
                </div>
              </div>
            </div>

            {importType === 'text' ? (
              <div className="mb-4">
                <label className="text-sm font-medium text-foreground mb-1 block">文本内容</label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="粘贴文本内容..."
                  rows={6}
                  className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ) : importType === 'url' ? (
              <div className="mb-4">
                <label className="text-sm font-medium text-foreground mb-1 block">网页地址</label>
                <input
                  type="url"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ) : importType === 'image' ? (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1 block">上传图片</label>
                  <ImageUploadInput
                    value={importImageUrl}
                    onChange={setImportImageUrl}
                    placeholder="点击上传图片或输入图片URL"
                    preview={true}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1 block flex items-center gap-1.5">
                    图片描述
                    <span className="text-xs text-muted-foreground font-normal">（可选，帮助AI理解图片内容）</span>
                  </label>
                  <textarea
                    value={importDescription}
                    onChange={(e) => setImportDescription(e.target.value)}
                    placeholder="描述图片内容，如：女装T恤尺码对照表、退货流程示意图..."
                    rows={3}
                    className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="text-sm font-medium text-foreground mb-1 block">选择文件</label>
                <div className="relative">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.md,.txt,.jpg,.jpeg,.png,.gif,.webp"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="flex items-center justify-center gap-2 w-full py-8 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      点击选择文件，或拖放到此处
                    </span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground/60 mt-1.5">
                  支持 {FILE_EXTENSIONS_LABEL} 格式的文件，最大 20MB
                </p>
                {importFile && (
                  <div className="mt-3 flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/60">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getItemIconBg('file', importFile.name)}`}>
                      {getItemIcon('file', importFile.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{importFile.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(importFile.size)}</p>
                    </div>
                    <button
                      onClick={() => {
                        setImportFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Image URL field */}
            {importType !== 'image' && (
              <div className="mb-4">
                <label className="text-sm font-medium text-foreground mb-1 block flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" />
                  关联图片
                  <span className="text-xs text-muted-foreground font-normal">（可选，AI回复时可引用此图片）</span>
                </label>
                <ImageUploadInput
                  value={importImageUrl}
                  onChange={setImportImageUrl}
                  placeholder="上传图片或输入图片URL"
                />
              </div>
            )}

            {/* Import Mode Selection */}
            {importType === 'file' && importFile && (
              <div className="mb-4 p-3 rounded-lg bg-muted/50">
                <label className="text-sm font-medium text-foreground mb-2 block">导入模式</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="quick"
                      checked={importMode === 'quick'}
                      onChange={() => setImportMode('quick')}
                      className="accent-primary"
                    />
                    <span className="text-sm">快速导入</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="enhanced"
                      checked={importMode === 'enhanced'}
                      onChange={() => setImportMode('enhanced')}
                      className="accent-primary"
                    />
                    <span className="text-sm">
                      增强导入
                      <span className="ml-1 text-xs text-muted-foreground">（显示切分预览）</span>
                    </span>
                  </label>
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => resetImportState()}
                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={isImportDisabled()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      <Dialog
        open={versionHistoryItemId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVersionHistoryItemId(null);
            setVersions([]);
            setViewingVersion(null);
          }
        }}
      >
        <DialogContent showCloseButton={false} className="w-[640px] max-w-[640px] max-h-[80vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="h-14 border-b border-border px-5 flex-row items-center justify-between shrink-0 space-y-0">
            <DialogTitle className="text-sm font-semibold text-foreground">版本历史</DialogTitle>
            <button
              onClick={() => { setVersionHistoryItemId(null); setVersions([]); setViewingVersion(null); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-5">
            {viewingVersion ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">v{viewingVersion.version} - {viewingVersion.title}</h4>
                  </div>
                  <button
                    onClick={() => setViewingVersion(null)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    返回列表
                  </button>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 text-sm text-foreground whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
                  {viewingVersion.content}
                </div>
                <div className="flex justify-end mt-4">
                  <button
                    onClick={() => {
                      const v = versions.find(ver => ver.version_number === viewingVersion.version);
                      if (v) handleRollback(v.id);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    回滚到此版本
                  </button>
                </div>
              </div>
            ) : loadingVersions ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : versions.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无版本历史</div>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => handleViewVersion(v.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">v{v.version_number}</span>
                        <span className="text-sm text-foreground truncate">{v.title}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{new Date(v.created_at).toLocaleString('zh-CN')}</span>
                        {v.creator_name && <span>by {v.creator_name}</span>}
                        {v.change_summary && <span className="truncate">{v.change_summary}</span>}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRollback(v.id); }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors ml-2"
                      title="回滚"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Chunks Dialog */}
      <Dialog open={showChunksDialog} onOpenChange={setShowChunksDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              分块内容
              <span className="text-xs font-normal text-muted-foreground ml-1">— {chunksItemName}</span>
            </DialogTitle>
          </DialogHeader>

          {loadingChunks ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">加载中...</span>
              </div>
            </div>
          ) : chunks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mb-2 opacity-30" />
              <p className="text-sm">暂无分块数据</p>
            </div>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <div key={chunk.id} className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {chunk.chunk_index + 1}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {chunk.content.length} 字符
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {escapeHtml(chunk.content)}
                  </p>
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <span className="text-xs text-muted-foreground/60 font-mono">
                      hash: {chunk.content_hash.slice(0, 16)}...
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Batch Category Modal */}
      <Dialog open={showBatchCategoryModal} onOpenChange={setShowBatchCategoryModal}>
        <DialogContent showCloseButton={false} className="w-[420px] max-w-[420px] p-0 gap-0">
          <DialogHeader className="h-12 border-b border-border px-5 flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-semibold text-foreground">批量修改分类</DialogTitle>
            <button
              onClick={() => setShowBatchCategoryModal(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </DialogHeader>
          <div className="p-5 space-y-3">
            <p className="text-xs text-muted-foreground">
              将为 <span className="text-primary font-medium">{selectedIds.size}</span> 个条目设置以下分类（覆盖原有分类）。
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">父分类（可选）</label>
              <select
                value={batchParentCategory}
                onChange={(e) => setBatchParentCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— 不设置父分类 —</option>
                {Array.from(new Set(categoryOptions.map(c => c.parent_category).filter(Boolean))).map((p) => (
                  <option key={p as string} value={p as string}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">子分类（必填）</label>
              <select
                value={batchCategory}
                onChange={(e) => setBatchCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— 请选择子分类 —</option>
                {categoryOptions
                  .filter((c) => !batchParentCategory || c.parent_category === batchParentCategory)
                  .map((c) => (
                    <option key={`${c.parent_category || ''}-${c.category}`} value={c.category}>{c.category} ({c.count})</option>
                  ))}
              </select>
              {batchParentCategory && categoryOptions.filter((c) => c.parent_category === batchParentCategory).length === 0 && (
                <p className="text-xs text-amber-600 mt-1">该父分类下暂无子分类，请先在编辑条目中创建</p>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setShowBatchCategoryModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleBatchUpdateCategory}
                disabled={batchOperating || !batchCategory.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {batchOperating ? '更新中...' : '确认更新'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge Category Modal */}
      <Dialog open={showMergeModal} onOpenChange={setShowMergeModal}>
        <DialogContent showCloseButton={false} className="w-[520px] max-w-[520px] p-0 gap-0">
          <DialogHeader className="h-12 border-b border-border px-5 flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-semibold text-foreground">合并分类</DialogTitle>
            <button
              onClick={() => setShowMergeModal(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </DialogHeader>
          <div className="p-5 space-y-3">
            <div className="rounded-lg bg-amber-100 border border-amber-300 px-3 py-2 text-xs text-amber-800">
              将把所有 <code className="px-1 bg-amber-200/80 rounded">源分类</code> 下的条目迁移到 <code className="px-1 bg-amber-200/80 rounded">目标分类</code>，源分类将不再存在。
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">源分类（待合并）</label>
              <input
                type="text"
                value={mergeFrom}
                onChange={(e) => setMergeFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="如：售后（将被合并掉）"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">目标分类（保留）</label>
              <input
                type="text"
                value={mergeTo}
                onChange={(e) => setMergeTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="如：售后服务"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setShowMergeModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleMergeCategory}
                disabled={batchOperating || !mergeFrom.trim() || !mergeTo.trim() || mergeFrom.trim() === mergeTo.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {batchOperating ? '合并中...' : '确认合并'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Progress Modal */}
      {importJobId && (
        <ImportProgress
          jobId={importJobId}
          onComplete={handleImportComplete}
          onClose={handleImportClose}
        />
      )}

      {/* Quick Replies Dialog */}
      <Dialog open={quickRepliesOpen} onOpenChange={setQuickRepliesOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>话术库管理</DialogTitle>
          </DialogHeader>
          <QuickRepliesPanel className="flex-1 overflow-hidden" />
        </DialogContent>
      </Dialog>

      {/* Image Preview Lightbox */}
      <ImagePreviewDialog
        src={previewImage?.url ?? null}
        title={previewImage?.title}
        alt={previewImage?.title}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}
