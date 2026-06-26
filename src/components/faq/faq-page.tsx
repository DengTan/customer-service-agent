'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  Search, Upload, X,
  FileText, Link as LinkIcon, Type, Trash2, Folder,
  FileSpreadsheet, Pencil, Check, History, RotateCcw, ImageIcon,
  File, FileImage, Eye, Archive, ArchiveRestore, ChevronDown, Merge, ThumbsUp, ThumbsDown,
  GraduationCap, Scan, Inbox, CheckCircle, XCircle, Target,
  ChevronLeft, ChevronRight,
  Plus, Package, PackageX, TrendingUp, ArrowDownCircle, ArrowUpCircle,
  StickyNote, Ruler, Image as ImageLucide,
} from 'lucide-react';
import { ImageUploadInput } from '@/components/common/image-upload-input';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { ImportProgress } from './import-progress';
import { ProductFormModal } from './product-form-modal';
import { SizeChartFormModal } from './size-chart-form-modal';
import { QuickRepliesPanel } from '@/components/quick-replies/quick-replies-panel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type TabType = 'knowledge' | 'learning' | 'products' | 'size_charts';

interface KnowledgeItem {
  id: string;
  name: string;
  type: string;
  content: string | null;
  category: string;
  chunk_count: number;
  hit_count: number;
  last_hit_at: string | null;
  image_url: string | null;
  adopted_count?: number;
  rejected_count?: number;
  archived_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface CategoryOption {
  category: string;
  parent_category: string | null;
  count: number;
}

const FILE_TYPE_MAP: Record<string, string> = {
  text: '文本',
  url: 'URL',
  file: '文件',
  image: '图片',
};

const FILE_EXTENSIONS_LABEL = '.xlsx、.xls、.csv、.pdf、.docx、.doc、.md、.txt、.jpg、.jpeg、.png、.gif、.webp';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function FaqPage() {
  return (
    <ErrorBoundary>
      <FaqPageInner />
    </ErrorBoundary>
  );
}

function FaqPageInner() {
  // Tab switch
  const [activeTab, setActiveTab] = useState<TabType>('knowledge');

  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importType, setImportType] = useState<'text' | 'url' | 'file' | 'image'>('text');
  const [importText, setImportText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importName, setImportName] = useState('');
  const [importCategory, setImportCategory] = useState('');
  const [importParentCategory, setImportParentCategory] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importImageUrl, setImportImageUrl] = useState('');
  const [importDescription, setImportDescription] = useState('');
  const [importMode, setImportMode] = useState<'quick' | 'enhanced'>('quick');
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ content: string; score: number }>>([]);
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Knowledge items
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [itemCategories, setItemCategories] = useState<Record<string, number>>({});
  const [itemCategoryTree, setItemCategoryTree] = useState<Record<string, { count: number; children: Record<string, number> }>>({});
  const [itemFilterCat, setItemFilterCat] = useState('全部');
  const [loadingItems, setLoadingItems] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [versionHistoryItemId, setVersionHistoryItemId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Array<{
    id: string; version_number: number; title: string; change_summary: string | null;
    created_at: string; creator_name: string | null;
  }>>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<{ title: string; content: string; version: number } | null>(null);
  const [editExpiresAt, setEditExpiresAt] = useState<string>('');

  // 批量操作 / 归档 / 合并分类
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

  // ============================
  // 商品详情相关状态
  // ============================
  interface ProductItem {
    id: string;
    name: string;
    sku: string;
    category: string;
    parent_category: string | null;
    brand: string | null;
    price: number | null;
    original_price: number | null;
    specifications: Array<{ key: string; value: string }>;
    features: string[];
    description: string | null;
    usage_instructions: string | null;
    image_urls: string[];
    status: string;
    tags: string[];
    hit_count: number;
    last_hit_at: string | null;
    sync_source: string;
    created_at: string;
    updated_at: string | null;
  }

  const [productList, setProductList] = useState<ProductItem[]>([]);
  const [productCategories, setProductCategories] = useState<Record<string, number>>({});
  const [productStatuses, setProductStatuses] = useState<Record<string, number>>({});
  const [productTotal, setProductTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productFilterCat, setProductFilterCat] = useState('');
  const [productFilterStatus, setProductFilterStatus] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [showBatchStatusModal, setShowBatchStatusModal] = useState(false);
  const [showBatchCategoryModalProduct, setShowBatchCategoryModalProduct] = useState(false);
  const [batchProductStatus, setBatchProductStatus] = useState('off_sale');
  const [batchProductCategory, setBatchProductCategory] = useState('');
  const [batchOperatingProduct, setBatchOperatingProduct] = useState(false);

  // Derived state
  const productStats = useMemo(() => ({
    onSale: productList.filter(p => p.status === 'on_sale').length,
    offSale: productList.filter(p => p.status === 'off_sale').length,
    hitCount: productList.reduce((sum, p) => sum + (p.hit_count || 0), 0),
  }), [productList]);

  const productCategoryOptions = useMemo(() => Object.keys(productCategories), [productCategories]);

  const filteredProducts = useMemo(() => {
    let items = productList;
    if (productSearch) {
      const q = productSearch.toLowerCase();
      items = items.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q))
      );
    }
    if (productFilterCat) items = items.filter(p => p.category === productFilterCat);
    if (productFilterStatus) items = items.filter(p => p.status === productFilterStatus);
    return items;
  }, [productList, productSearch, productFilterCat, productFilterStatus]);

  const productModalOpen = showProductForm;
  const handleCloseProductModal = () => { setShowProductForm(false); setEditingProduct(null); };
  const handleProductSaved = () => { fetchProducts(); handleCloseProductModal(); };
  const handleEditProduct = (product: ProductItem) => {
    setEditingProduct(product);
    setShowProductForm(true);
  };
  const handleToggleProductStatus = async (product: ProductItem) => {
    const newStatus = product.status === 'on_sale' ? 'off_sale' : 'on_sale';
    try {
      const res = await fetch('/api/knowledge/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`商品已${newStatus === 'on_sale' ? '上架' : '下架'}`);
      fetchProducts();
    } catch {
      toast.error('状态更新失败');
    }
  };

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams();
      if (productSearch) params.set('search', productSearch);
      if (productFilterCat) params.set('category', productFilterCat);
      if (productFilterStatus) params.set('status', productFilterStatus);

      const res = await fetch(`/api/knowledge/products?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProductList(data.items || []);
      setProductCategories(data.categories || {});
      setProductStatuses(data.statuses || {});
      setProductTotal(data.total || 0);
    } catch {
      toast.error('获取商品列表失败');
    } finally {
      setLoadingProducts(false);
    }
  }, [productSearch, productFilterCat, productFilterStatus]);

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('确定要删除该商品吗？')) return;
    try {
      const res = await fetch(`/api/knowledge/products?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '删除失败');
      toast.success('商品已删除');
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleBatchStatus = async () => {
    if (selectedProductIds.size === 0) { toast.error('请先选择商品'); return; }
    setBatchOperatingProduct(true);
    try {
      const res = await fetch('/api/knowledge/products/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedProductIds], action: 'update_status', status: batchProductStatus }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '批量更新失败');
      toast.success(`已更新 ${selectedProductIds.size} 个商品的状态`);
      setSelectedProductIds(new Set());
      setShowBatchStatusModal(false);
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量更新失败');
    } finally {
      setBatchOperatingProduct(false);
    }
  };

  const handleBatchCategory = async () => {
    if (selectedProductIds.size === 0) { toast.error('请先选择商品'); return; }
    if (!batchProductCategory.trim()) { toast.error('请填写分类'); return; }
    setBatchOperatingProduct(true);
    try {
      const res = await fetch('/api/knowledge/products/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedProductIds], action: 'update_category', category: batchProductCategory }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '批量更新失败');
      toast.success(`已更新 ${selectedProductIds.size} 个商品的分类`);
      setSelectedProductIds(new Set());
      setShowBatchCategoryModalProduct(false);
      fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量更新失败');
    } finally {
      setBatchOperatingProduct(false);
    }
  };

  // ============================
  // 尺码表相关状态
  // ============================
  interface SizeChartItem {
    id: string;
    name: string;
    chart_type: string;
    category: string;
    sku: string | null;
    product_id: string | null;
    size_columns: Array<{ key: string; label: string }>;
    size_rows: Array<Record<string, string>>;
    recommend_params: { dimensions: Array<{ key: string; label: string; unit: string; range: [number, number]; required: boolean }> } | null;
    recommend_rules: string | null;
    description: string | null;
    image_url: string | null;
    status: string;
    hit_count: number;
    created_at: string;
  }

  const [sizeCharts, setSizeCharts] = useState<SizeChartItem[]>([]);
  const [sizeChartTotal, setSizeChartTotal] = useState(0);
  const [loadingSizeCharts, setLoadingSizeCharts] = useState(false);
  const [sizeChartSearch, setSizeChartSearch] = useState('');
  const [sizeChartFilterType, setSizeChartFilterType] = useState('');
  const [sizeChartFilterStatus, setSizeChartFilterStatus] = useState('');
  const [sizeChartTypes, setSizeChartTypes] = useState<Record<string, number>>({});
  const [showSizeChartModal, setShowSizeChartModal] = useState(false);
  const [editingSizeChart, setEditingSizeChart] = useState<SizeChartItem | null>(null);

  const fetchSizeCharts = useCallback(async () => {
    setLoadingSizeCharts(true);
    try {
      const params = new URLSearchParams();
      if (sizeChartSearch) params.set('search', sizeChartSearch);
      if (sizeChartFilterType) params.set('chart_type', sizeChartFilterType);
      if (sizeChartFilterStatus) params.set('status', sizeChartFilterStatus);
      const res = await fetch(`/api/knowledge/size-charts?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSizeCharts(data.items || []);
      setSizeChartTotal(data.total || 0);
      setSizeChartTypes(data.chartTypes || {});
    } catch {
      toast.error('获取尺码表列表失败');
    } finally {
      setLoadingSizeCharts(false);
    }
  }, [sizeChartSearch, sizeChartFilterType, sizeChartFilterStatus]);

  const handleDeleteSizeChart = async (id: string) => {
    if (!confirm('确定要删除该尺码表吗？')) return;
    try {
      const res = await fetch(`/api/knowledge/size-charts?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '删除失败');
      toast.success('尺码表已删除');
      fetchSizeCharts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleSizeChartStatus = async (chart: SizeChartItem) => {
    const newStatus = chart.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch('/api/knowledge/size-charts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chart.id, status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`尺码表已${newStatus === 'active' ? '启用' : '禁用'}`);
      fetchSizeCharts();
    } catch {
      toast.error('状态更新失败');
    }
  };

  // ============================
  // 知识自学习相关状态
  // ============================
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
  const [editModal, setEditModal] = useState<{
    open: boolean;
    item: LearningItem | null;
    question: string;
    answer: string;
    category: string;
  }>({ open: false, item: null, question: '', answer: '', category: '' });
  const [lastScanTime, setLastScanTime] = useState<string>('');

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
      console.error('Failed to fetch learning items:', err);
      toast.error('加载知识学习队列失败，请重试');
    } finally {
      setLoadingLearning(false);
    }
  }, [filterStatus, filterConfidence, searchQuery, learningPage, learningPageSize]);

  // 单独获取 stats（用于 Tab 标签红点显示）
  const fetchLearningStats = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge-learning?pageSize=1');
      if (!res.ok) return;
      const data = await res.json();
      if (data.stats) {
        setLearningStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch learning stats:', err);
    }
  }, []);

  useEffect(() => {
    // 页面加载时获取各 Tab 的统计数据
    fetchLearningStats();
  }, [fetchLearningStats]);

  useEffect(() => {
    if (activeTab === 'learning') {
      fetchLearningItems();
    }
    if (activeTab === 'products') {
      fetchProducts();
    }
    if (activeTab === 'size_charts') {
      fetchSizeCharts();
    }
  }, [activeTab, fetchLearningItems, fetchProducts, fetchSizeCharts]);

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
      console.error('Scan failed:', err);
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
      console.error('Approve failed:', err);
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
      console.error('Reject failed:', err);
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
      console.error('Batch approve failed:', err);
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
      console.error('Batch reject failed:', err);
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
      console.error('Edit & approve failed:', err);
      toast.error('编辑审核失败，请重试');
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

  const loadKnowledgeItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const url = new URL('/api/knowledge/items', window.location.origin);
      if (showArchived) url.searchParams.set('include_archived', 'true');
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKnowledgeItems(data.items || []);
      setItemCategories(data.categories || {});
      setItemCategoryTree(data.categoryTree || {});
    } catch {
      // ignore
    } finally {
      setLoadingItems(false);
    }
  }, [showArchived]);

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
    loadKnowledgeItems();
    loadCategoryOptions();
  }, [loadKnowledgeItems, loadCategoryOptions]);

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

  const handleImport = async () => {
    setImporting(true);
    try {
      if (importType === 'image') {
        // 图片导入 - 上传图片 + 可选描述
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
        if (importCategory) body.category = importCategory;
        if (importParentCategory) body.parent_category = importParentCategory;
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
          loadKnowledgeItems();
          toast.success('图片导入成功！');
        } else {
          toast.error(data.error?.message || data.error || '导入失败');
        }
      } else if (importType === 'file' && importFile) {
        // 文件导入 - 使用增强模式
        const formData = new FormData();
        formData.append('file', importFile);
        formData.append('name', importName || importFile.name);
        if (importCategory) formData.append('category', importCategory);
        if (importParentCategory) formData.append('parent_category', importParentCategory);
        if (importImageUrl.trim()) formData.append('image_url', importImageUrl.trim());
        if (importDescription.trim()) formData.append('description', importDescription.trim());

        // 使用增强导入 API
        const res = await fetch('/api/knowledge/import-jobs', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.code === 0 && data.data.job_id) {
          // 增强模式 - 显示进度弹窗
          setImportJobId(data.data.job_id);
        } else {
          throw new Error(data.message || '创建导入任务失败');
        }
      } else if (importType === 'file' && !importFile) {
        alert('请选择要上传的文件');
        setImporting(false);
        return;
      } else {
        // 文本/URL 导入 - 使用快速模式
        const body: Record<string, string> = { type: importType };
        if (importType === 'text') {
          body.content = importText;
          body.name = importName || '导入文本';
        } else {
          body.url = importUrl;
          body.name = importName || '导入网页';
        }
        if (importCategory) body.category = importCategory;
        if (importParentCategory) body.parent_category = importParentCategory;
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
          loadKnowledgeItems();
          alert('资料导入成功！');
        } else {
          alert(data.error?.message || data.error || '导入失败');
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  const handleImportComplete = (knowledgeItemId: string) => {
    resetImportState();
    loadKnowledgeItems();
    alert(`导入成功！知识条目 ID: ${knowledgeItemId}`);
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
    setImportFile(null);
    setImportImageUrl('');
    setImportDescription('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('确定要删除这条知识库资料吗？')) return;
    try {
      const res = await fetch(`/api/knowledge/items?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('删除失败');
        return;
      }
      loadKnowledgeItems();
    } catch {
      // ignore
    }
  };

  const startEdit = (item: KnowledgeItem) => {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditContent(item.content || '');
    setEditCategory(item.category || '');
    // expires_at: 取本地 datetime-local 需要的格式 (yyyy-MM-ddTHH:mm)
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
        // Also create a version record
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
        loadKnowledgeItems();
        toast.success('已保存');
      } else {
        alert(data.error || '更新失败');
      }
    } catch {
      alert('更新失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const isImportDisabled = () => {
    if (importing) return true;
    if (importType === 'text') return !importText.trim();
    if (importType === 'url') return !importUrl.trim();
    if (importType === 'file') return !importFile;
    if (importType === 'image') return !importImageUrl.trim();
    return true;
  };

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
    if (!confirm('确认回滚到此版本？将创建新版本记录。')) return;
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
        loadKnowledgeItems();
        setViewingVersion(null);
      } else {
        alert(data.error || '回滚失败');
      }
    } catch {
      alert('回滚失败，请重试');
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

  // ============================================================
  // 生命周期：归档/恢复（单条 + 批量）
  // ============================================================
  const handleArchiveItem = async (id: string) => {
    if (!confirm('确定要归档这条知识库资料吗？归档后默认不参与检索。')) return;
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
      loadKnowledgeItems();
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
      loadKnowledgeItems();
    } catch {
      toast.error('恢复失败');
    }
  };

  const handleBatchArchive = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确认归档已选的 ${selectedIds.size} 条资料？`)) return;
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
      loadKnowledgeItems();
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
      loadKnowledgeItems();
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
      loadKnowledgeItems();
      loadCategoryOptions();
    } catch {
      toast.error('批量修改分类失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确认删除已选的 ${selectedIds.size} 条资料？此操作会软删除，可在数据库恢复。`)) return;
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
      loadKnowledgeItems();
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
    if (!confirm(`确认将「${mergeFrom}」下所有条目合并到「${mergeTo}」？此操作不可撤销。`)) return;
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
      loadKnowledgeItems();
      loadCategoryOptions();
    } catch {
      toast.error('合并分类失败');
    } finally {
      setBatchOperating(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      const visible = filteredItems.map(i => i.id);
      const allSelected = visible.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visible.forEach(id => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      visible.forEach(id => next.add(id));
      return next;
    });
  };

  // 过滤后的 items + 选中状态
  const filteredItems = knowledgeItems.filter(
    (item) => {
      if (itemFilterCat === '全部') return true;
      // Match by category or parent_category (for hierarchical filtering)
      return item.category === itemFilterCat || (item as { parent_category?: string }).parent_category === itemFilterCat;
    }
  );
  const visibleSelectedCount = useMemo(
    () => filteredItems.filter(i => selectedIds.has(i.id)).length,
    [filteredItems, selectedIds]
  );
  const allVisibleSelected = filteredItems.length > 0 && visibleSelectedCount === filteredItems.length;
  const selectedItems = knowledgeItems.filter(i => selectedIds.has(i.id));
  const hasArchivedSelected = selectedItems.some(i => !!i.archived_at);
  const allSelectedArchived = selectedItems.length > 0 && selectedItems.every(i => !!i.archived_at);


  const getItemIcon = (type: string, name?: string) => {
    if (type === 'file') {
      const ext = name ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
      if (['.xlsx', '.xls', '.csv'].includes(ext)) return <FileSpreadsheet className="w-4 h-4 text-amber-600" />;
      if (['.pdf'].includes(ext)) return <FileImage className="w-4 h-4 text-red-500" />;
      if (['.docx', '.doc'].includes(ext)) return <File className="w-4 h-4 text-blue-500" />;
      return <FileText className="w-4 h-4 text-amber-600" />;
    }
    if (type === 'url') return <LinkIcon className="w-4 h-4 text-success" />;
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
    return 'bg-primary/10';
  };

  return (
    <ErrorBoundary>
    <div className="h-full flex flex-col page-transition">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="text-base font-semibold text-foreground">知识库</h1>
          {/* Tab switch */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'knowledge'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              知识库
            </button>
            <button
              onClick={() => setActiveTab('learning')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'learning'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <GraduationCap className="w-3 h-3" />
              知识自学习
              {learningStats.pendingCount > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-warning text-[10px] font-bold text-white">
                  {learningStats.pendingCount > 99 ? '99+' : learningStats.pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'products'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>商品详情</span>
            </button>
            <button
              onClick={() => setActiveTab('size_charts')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'size_charts'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Ruler className="w-3 h-3" />
              尺码配置
              {sizeChartTotal > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                  {sizeChartTotal > 99 ? '99+' : sizeChartTotal}
                </span>
              )}
            </button>
          </div>
        </div>
        {activeTab === 'knowledge' && (
        <div className="flex items-center gap-2">
          {/* Quick Replies Button */}
          <button
            onClick={() => setQuickRepliesOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
          >
            <StickyNote className="w-4 h-4" />
            话术库
          </button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border"
            />
            显示已归档
          </label>
          <button
            onClick={() => setShowMergeModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
            title="合并分类"
          >
            <Merge className="w-3.5 h-3.5" />
            合并分类
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all duration-200"
          >
            <Upload className="w-4 h-4" />
            导入资料
          </button>
        </div>
        )}
        {activeTab === 'learning' && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all duration-200 disabled:opacity-50"
          >
            <Scan className="w-4 h-4" />
            {scanning ? '扫描中...' : '扫描对话'}
          </button>
          {lastScanTime && (
            <span className="text-xs text-muted-foreground">上次扫描：{lastScanTime}</span>
          )}
        </div>
        )}
        {activeTab === 'products' && (
        <div className="flex items-center gap-2">
          {selectedProductIds.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">已选 {selectedProductIds.size} 个</span>
              <button
                onClick={() => { setBatchProductStatus('off_sale'); setShowBatchStatusModal(true); }}
                className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
              >
                批量下架
              </button>
              <button
                onClick={() => setShowBatchCategoryModalProduct(true)}
                className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
              >
                批量修改分类
              </button>
            </>
          )}
          <button
            onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            新建商品
          </button>
        </div>
        )}
        {activeTab === 'size_charts' && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingSizeChart(null); setShowSizeChartModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            添加尺码表
          </button>
        </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'learning' && (
          /* ============================
             知识自学习 Tab
             ============================ */
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
                    <div
                      key={item.id}
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
                      <a
                        href={item.conversation_id ? `/history?conv=${item.conversation_id}` : '#'}
                        className="text-sm text-primary hover:underline truncate"
                      >
                        {item.conversation_title || '未知对话'}
                      </a>
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
        )}
        {activeTab === 'knowledge' && (
          /* ============================
             知识库 Tab
             ============================ */
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
              {knowledgeItems.length} 条资料
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Folder className="w-4 h-4" />
              {Object.keys(itemCategories).length} 个分类
            </div>
          </div>
        </div>

        {/* Category filter - hierarchical */}
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
              全部 ({knowledgeItems.length})
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50"
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
                批量恢复
              </button>
            ) : (
              <button
                onClick={handleBatchArchive}
                disabled={batchOperating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50"
              >
                <Archive className="w-3.5 h-3.5" />
                批量归档
              </button>
            )}
            <button
              onClick={() => setShowBatchCategoryModal(true)}
              disabled={batchOperating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50"
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
          {filteredItems.length > 0 && (
            <div className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="w-3.5 h-3.5 rounded border-border"
                aria-label="全选当前可见条目"
              />
              <span className="text-xs text-muted-foreground">
                全选 {allVisibleSelected ? '（已选全部）' : `（${visibleSelectedCount}/${filteredItems.length}）`}
              </span>
            </div>
          )}
          {loadingItems ? (
            <div className="text-center py-12 text-sm text-muted-foreground">加载中...</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16">
              <Folder className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground mb-1">暂无知识库资料</p>
              <p className="text-xs text-muted-foreground/60">点击右上角「导入资料」开始添加</p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isArchived = !!item.archived_at;
              const isExpired = !!(item.expires_at && new Date(item.expires_at).getTime() < Date.now());
              const adoptTotal = (item.adopted_count || 0) + (item.rejected_count || 0);
              const adoptRate = adoptTotal > 0 ? (item.adopted_count || 0) / adoptTotal : null;
              return (
              <div key={item.id} className={`border rounded-xl bg-card p-4 card-hover-lift ${isArchived ? 'border-amber-300/60 bg-amber-50/30' : 'border-border'} ${selectedIds.has(item.id) ? 'ring-2 ring-primary/30' : ''}`}>
                {editingItemId === item.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">名称</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">分类</label>
                      <input
                        type="text"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="如：产品介绍、技术支持..."
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">失效时间（可选，到期后从检索中隐藏）</label>
                      <input
                        type="datetime-local"
                        value={editExpiresAt}
                        onChange={(e) => setEditExpiresAt(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                        className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${getItemIconBg(item.type, item.name)}`}>
                        {getItemIcon(item.type, item.name)}
                      </div>
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
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">
                              已归档
                            </span>
                          )}
                          {!isArchived && isExpired && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 shrink-0">
                              已过期
                            </span>
                          )}
                        </div>
                        {item.content && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{item.content}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/60 flex-wrap">
                          <span>{new Date(item.created_at).toLocaleDateString('zh-CN')}</span>
                          {item.chunk_count > 0 && <span>{item.chunk_count} 个分块</span>}
                          {(item.hit_count ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1" title={`被引用 ${item.hit_count} 次${item.last_hit_at ? `，最近 ${new Date(item.last_hit_at).toLocaleDateString('zh-CN')}` : ''}`}>
                              <Eye className="w-3 h-3" />
                              {item.hit_count} 次引用
                            </span>
                          )}
                          {item.image_url && (
                            <span className="inline-flex items-center gap-1 text-primary/70">
                              <ImageIcon className="w-3 h-3" />
                              含图片
                            </span>
                          )}
                          {item.expires_at && !isExpired && (
                            <span className="inline-flex items-center gap-1 text-amber-600/80">
                              失效：{new Date(item.expires_at).toLocaleDateString('zh-CN')}
                            </span>
                          )}
                          {adoptRate !== null && (
                            <span
                              className={`inline-flex items-center gap-1 ${adoptRate >= 0.7 ? 'text-emerald-600/80' : adoptRate >= 0.4 ? 'text-amber-600/80' : 'text-rose-600/80'}`}
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
        </div>
          </>
        )}

        {/* ============================
           商品详情 Tab
           ============================ */}
        {activeTab === 'products' && (
          <div className="p-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-card rounded-lg shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">在售商品</span>
                  <div className="w-8 h-8 rounded-md bg-green-500/10 flex items-center justify-center">
                    <Package className="w-4 h-4 text-green-500" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-foreground">{productStats.onSale}</div>
              </div>
              <div className="bg-card rounded-lg shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">已下架</span>
                  <div className="w-8 h-8 rounded-md bg-amber-500/10 flex items-center justify-center">
                    <PackageX className="w-4 h-4 text-amber-500" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-foreground">{productStats.offSale}</div>
              </div>
              <div className="bg-card rounded-lg shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">本周AI引用</span>
                  <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-primary">{productStats.hitCount}</div>
              </div>
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="搜索商品名称或SKU..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <select
                value={productFilterCat}
                onChange={(e) => setProductFilterCat(e.target.value)}
                className="px-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">全部分类</option>
                {productCategoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <select
                value={productFilterStatus}
                onChange={(e) => setProductFilterStatus(e.target.value)}
                className="px-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">全部状态</option>
                <option value="on_sale">在售</option>
                <option value="off_sale">已下架</option>
                <option value="discontinued">停售</option>
              </select>
            </div>

            {/* Product list */}
            {loadingProducts ? (
              <div className="text-center py-16 text-sm text-muted-foreground">加载中...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-16">
                <Package className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-1">暂无商品</p>
                <p className="text-xs text-muted-foreground/60">点击右上角「添加商品」开始录入</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-card rounded-lg shadow-card p-4 flex items-start gap-4 hover:shadow-md transition-shadow"
                  >
                    {/* Thumbnail */}
                    <div className="w-16 h-16 rounded-lg bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {product.image_urls && product.image_urls.length > 0 ? (
                        <img
                          src={product.image_urls[0]}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="w-6 h-6 text-muted-foreground/30" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-foreground truncate">{product.name}</h3>
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                          product.status === 'on_sale'
                            ? 'bg-green-500/10 text-green-600'
                            : product.status === 'off_sale'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {product.status === 'on_sale' ? '在售' : product.status === 'off_sale' ? '已下架' : '停售'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1">
                        {product.sku && <span>SKU: {product.sku}</span>}
                        {product.brand && <span>品牌: {product.brand}</span>}
                        {product.category && <span>分类: {product.category}</span>}
                      </div>
                      {product.specifications && product.specifications.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {product.specifications.slice(0, 3).map((spec, i) => (
                            <span key={i} className="inline-block mr-2">{spec.key}: {spec.value}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-xs">
                        {product.price != null && (
                          <span className="font-semibold text-foreground">¥{product.price.toFixed(2)}</span>
                        )}
                        {product.original_price != null && product.original_price > 0 && (
                          <span className="text-muted-foreground line-through">¥{product.original_price.toFixed(2)}</span>
                        )}
                        {product.hit_count > 0 && (
                          <span className="text-muted-foreground">引用 {product.hit_count} 次</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEditProduct(product)}
                        className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleProductStatus(product)}
                        className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
                        title={product.status === 'on_sale' ? '下架' : '上架'}
                      >
                        {product.status === 'on_sale' ? (
                          <ArrowDownCircle className="w-3.5 h-3.5 text-amber-500 hover:text-amber-600" />
                        ) : (
                          <ArrowUpCircle className="w-3.5 h-3.5 text-green-500 hover:text-green-600" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(product.id)}
                        className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'size_charts' && (
          <div className="p-6">
            {/* Filter bar */}
            <div className="flex items-center gap-3 mb-6">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="搜索尺码表名称..."
                  value={sizeChartSearch}
                  onChange={e => setSizeChartSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <select
                value={sizeChartFilterType}
                onChange={e => setSizeChartFilterType(e.target.value)}
                className="px-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">全部类型</option>
                <option value="clothing">服装</option>
                <option value="shoes">鞋类</option>
                <option value="accessories">配饰</option>
                <option value="custom">自定义</option>
              </select>
              <select
                value={sizeChartFilterStatus}
                onChange={e => setSizeChartFilterStatus(e.target.value)}
                className="px-3 py-2 rounded-lg bg-card border border-border/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">全部状态</option>
                <option value="active">启用中</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>

            {/* Size chart list */}
            {loadingSizeCharts ? (
              <div className="text-center py-16 text-sm text-muted-foreground">加载中...</div>
            ) : sizeCharts.length === 0 ? (
              <div className="text-center py-16">
                <Ruler className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-1">暂无尺码表</p>
                <p className="text-xs text-muted-foreground/60">点击右上角「添加尺码表」开始配置</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sizeCharts.map(chart => (
                  <div
                    key={chart.id}
                    className="bg-card rounded-lg shadow-card p-4 flex items-start gap-4 hover:shadow-md transition-shadow"
                  >
                    {/* Icon */}
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex-shrink-0 flex items-center justify-center">
                      <Ruler className="w-5 h-5 text-primary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-foreground truncate">{chart.name}</h3>
                        <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                          chart.chart_type === 'clothing' ? 'bg-blue-500/10 text-blue-600' :
                          chart.chart_type === 'shoes' ? 'bg-amber-500/10 text-amber-600' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {chart.chart_type === 'clothing' ? '服装' :
                           chart.chart_type === 'shoes' ? '鞋类' :
                           chart.chart_type === 'accessories' ? '配饰' : '自定义'}
                        </span>
                        {chart.status === 'disabled' && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">
                            已禁用
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                        {chart.category && <span>分类: {chart.category}</span>}
                        {chart.sku && <span>SKU: {chart.sku}</span>}
                        <span>{chart.size_rows.length} 个尺码</span>
                      </div>
                      {/* Size preview mini-table */}
                      {chart.size_rows.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {chart.size_rows.slice(0, 5).map((row, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                              <span className="font-medium text-foreground">{row['size'] || '-'}</span>
                              {Object.entries(row).filter(([k]) => k !== 'size').slice(0, 1).map(([k, v]) => (
                                <span key={k}>: {v}</span>
                              ))}
                            </span>
                          ))}
                          {chart.size_rows.length > 5 && (
                            <span className="text-xs text-muted-foreground/50">+{chart.size_rows.length - 5}</span>
                          )}
                        </div>
                      )}
                      {chart.hit_count > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">AI引用 {chart.hit_count} 次</div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setEditingSizeChart(chart); setShowSizeChartModal(true); }}
                        className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleSizeChartStatus(chart)}
                        className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
                        title={chart.status === 'active' ? '禁用' : '启用'}
                      >
                        {chart.status === 'active' ? (
                          <ArrowDownCircle className="w-3.5 h-3.5 text-amber-500 hover:text-amber-600" />
                        ) : (
                          <ArrowUpCircle className="w-3.5 h-3.5 text-green-500 hover:text-green-600" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteSizeChart(chart.id)}
                        className="w-8 h-8 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Edit Modal for Learning */}
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
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                保存并入库
              </button>
            </div>
          </div>
        </div>
      )}

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
                <ImageLucide className="w-4 h-4" />
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

            {/* Category */}
            <div className="mb-3">
              <label className="text-sm font-medium text-foreground mb-1 block">父分类（可选）</label>
              <input
                type="text"
                value={importParentCategory}
                onChange={(e) => setImportParentCategory(e.target.value)}
                placeholder="如：售后、物流、支付..."
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Sub Category */}
            <div className="mb-3">
              <label className="text-sm font-medium text-foreground mb-1 block">子分类（可选）</label>
              <input
                type="text"
                value={importCategory}
                onChange={(e) => setImportCategory(e.target.value)}
                placeholder="如：退换货、配送时效..."
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
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

            {/* Image URL field - available for non-image import types */}
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

            {/* Import Mode Selection (only for file upload) */}
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
      {versionHistoryItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[640px] max-h-[80vh] bg-card rounded-xl border border-border shadow-lg flex flex-col">
            <div className="h-14 border-b border-border px-5 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-semibold text-foreground">版本历史</h3>
              <button
                onClick={() => { setVersionHistoryItemId(null); setVersions([]); setViewingVersion(null); }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

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
          </div>
        </div>
      )}

      {/* Batch Category Modal */}
      {showBatchCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[420px] bg-card rounded-xl border border-border shadow-lg">
            <div className="h-12 border-b border-border px-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">批量修改分类</h3>
              <button
                onClick={() => setShowBatchCategoryModal(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-muted-foreground">
                将为 <span className="text-primary font-medium">{selectedIds.size}</span> 个条目设置以下分类（覆盖原有分类）。
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">父分类（可选）</label>
                <input
                  type="text"
                  value={batchParentCategory}
                  onChange={(e) => setBatchParentCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="如：售后服务 / 产品介绍"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">子分类（必填）</label>
                <input
                  type="text"
                  value={batchCategory}
                  onChange={(e) => setBatchCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="如：退换货政策 / 退货流程"
                />
              </div>              <div className="flex gap-2 justify-end pt-1">
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
          </div>
        </div>
      )}

      {/* Merge Category Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[520px] bg-card rounded-xl border border-border shadow-lg">
            <div className="h-12 border-b border-border px-5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">合并分类</h3>
              <button
                onClick={() => setShowMergeModal(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2 text-xs text-amber-800">
                将把所有 <code className="px-1 bg-amber-100/60 rounded">源分类</code> 下的条目迁移到 <code className="px-1 bg-amber-100/60 rounded">目标分类</code>，源分类将不再存在。
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
          </div>
        </div>
      )}

      {/* Import Progress Modal */}
      {importJobId && (
        <ImportProgress
          jobId={importJobId}
          onComplete={handleImportComplete}
          onClose={handleImportClose}
        />
      )}
      {/* Product Form Modal */}
      <ProductFormModal
        open={showProductForm}
        onClose={handleCloseProductModal}
        onSaved={handleProductSaved}
        product={editingProduct}
      />
      {/* Size Chart Form Modal */}
      <SizeChartFormModal
        open={showSizeChartModal}
        sizeChart={editingSizeChart}
        onClose={() => { setShowSizeChartModal(false); setEditingSizeChart(null); }}
        onSaved={() => { setShowSizeChartModal(false); setEditingSizeChart(null); fetchSizeCharts(); }}
      />
      {/* Quick Replies Dialog */}
      <Dialog open={quickRepliesOpen} onOpenChange={setQuickRepliesOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>话术库管理</DialogTitle>
          </DialogHeader>
          <QuickRepliesPanel className="flex-1 overflow-hidden" />
        </DialogContent>
      </Dialog>
    </div>
    </ErrorBoundary>
  );
}
