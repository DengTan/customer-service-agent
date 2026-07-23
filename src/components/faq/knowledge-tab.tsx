'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
  Search, Upload, X,
  FileText, Link as LinkIcon, Type, Trash2, Folder,
  FileSpreadsheet, Pencil, Check, History, RotateCcw, ImageIcon,
  File, FileImage, Eye, Archive, ArchiveRestore,
  Merge, ThumbsUp,
  ZoomIn,
  BookOpen,
  PlusCircle,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MultiImageUpload, type UploadedImage } from '@/components/common/multi-image-upload';
import { ImagePreviewDialog } from '@/components/common/image-preview-dialog';
import { Pagination } from '@/components/common/pagination';
import { QuickRepliesPanel } from '@/components/quick-replies/quick-replies-panel';
import { ImportProgress } from './import-progress';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { KnowledgeItemsSkeleton } from './faq-skeletons';
import {
  KnowledgeItem,
  CategoryOption,
  ChunkItem,
  VersionItem,
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
import { cn } from '@/lib/utils';

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatBadge({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-br from-card to-muted/30 border border-border/60 text-xs">
      <span className="text-primary">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}

function CategoryPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border/60',
      )}
    >
      {label}
    </button>
  );
}

function TypeBadge({ type }: { type: string }) {
  const info: Record<string, { label: string; styles: string }> = {
    text: { label: '文本', styles: 'bg-primary/10 text-primary border-primary/20' },
    url: { label: '链接', styles: 'bg-success/10 text-success border-success/20' },
    file: { label: '文件', styles: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50' },
    image: { label: '图片', styles: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-800/50' },
  };
  const i = info[type] || info.text;
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium border ring-1 ring-inset', i.styles)}>
      {i.label}
    </span>
  );
}

function ArchiveBadge({ archived, expired }: { archived: boolean; expired: boolean }) {
  if (archived) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800/50 ring-1 ring-inset">
        <Archive className="w-2.5 h-2.5" />
        已归档
      </span>
    );
  }
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium border border-red-200 dark:border-red-800/50 ring-1 ring-inset">
        <AlertTriangle className="w-2.5 h-2.5" />
        已过期
      </span>
    );
  }
  return null;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function KnowledgeTab() {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ content: string; score: number }>>([]);
  const [searching, setSearching] = useState(false);

  const { confirm } = useConfirmDialog();

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
  const [importImages, setImportImages] = useState<UploadedImage[]>([]);
  const [importMode, setImportMode] = useState<'quick' | 'enhanced'>('quick');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listAbortRef = useRef<AbortController | null>(null);

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

  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  const [showChunksDialog, setShowChunksDialog] = useState(false);
  const [chunksItemId, setChunksItemId] = useState<string | null>(null);
  const [chunksItemName, setChunksItemName] = useState<string>('');
  const [chunks, setChunks] = useState<ChunkItem[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [loadingMoreChunks, setLoadingMoreChunks] = useState(false);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [chunksPage, setChunksPage] = useState(1);
  const CHUNKS_PAGE_SIZE = 20;
  const chunksAbortRef = useRef<AbortController | null>(null);
  const chunksSentinelRef = useRef<HTMLDivElement | null>(null);

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

  // ── Chunk loading (lazy / paged) ──────────────────────────────────────────
  const loadChunks = useCallback(async (itemId: string, page: number, append: boolean) => {
    if (append) setLoadingMoreChunks(true); else setLoadingChunks(true);
    const ac = new AbortController();
    chunksAbortRef.current?.abort();
    chunksAbortRef.current = ac;
    let aborted = false;
    ac.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    try {
      const res = await fetch(`/api/knowledge/items/${itemId}/chunks?page=${page}&limit=${CHUNKS_PAGE_SIZE}`, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const next = (data.chunks || []) as ChunkItem[];
      setChunks(prev => append ? [...prev, ...next] : next);
      setChunksTotal(typeof data.total === 'number' ? data.total : next.length);
      setChunksPage(page);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || aborted) return;
      if (!append) { setChunks([]); setChunksTotal(0); }
      toast.error('加载分块失败');
    } finally {
      // 注意：即使被 abort 也要清 loading 状态，避免 UI 卡在 spinner
      if (append) setLoadingMoreChunks(false); else setLoadingChunks(false);
    }
  }, []);

  useEffect(() => {
    if (!showChunksDialog) {
      chunksAbortRef.current?.abort();
      setChunks([]); setChunksItemId(null); setChunksItemName('');
      setChunksTotal(0); setChunksPage(1);
      return;
    }
    if (!chunksItemId) return;
    setChunks([]); setChunksTotal(0); setChunksPage(1);
    loadChunks(chunksItemId, 1, false);
    return () => chunksAbortRef.current?.abort();
  }, [showChunksDialog, chunksItemId, loadChunks]);

  const hasMoreChunks = chunks.length < chunksTotal;
  const loadMoreChunks = useCallback(() => {
    if (!chunksItemId || loadingMoreChunks || !hasMoreChunks) return;
    loadChunks(chunksItemId, chunksPage + 1, true);
  }, [chunksItemId, loadingMoreChunks, hasMoreChunks, chunksPage, loadChunks]);

  // IntersectionObserver: 滚动到底自动加载更多
  useEffect(() => {
    if (!showChunksDialog) return;
    const el = chunksSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (entry.isIntersecting) loadMoreChunks();
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [showChunksDialog, loadMoreChunks]);

  // ── Load items ─────────────────────────────────────────────────────────────
  const loadKnowledgeItems = useCallback(async (pageArg = page, pageSizeArg = pageSize) => {
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    setLoadingItems(true);
    try {
      const url = new URL('/api/knowledge/items', window.location.origin);
      if (showArchived) url.searchParams.set('only_archived', 'true');
      const trimmedSearch = search.trim();
      if (trimmedSearch) url.searchParams.set('search', trimmedSearch);
      if (itemFilterCat && itemFilterCat !== '全部') url.searchParams.set('category', itemFilterCat);
      url.searchParams.set('page', String(pageArg));
      url.searchParams.set('limit', String(pageSizeArg));
      const res = await fetch(url.toString(), { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (ac.signal.aborted) return;
      setKnowledgeItems(data.items || []);
      setItemCategories(data.categories || {});
      setItemCategoryTree(data.categoryTree || {});
      const nextTotal = typeof data.total === 'number' ? data.total : 0;
      const nextTotalPages = typeof data.totalPages === 'number' ? data.totalPages : 0;
      setTotal(nextTotal);
      setTotalPages(nextTotalPages);
      setPage(typeof data.page === 'number' ? data.page : pageArg);
      if (nextTotalPages > 0 && pageArg > nextTotalPages) {
        const target = Math.max(1, nextTotalPages);
        setPage(target);
        setTimeout(() => loadKnowledgeItems(target, pageSizeArg), 0);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
    } finally {
      if (!ac.signal.aborted) setLoadingItems(false);
    }
  }, [showArchived, search, itemFilterCat, page, pageSize]);

  useEffect(() => () => listAbortRef.current?.abort(), []);

  const reloadCurrentPage = useCallback(() => loadKnowledgeItems(page, pageSize), [loadKnowledgeItems, page, pageSize]);

  const loadCategoryOptions = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge/categories');
      if (!res.ok) return;
      const data = await res.json();
      setCategoryOptions(data.categories || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadCategoryOptions(); }, [loadCategoryOptions]);

  useEffect(() => { setPage(1); }, [showArchived, search, itemFilterCat, pageSize]);

  useEffect(() => {
    const handle = setTimeout(() => { loadKnowledgeItems(1, pageSize); }, 300);
    return () => clearTimeout(handle);
  }, [showArchived, search, itemFilterCat, loadKnowledgeItems, pageSize]);

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/knowledge?query=${encodeURIComponent(search)}&topK=5`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [search]);

  // ── Import ─────────────────────────────────────────────────────────────────
  const getActualCategory = (value: string) =>
    value === '__custom__' ? customCategory : (value === 'none' ? '' : value);
  const getActualParentCategory = (value: string) =>
    value === '__custom__' ? customParentCategory : (value === 'none' ? '' : value);

  const handleImport = async () => {
    setImporting(true);
    const actualParentCategory = getActualParentCategory(importParentCategory);
    const actualCategory = getActualCategory(importCategory);
    try {
      if (importType === 'image') {
        if (importImages.length === 0) { toast.error('请上传至少一张图片'); setImporting(false); return; }
        
        // Check all images have descriptions
        const missingDescriptions = importImages.filter(img => !img.description?.trim());
        if (missingDescriptions.length > 0) {
          toast.error(`请为所有图片填写描述（${missingDescriptions.length} 张图片缺少描述）`);
          setImporting(false);
          return;
        }
        
        // Import all images as ONE knowledge item
        const imageUrls = importImages.map(img => img.url);
        // Combine all descriptions into one content
        const descriptions = importImages
          .map((img, i) => img.description?.trim() ? `[图片${i + 1}] ${img.description.trim()}` : '')
          .filter(Boolean);
        const content = descriptions.length > 0 ? descriptions.join('\n\n') : '';
        
        const body: Record<string, unknown> = { 
          type: 'image', 
          name: importName || `图片组（${imageUrls.length}张）`, 
          image_urls: imageUrls 
        };
        if (content) body.content = content;
        if (actualCategory) body.category = actualCategory;
        if (actualParentCategory) body.parent_category = actualParentCategory;
        
        const res = await fetch('/api/knowledge/import', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(body) 
        });
        
        if (!res.ok) { 
          const e = await res.json().catch(() => ({})); 
          throw new Error(e.message || `HTTP ${res.status}`); 
        }
        const data = await res.json();
        if (data.success) { 
          resetImportState(); loadKnowledgeItems(1, pageSize); 
          toast.success(`成功导入 ${imageUrls.length} 张图片！`); 
        } else {
          toast.error(data.error?.message || data.error || '导入失败');
        }
      } else if (importType === 'file' && importFile) {
        const formData = new FormData();
        formData.append('file', importFile);
        formData.append('name', importName || importFile.name);
        if (actualCategory) formData.append('category', actualCategory);
        if (actualParentCategory) formData.append('parent_category', actualParentCategory);
        const res = await fetch('/api/knowledge/import-jobs', { method: 'POST', body: formData });
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || `HTTP ${res.status}`); }
        const data = await res.json();
        if (data.code === 0 && data.data?.job_id) setImportJobId(data.data.job_id);
        else if (data.success && data.job_id) setImportJobId(data.job_id);
        else throw new Error(data.message || data.error || '创建导入任务失败');
      } else if (importType === 'file' && !importFile) { toast.error('请选择要上传的文件'); setImporting(false); return; }
      else {
        const body: Record<string, string> = { type: importType };
        if (importType === 'text') { body.content = importText; body.name = importName || '导入文本'; }
        else { body.url = importUrl; body.name = importName || '导入网页'; }
        if (actualCategory) body.category = actualCategory;
        if (actualParentCategory) body.parent_category = actualParentCategory;
        const res = await fetch('/api/knowledge/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.success) { resetImportState(); loadKnowledgeItems(1, pageSize); toast.success('资料导入成功！'); }
        else toast.error(data.error?.message || data.error || '导入失败');
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : '导入失败，请重试'); }
    finally { setImporting(false); }
  };

  const handleImportComplete = () => { resetImportState(); loadKnowledgeItems(1, pageSize); };
  const handleImportClose = () => { setImportJobId(null); resetImportState(); };

  const resetImportState = () => {
    setShowImport(false); setImportText(''); setImportUrl(''); setImportName('');
    setImportCategory(''); setImportParentCategory(''); setCustomParentCategory(''); setCustomCategory('');
    setImportFile(null); setImportImages([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isImportDisabled = () => {
    if (importing) return true;
    if (importType === 'text') return !importText.trim();
    if (importType === 'url') return !importUrl.trim();
    if (importType === 'file') return !importFile;
    if (importType === 'image') {
      if (importImages.length === 0) return true;
      // All images must have descriptions
      return !importImages.every(img => img.description?.trim());
    }
    return true;
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const handleDeleteItem = async (id: string) => {
    const confirmed = await confirm({ title: '删除知识库资料', description: '确定要删除这条知识库资料吗？此操作无法撤销。', confirmText: '删除', cancelText: '取消', destructive: true });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/knowledge/items?id=${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('删除失败'); return; }
      toast.success('已删除');
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch { toast.error('删除失败'); }
  };

  const startEdit = (item: KnowledgeItem) => {
    setEditingItemId(item.id); setEditName(item.name); setEditContent(item.content || ''); setEditCategory(item.category || '');
    if (item.expires_at) {
      const d = new Date(item.expires_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      setEditExpiresAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else { setEditExpiresAt(''); }
  };

  const cancelEdit = () => { setEditingItemId(null); setEditName(''); setEditContent(''); setEditCategory(''); setEditExpiresAt(''); };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge/items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: editName, content: editContent, category: editCategory, expires_at: editExpiresAt ? new Date(editExpiresAt).toISOString() : null }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        await fetch('/api/knowledge/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: id, title: editName, content: editContent, change_summary: '编辑更新' }) })
          .then(r => { if (!r.ok) toast.error('版本记录创建失败'); });
        cancelEdit(); reloadCurrentPage(); toast.success('已保存');
      } else toast.error(data.error || '更新失败');
    } catch { toast.error('更新失败，请重试'); }
    finally { setSaving(false); }
  };

  // ── Version history ──────────────────────────────────────────────────────────
  const loadVersionHistory = useCallback(async (itemId: string) => {
    setVersionHistoryItemId(itemId); setLoadingVersions(true);
    try {
      const res = await fetch(`/api/knowledge/versions?item_id=${itemId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVersions(data.versions || []);
    } catch { setVersions([]); }
    finally { setLoadingVersions(false); }
  }, []);

  const handleRollback = async (versionId: string) => {
    const confirmed = await confirm({ title: '回滚到历史版本', description: '确认回滚到此版本？将创建新版本记录。', confirmText: '确认回滚', cancelText: '取消' });
    if (!confirmed) return;
    try {
      const res = await fetch('/api/knowledge/versions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: versionId }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.version) { loadVersionHistory(versionHistoryItemId!); reloadCurrentPage(); setViewingVersion(null); toast.success('已回滚到指定版本'); }
      else toast.error(data.error || '回滚失败');
    } catch { toast.error('回滚失败，请重试'); }
  };

  const handleViewVersion = async (versionId: string) => {
    try {
      const res = await fetch(`/api/knowledge/versions?item_id=${versionHistoryItemId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const v = (data.versions || []).find((ver: { id: string }) => ver.id === versionId);
      if (v) setViewingVersion({ title: v.title, content: v.content, version: v.version_number });
    } catch { /* ignore */ }
  };

  const handleViewChunks = (itemId: string, itemName: string) => { setChunksItemId(itemId); setChunksItemName(itemName); setShowChunksDialog(true); };

  // ── Archive ─────────────────────────────────────────────────────────────────
  const handleArchiveItem = async (id: string) => {
    const confirmed = await confirm({ title: '归档知识库资料', description: '确定要归档这条知识库资料吗？归档后默认不参与检索。', confirmText: '归档', cancelText: '取消' });
    if (!confirmed) return;
    try {
      const res = await fetch('/api/knowledge/items/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!res.ok) { toast.error('归档失败'); return; }
      toast.success('已归档');
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch { toast.error('归档失败'); }
  };

  const handleUnarchiveItem = async (id: string) => {
    try {
      const res = await fetch('/api/knowledge/items/unarchive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!res.ok) { toast.error('恢复失败'); return; }
      toast.success('已恢复');
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch { toast.error('恢复失败'); }
  };

  const handleBatchArchive = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({ title: '批量归档', description: `确认归档已选的 ${selectedIds.size} 条资料？`, confirmText: '确认归档', cancelText: '取消' });
    if (!confirmed) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '批量归档失败'); return; }
      toast.success(`已归档 ${data.count} 条`);
      setSelectedIds(new Set());
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch { toast.error('批量归档失败'); }
    finally { setBatchOperating(false); }
  };

  const handleBatchUnarchive = async () => {
    if (selectedIds.size === 0) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-unarchive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '批量恢复失败'); return; }
      toast.success(`已恢复 ${data.count} 条`);
      setSelectedIds(new Set());
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch { toast.error('批量恢复失败'); }
    finally { setBatchOperating(false); }
  };

  const handleBatchUpdateCategory = async () => {
    if (selectedIds.size === 0) return;
    if (!batchCategory.trim()) { toast.error('请输入新分类'); return; }
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(selectedIds), category: batchCategory.trim(), parent_category: batchParentCategory.trim() || null }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '批量修改分类失败'); return; }
      toast.success(`已修改 ${data.count} 条的分类`);
      setShowBatchCategoryModal(false); setBatchCategory(''); setBatchParentCategory(''); setSelectedIds(new Set());
      reloadCurrentPage(); loadCategoryOptions();
    } catch { toast.error('批量修改分类失败'); }
    finally { setBatchOperating(false); }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({ title: '批量删除', description: `确认删除已选的 ${selectedIds.size} 条资料？此操作无法撤销。`, confirmText: '删除', cancelText: '取消', destructive: true });
    if (!confirmed) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/bulk-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '批量删除失败'); return; }
      toast.success(`已删除 ${data.count} 条`);
      setSelectedIds(new Set());
      await new Promise(resolve => setTimeout(resolve, 200));
      reloadCurrentPage();
    } catch { toast.error('批量删除失败'); }
    finally { setBatchOperating(false); }
  };

  const handleMergeCategory = async () => {
    if (!mergeFrom.trim() || !mergeTo.trim()) { toast.error('请输入源分类与目标分类'); return; }
    if (mergeFrom.trim() === mergeTo.trim()) { toast.error('源分类与目标分类不能相同'); return; }
    const confirmed = await confirm({ title: '合并分类', description: `确认将「${mergeFrom}」下所有条目合并到「${mergeTo}」？此操作不可撤销。`, confirmText: '确认合并', cancelText: '取消', destructive: true });
    if (!confirmed) return;
    setBatchOperating(true);
    try {
      const res = await fetch('/api/knowledge/items/merge-category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: mergeFrom.trim(), to: mergeTo.trim() }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || '合并分类失败'); return; }
      toast.success(`已将 ${data.count} 条从「${mergeFrom}」合并到「${mergeTo}」`);
      setShowMergeModal(false); setMergeFrom(''); setMergeTo('');
      reloadCurrentPage(); loadCategoryOptions();
    } catch { toast.error('合并分类失败'); }
    finally { setBatchOperating(false); }
  };

  // ── Selection ────────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const [selectingAll, setSelectingAll] = useState(false);

  const buildAllIdsUrl = useCallback(() => {
    const url = new URL('/api/knowledge/items/all-ids', window.location.origin);
    if (showArchived) url.searchParams.set('only_archived', 'true');
    if (search.trim()) url.searchParams.set('search', search.trim());
    if (itemFilterCat && itemFilterCat !== '全部') url.searchParams.set('category', itemFilterCat);
    return url.toString();
  }, [showArchived, search, itemFilterCat]);

  const toggleSelectAllVisible = async () => {
    const allSelected = selectedIds.size === total && total > 0;
    if (allSelected) { setSelectedIds(new Set()); return; }
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const res = await fetch(buildAllIdsUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelectedIds(new Set(Array.isArray(data.ids) ? data.ids : []));
    } catch { /* ignore */ }
    finally { setSelectingAll(false); }
  };

  const visibleSelectedCount = useMemo(() => knowledgeItems.filter(i => selectedIds.has(i.id)).length, [knowledgeItems, selectedIds]);
  const allIdsSelected = total > 0 && selectedIds.size === total;
  const selectAllChecked = allIdsSelected || (knowledgeItems.length > 0 && visibleSelectedCount === knowledgeItems.length);
  const selectedItems = knowledgeItems.filter(i => selectedIds.has(i.id));
  const allSelectedArchived = selectedItems.length > 0 && selectedItems.every(i => !!i.archived_at);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const getItemIcon = (type: string, name?: string) => {
    if (type === 'file') {
      const ext = name ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
      if (['.xlsx', '.xls', '.csv'].includes(ext)) return <FileSpreadsheet className="w-4 h-4 text-amber-600" />;
      if (['.pdf'].includes(ext)) return <FileImage className="w-4 h-4 text-red-500" />;
      if (['.docx', '.doc'].includes(ext)) return <File className="w-4 h-4 text-blue-500" />;
      return <FileText className="w-4 h-4 text-amber-600" />;
    }
    if (type === 'url') return <LinkIcon className="w-4 h-4 text-success" />;
    if (type === 'image') return <ImageIcon className="w-4 h-4 text-violet-600" />;
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
    if (type === 'image') return 'bg-violet-500/10';
    return 'bg-primary/10';
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="p-6 space-y-5">

        {/* ── Search + Import bar ─────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 p-3 rounded-xl border border-border/60 bg-muted/20">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索知识库内容..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-8.5 pr-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            {searching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            {searching ? '搜索中' : '搜索'}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/90 text-primary-foreground text-xs font-medium hover:from-primary/95 hover:to-primary/85 active:scale-[0.97] transition-all shadow-sm shadow-primary/20"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            导入资料
          </button>
        </div>

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <StatBadge icon={<FileText className="w-3.5 h-3.5" />} label="条资料" value={<span className="text-primary font-bold">{total}</span>} />
          <StatBadge icon={<Folder className="w-3.5 h-3.5" />} label="个分类" value={<span className="font-bold">{Object.keys(itemCategories).length}</span>} />
          <div className="flex-1" />
          <button
            onClick={() => setShowArchived(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              showArchived
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700'
                : 'bg-muted/60 text-muted-foreground hover:text-foreground border border-transparent hover:border-border/60',
            )}
          >
            <Archive className="w-3.5 h-3.5" />
            {showArchived ? '显示全部' : '已归档资料'}
          </button>
        </div>

        {/* ── Search results ─────────────────────────────────────────── */}
        {searchResults.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-xs font-semibold text-foreground">搜索结果（{searchResults.length} 条）</h3>
            </div>
            {searchResults.map((result, i) => (
              <div key={i} className="p-3 rounded-lg bg-card border border-border/40 text-xs">
                <p className="text-foreground leading-relaxed line-clamp-3">{result.content}</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(result.score * 100).toFixed(0)}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{(result.score * 100).toFixed(0)}% 相关</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Category filter ─────────────────────────────────────────── */}
        {Object.keys(itemCategoryTree).length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
              <Folder className="w-3 h-3" />
              分类：
            </span>
            <CategoryPill active={itemFilterCat === '全部'} label={`全部 (${total})`} onClick={() => setItemFilterCat('全部')} />
            {Object.entries(itemCategoryTree).map(([parentCat, { count, children }]) => (
              <div key={parentCat} className="flex items-center gap-1">
                <CategoryPill active={itemFilterCat === parentCat} label={`${parentCat} (${count})`} onClick={() => setItemFilterCat(parentCat)} />
                {Object.entries(children).map(([childCat, childCount]) => (
                  <CategoryPill key={childCat} active={itemFilterCat === childCat} label={`└ ${childCat} (${childCount})`} onClick={() => setItemFilterCat(childCat)} />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Batch action bar ─────────────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-primary">
                已选 <span className="text-base font-bold">{selectedIds.size}</span> 条
              </span>
              <button onClick={toggleSelectAllVisible} disabled={selectingAll} className="text-[11px] text-primary hover:underline">
                {allIdsSelected ? '取消全选' : selectingAll ? '加载中...' : '全选全部'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {allSelectedArchived ? (
                <button onClick={handleBatchUnarchive} disabled={batchOperating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50">
                  <ArchiveRestore className="w-3 h-3" />批量恢复
                </button>
              ) : (
                <button onClick={handleBatchArchive} disabled={batchOperating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50">
                  <Archive className="w-3 h-3" />批量归档
                </button>
              )}
              <button onClick={() => setShowBatchCategoryModal(true)} disabled={batchOperating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50">
                <Folder className="w-3 h-3" />改分类
              </button>
              <button onClick={handleBatchDelete} disabled={batchOperating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs hover:bg-destructive/20 transition-colors disabled:opacity-50">
                <Trash2 className="w-3 h-3" />删除
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                取消
              </button>
            </div>
          </div>
        )}

        {/* ── Items list ─────────────────────────────────────────────── */}
        <div className="space-y-2.5">
          {/* Select-all row */}
          {(knowledgeItems.length > 0 || total > 0) && (
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={selectAllChecked}
                onChange={toggleSelectAllVisible}
                disabled={selectingAll}
                className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
              />
              <span className="text-[11px] text-muted-foreground">
                {allIdsSelected ? `已选全部 ${total} 条` : selectingAll ? '加载中...' : `当前页 ${visibleSelectedCount}/${total}`}
              </span>
            </div>
          )}

          {loadingItems ? (
            <KnowledgeItemsSkeleton />
          ) : knowledgeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="relative mb-4">
                <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full" />
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/10 flex items-center justify-center">
                  <BookOpen className="w-7 h-7 text-primary/60" />
                </div>
              </div>
              <h3 className="text-base font-semibold text-foreground/80 mb-1.5">暂无知识库资料</h3>
              <p className="text-sm text-muted-foreground max-w-xs mb-4">
                {search.trim() || itemFilterCat !== '全部' ? '没有找到符合条件的条目，请调整筛选条件'
                  : '点击右上角「导入资料」开始添加知识内容'}
              </p>
              {search.trim() || itemFilterCat !== '全部' ? (
                <button onClick={() => { setSearch(''); setItemFilterCat('全部'); }} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />清空筛选
                </button>
              ) : (
                <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 active:scale-[0.97] transition-all shadow-sm shadow-primary/20">
                  <PlusCircle className="w-3.5 h-3.5" />导入资料
                </button>
              )}
            </div>
          ) : (
            knowledgeItems.map((item) => {
              const isArchived = !!item.archived_at;
              const isExpired = !!(item.expires_at && new Date(item.expires_at).getTime() < Date.now());
              const adoptTotal = (item.adopted_count || 0) + (item.rejected_count || 0);
              const adoptRate = adoptTotal > 0 ? (item.adopted_count || 0) / adoptTotal : null;

              return (
                <div
                  key={item.id}
                  className={cn(
                    'group rounded-xl border bg-card transition-all duration-200',
                    isArchived
                      ? 'border-amber-300/60 dark:border-amber-800/40 hover:border-amber-400/80 dark:hover:border-amber-700/60'
                      : selectedIds.has(item.id)
                        ? 'border-primary/40 shadow-sm shadow-primary/5'
                        : 'border-border/60 hover:border-border hover:shadow-sm',
                  )}
                >
                  {/* Edit mode */}
                  {editingItemId === item.id ? (
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">资料名称</label>
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">分类</label>
                        <input type="text" value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                          placeholder="如：产品介绍、技术支持..."
                          className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">失效时间（可选）</label>
                        <input type="datetime-local" value={editExpiresAt} onChange={(e) => {
                          const val = e.target.value;
                          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val) || val === '') setEditExpiresAt(val);
                          else if (/^\d{5,}/.test(val)) setEditExpiresAt(val.replace(/^(\d{4})\d+/, '$1'));
                        }}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
                        {editExpiresAt && (
                          <button onClick={() => setEditExpiresAt('')} className="text-[10px] text-muted-foreground hover:text-foreground mt-1 block">清除失效时间</button>
                        )}
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">内容</label>
                        <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={4}
                          className="w-full resize-none px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">取消</button>
                        <button onClick={() => handleSaveEdit(item.id)} disabled={saving || !editName.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                          <Check className="w-3 h-3" />{saving ? '保存中...' : '保存'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 rounded border-border mt-1 shrink-0 accent-primary cursor-pointer" />
                        {/* Icon/thumbnail */}
                        {item.image_urls && item.image_urls.length > 0 ? (
                          <div className="relative shrink-0 group">
                            <button type="button"
                              onClick={() => setPreviewImage({ url: item.image_urls![0], title: item.name })}
                              className="relative w-12 h-12 rounded-lg overflow-hidden border border-border bg-muted cursor-zoom-in"
                              title="点击预览图片">
                              <Image src={item.image_urls[0]} alt={item.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                loading="lazy"
                                fill
                                sizes="48px" />
                              {item.image_urls.length > 1 && (
                                <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] px-1 rounded-tl">
                                  +{item.image_urls.length - 1}
                                </div>
                              )}
                            </button>
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center">
                              <ZoomIn className="w-4 h-4 text-white drop-shadow" />
                            </div>
                          </div>
                        ) : (
                          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', getItemIconBg(item.type, item.name))}>
                            {getItemIcon(item.type, item.name)}
                          </div>
                        )}
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              <span className={cn('text-sm font-semibold truncate', isArchived ? 'text-muted-foreground' : 'text-foreground')}>{item.name}</span>
                              <TypeBadge type={item.type} />
                              {item.category && item.category !== '未分类' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium">
                                  <Folder className="w-2.5 h-2.5" />{item.category}
                                </span>
                              )}
                              <ArchiveBadge archived={isArchived} expired={!isArchived && isExpired} />
                            </div>
                            {/* Actions */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              {isArchived ? (
                                <button onClick={() => handleUnarchiveItem(item.id)} className="w-7 h-7 rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-center text-muted-foreground hover:text-amber-600 transition-colors" title="恢复">
                                  <ArchiveRestore className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button onClick={() => handleArchiveItem(item.id)} className="w-7 h-7 rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-center text-muted-foreground hover:text-amber-600 transition-colors" title="归档">
                                  <Archive className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button onClick={() => startEdit(item)} className="w-7 h-7 rounded-md hover:bg-primary/10 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors" title="编辑">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => loadVersionHistory(item.id)} className="w-7 h-7 rounded-md hover:bg-primary/10 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors" title="版本历史">
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteItem(item.id)} className="w-7 h-7 rounded-md hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="删除">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {/* Content preview */}
                          {item.content && (
                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{item.content}</p>
                          )}
                          {/* Meta row */}
                          <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px] text-muted-foreground/60">
                            <span>{new Date(item.created_at).toLocaleDateString('zh-CN')}</span>
                            {item.chunk_count > 0 && (
                              <button onClick={() => handleViewChunks(item.id, item.name)} className="inline-flex items-center gap-1 text-primary/80 hover:text-primary hover:underline" title="查看分块">
                                <FileText className="w-3 h-3" />{item.chunk_count} 个分块
                              </button>
                            )}
                            {(item.hit_count ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1" title={`被引用 ${item.hit_count} 次`}>
                                <Eye className="w-3 h-3" />{item.hit_count} 次引用
                              </span>
                            )}
                            {item.image_urls && item.image_urls.length > 0 && (
                              <button type="button" onClick={() => setPreviewImage({ url: item.image_urls![0], title: item.name })} className="inline-flex items-center gap-1 text-primary/70 hover:text-primary hover:underline cursor-zoom-in">
                                <ImageIcon className="w-3 h-3" />查看{item.image_urls.length > 1 ? `${item.image_urls.length}张` : '图片'}
                              </button>
                            )}
                            {item.expires_at && !isExpired && (
                              <span className="inline-flex items-center gap-1 text-amber-600">
                                <AlertTriangle className="w-3 h-3" />失效：{new Date(item.expires_at).toLocaleDateString('zh-CN')}
                              </span>
                            )}
                            {adoptRate !== null && (
                              <span className={cn(
                                'inline-flex items-center gap-1',
                                adoptRate >= 0.7 ? 'text-emerald-600' : adoptRate >= 0.4 ? 'text-amber-600' : 'text-red-600'
                              )} title={`采纳 ${item.adopted_count || 0} / 拒绝 ${item.rejected_count || 0}`}>
                                <ThumbsUp className="w-3 h-3" />采纳率 {(adoptRate * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Pagination */}
          {totalPages > 0 && (
            <div className="pt-3">
              <Pagination
                page={page} totalPages={totalPages} total={total} pageSize={pageSize}
                onPageChange={(p) => { setPage(p); loadKnowledgeItems(p, pageSize); }}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); loadKnowledgeItems(1, size); }}
                disabled={loadingItems}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Import Modal ────────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => resetImportState()} />
          <div className="relative bg-card rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border/60"
            style={{ width: 'min(560px, 95vw)', maxHeight: '88vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 flex-shrink-0 bg-gradient-to-r from-primary/4 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/20">
                  <Upload className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">导入资料</h2>
                  <p className="text-[11px] text-muted-foreground">支持文本、链接、文件和图片</p>
                </div>
              </div>
              <button onClick={resetImportState} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Type tabs */}
              <div className="flex gap-1 bg-muted/60 rounded-xl p-1 ring-1 ring-border/40">
                {([
                  { value: 'text', label: '文本', icon: <Type className="w-3.5 h-3.5" /> },
                  { value: 'url', label: '链接', icon: <LinkIcon className="w-3.5 h-3.5" /> },
                  { value: 'file', label: '文件', icon: <FileSpreadsheet className="w-3.5 h-3.5" /> },
                  { value: 'image', label: '图片', icon: <ImageIcon className="w-3.5 h-3.5" /> },
                ] as const).map(tab => (
                  <button key={tab.value}
                    onClick={() => setImportType(tab.value)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
                      importType === tab.value
                        ? 'bg-card text-foreground shadow-sm ring-1 ring-border/60'
                        : 'text-muted-foreground hover:text-foreground',
                    )}>
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Name */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">资料名称</label>
                <input type="text" value={importName} onChange={(e) => setImportName(e.target.value)}
                  placeholder={importType === 'file' ? '不填则使用文件名' : '输入资料名称'}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
              </div>
              {/* Categories */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">父分类（可选）</label>
                  <Select value={importParentCategory || 'none'} onValueChange={(val) => {
                    if (val === '__custom__') setImportParentCategory('__custom__');
                    else if (val === 'none') { setImportParentCategory(''); setImportCategory(''); }
                    else setImportParentCategory(val);
                  }}>
                    <SelectTrigger className="w-full h-9 bg-background border border-border/60 text-xs"><SelectValue placeholder="不设置" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不设置</SelectItem>
                      {CATEGORIES.filter(c => c !== '未分类').map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      <SelectItem value="__custom__">+ 自定义...</SelectItem>
                    </SelectContent>
                  </Select>
                  {importParentCategory === '__custom__' && (
                    <input type="text" value={customParentCategory} onChange={(e) => setCustomParentCategory(e.target.value)}
                      placeholder="输入名称" className="mt-1.5 w-full px-3 py-1.5 rounded-lg bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  )}
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">子分类（可选）</label>
                  <Select value={importCategory || 'none'} onValueChange={(val) => {
                    if (val === '__custom__') setImportCategory('__custom__');
                    else if (val === 'none') setImportCategory('');
                    else setImportCategory(val);
                  }}>
                    <SelectTrigger className="w-full h-9 bg-background border border-border/60 text-xs"><SelectValue placeholder="不设置" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不设置</SelectItem>
                      {CATEGORIES.filter(c => c !== '未分类').map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      <SelectItem value="__custom__">+ 自定义...</SelectItem>
                    </SelectContent>
                  </Select>
                  {importCategory === '__custom__' && (
                    <input type="text" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="输入名称" className="mt-1.5 w-full px-3 py-1.5 rounded-lg bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  )}
                </div>
              </div>
              {/* Content area */}
              {importType === 'text' ? (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">文本内容</label>
                  <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="粘贴文本内容..."
                    rows={6} className="w-full resize-none px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
                </div>
              ) : importType === 'url' ? (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">网页地址</label>
                  <input type="url" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://example.com/article"
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors" />
                </div>
              ) : importType === 'image' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">
                      上传图片（支持批量）
                    </label>
                    <MultiImageUpload
                      images={importImages}
                      onChange={setImportImages}
                      maxImages={20}
                      maxSizeMB={10}
                      purpose="knowledge"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">选择文件</label>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.md,.txt,.jpg,.jpeg,.png,.gif,.webp"
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)} className="hidden" id="file-upload" />
                    <label htmlFor="file-upload"
                      className="flex items-center justify-center gap-2 w-full py-8 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors">
                      <Upload className="w-5 h-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">点击选择文件，或拖放到此处</span>
                    </label>
                    <p className="text-[10px] text-muted-foreground/60 mt-1.5">支持 {FILE_EXTENSIONS_LABEL}，最大 20MB</p>
                  </div>
                  {importFile && (
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/40 border border-border/40">
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', getItemIconBg('file', importFile.name))}>
                        {getItemIcon('file', importFile.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{importFile.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatFileSize(importFile.size)}</p>
                      </div>
                      <button onClick={() => { setImportFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {importFile && (
                    <div className="p-3 rounded-lg bg-muted/40 border border-dashed border-border/60">
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-muted-foreground">
                        <input type="radio" name="importMode" value="quick" checked={importMode === 'quick'} onChange={() => setImportMode('quick')} className="accent-primary" />
                        快速导入
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-muted-foreground mt-1">
                        <input type="radio" name="importMode" value="enhanced" checked={importMode === 'enhanced'} onChange={() => setImportMode('enhanced')} className="accent-primary" />
                        增强导入 <span className="text-[10px] text-muted-foreground/60">（显示切分预览）</span>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/60 flex-shrink-0 bg-gradient-to-r from-muted/30 to-transparent">
              <button onClick={resetImportState} className="px-4 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">取消</button>
              <button onClick={handleImport} disabled={isImportDisabled()}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/90 text-primary-foreground text-xs font-medium hover:from-primary/95 hover:to-primary/85 active:scale-[0.97] transition-all disabled:opacity-50 shadow-md shadow-primary/20">
                <Upload className="w-3.5 h-3.5" />{importing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version History Modal ──────────────────────────────────────── */}
      <Dialog open={versionHistoryItemId !== null} onOpenChange={(open) => { if (!open) { setVersionHistoryItemId(null); setVersions([]); setViewingVersion(null); } }}>
        <DialogContent showCloseButton={false} className="w-[640px] max-w-[95vw] max-h-[80vh] p-0 gap-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 flex-shrink-0 bg-gradient-to-r from-primary/4 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/20">
                <History className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">版本历史</h3>
                <p className="text-[11px] text-muted-foreground">查看并回滚到历史版本</p>
              </div>
            </div>
            <button onClick={() => { setVersionHistoryItemId(null); setVersions([]); setViewingVersion(null); }}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {viewingVersion ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded mr-2">v{viewingVersion.version}</span>
                    <span className="text-sm font-medium text-foreground">{viewingVersion.title}</span>
                  </div>
                  <button onClick={() => setViewingVersion(null)} className="text-[11px] text-muted-foreground hover:text-foreground">返回列表</button>
                </div>
                <div className="p-4 rounded-xl bg-muted/40 border border-border/40 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-[40vh] overflow-y-auto">
                  {viewingVersion.content}
                </div>
                <div className="flex justify-end">
                  <button onClick={() => { const v = versions.find(ver => ver.version_number === viewingVersion.version); if (v) handleRollback(v.id); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                    <RotateCcw className="w-3 h-3" />回滚到此版本
                  </button>
                </div>
              </div>
            ) : loadingVersions ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">暂无版本历史</div>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.id}
                    onClick={() => handleViewVersion(v.id)}
                    className="flex items-center justify-between p-3 rounded-xl border border-border/40 hover:bg-muted/30 hover:border-border/60 transition-colors cursor-pointer group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">v{v.version_number}</span>
                        <span className="text-xs font-medium text-foreground truncate">{v.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{new Date(v.created_at).toLocaleString('zh-CN')}</span>
                        {v.creator_name && <span>by {v.creator_name}</span>}
                        {v.change_summary && <span className="truncate">{v.change_summary}</span>}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleRollback(v.id); }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100" title="回滚">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Chunks Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showChunksDialog} onOpenChange={setShowChunksDialog}>
        <DialogContent showCloseButton={false} className="max-w-2xl max-h-[80vh] overflow-hidden p-0 gap-0 flex flex-col">
          <DialogHeader className="px-6 py-4 border-b border-border/60 flex-shrink-0 bg-gradient-to-r from-primary/4 to-transparent">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-primary" />
              </div>
              分块内容
              <span className="text-xs font-normal text-muted-foreground ml-1">— {chunksItemName}</span>
              {chunksTotal > 0 && (
                <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                  已加载 {chunks.length} / {chunksTotal}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-5">
            {loadingChunks ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : chunks.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">暂无分块数据</div>
            ) : (
              <div className="space-y-3">
                {chunks.map((chunk) => (
                  <div key={chunk.id} className="p-4 rounded-xl bg-muted/40 border border-border/40">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                        {chunk.chunk_index + 1}
                      </div>
                      <span className="text-[11px] text-muted-foreground">{chunk.content.length} 字符</span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto">{chunk.content_hash.slice(0, 12)}...</span>
                    </div>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{escapeHtml(chunk.content)}</p>
                  </div>
                ))}
                {/* 滚动哨兵 + 加载更多 */}
                <div ref={chunksSentinelRef} className="h-px" aria-hidden />
                {loadingMoreChunks && (
                  <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                    <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin mr-2" />
                    加载中…
                  </div>
                )}
                {!hasMoreChunks && chunks.length > 0 && (
                  <div className="text-center py-3 text-[11px] text-muted-foreground/60">
                    已加载全部 {chunksTotal} 个分块
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Batch Category Modal ─────────────────────────────────────────── */}
      <Dialog open={showBatchCategoryModal} onOpenChange={setShowBatchCategoryModal}>
        <DialogContent showCloseButton={false} className="w-[420px] max-w-[95vw] p-0 gap-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-gradient-to-r from-primary/4 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/20">
                <Folder className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">批量修改分类</h3>
                <p className="text-[11px] text-muted-foreground">为 <span className="text-primary font-semibold">{selectedIds.size}</span> 个条目设置分类</p>
              </div>
            </div>
            <button onClick={() => setShowBatchCategoryModal(false)} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">父分类（可选）</label>
              <select value={batchParentCategory} onChange={(e) => setBatchParentCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">— 不设置父分类 —</option>
                {Array.from(new Set(categoryOptions.map(c => c.parent_category).filter(Boolean))).map((p) => <option key={p as string} value={p as string}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">子分类（必填）</label>
              <select value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="">— 请选择子分类 —</option>
                {categoryOptions.filter((c) => !batchParentCategory || c.parent_category === batchParentCategory)
                  .map((c) => <option key={`${c.parent_category || ''}-${c.category}`} value={c.category}>{c.category} ({c.count})</option>)}
              </select>
              {batchParentCategory && categoryOptions.filter((c) => c.parent_category === batchParentCategory).length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">该父分类下暂无子分类</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowBatchCategoryModal(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors">取消</button>
              <button onClick={handleBatchUpdateCategory} disabled={batchOperating || !batchCategory.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">确认更新</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Merge Category Modal ─────────────────────────────────────────── */}
      <Dialog open={showMergeModal} onOpenChange={setShowMergeModal}>
        <DialogContent showCloseButton={false} className="w-[520px] max-w-[95vw] p-0 gap-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-gradient-to-r from-primary/4 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/20">
                <Merge className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">合并分类</h3>
                <p className="text-[11px] text-muted-foreground">将两个分类合并为一个</p>
              </div>
            </div>
            <button onClick={() => setShowMergeModal(false)} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              所有源分类下的条目将迁移到目标分类，源分类将不再存在。
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">源分类（待合并）</label>
              <input type="text" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} placeholder="将被合并掉的分类"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">目标分类（保留）</label>
              <input type="text" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} placeholder="保留的分类"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border/60 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowMergeModal(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors">取消</button>
              <button onClick={handleMergeCategory} disabled={batchOperating || !mergeFrom.trim() || !mergeTo.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">确认合并</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import Progress Modal ─────────────────────────────────────────── */}
      {importJobId && (
        <ImportProgress jobId={importJobId} onComplete={handleImportComplete} onClose={handleImportClose} />
      )}

      {/* ── Quick Replies Dialog ───────────────────────────────────────────── */}
      <Dialog open={quickRepliesOpen} onOpenChange={setQuickRepliesOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">话术库管理</DialogTitle>
          </DialogHeader>
          <QuickRepliesPanel className="flex-1 overflow-hidden" />
        </DialogContent>
      </Dialog>

      {/* ── Image Preview ─────────────────────────────────────────────────── */}
      <ImagePreviewDialog src={previewImage?.url ?? null} title={previewImage?.title} alt={previewImage?.title} onClose={() => setPreviewImage(null)} />
    </>
  );
}