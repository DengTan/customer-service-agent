'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Plus, Trash2, Upload, ImageIcon, Ruler, Search, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SizeChartFormModal } from './size-chart-form-modal';
import { apiFetch } from '@/lib/api-fetch';

interface ProductSpec {
  key: string;
  value: string;
}

interface SizeChartRow {
  id: string;
  name: string;
  sku?: string | null;
  chart_type: string;
  status: string;
  hit_count: number;
}

/**
 * Product image upload component with integrated upload + add functionality.
 * Automatically adds the uploaded URL to the images list.
 */
function ProductImageUploader({
  value,
  onUploadComplete,
  disabled,
}: {
  value: string;
  onUploadComplete: (url: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (file: File) => {
    if (disabled || uploading) return;

    // Validate MIME type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('仅支持 JPG/PNG/GIF/WebP 格式的图片');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片大小不能超过 10MB');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'knowledge');

      const res = await apiFetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `上传失败 (HTTP ${res.status})`);
      }

      const data = await res.json();
      if (data.success && data.url) {
        onUploadComplete(data.url);
        toast.success('图片上传成功');
      } else {
        throw new Error(data.message || '上传返回异常');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [disabled, uploading, onUploadComplete]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="url"
          value={value}
          onChange={e => onUploadComplete(e.target.value)}
          placeholder="输入图片URL后自动添加"
          disabled={disabled || uploading}
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onUploadComplete('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
        }}
        className="hidden"
        disabled={disabled || uploading}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        {uploading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            上传中
          </>
        ) : (
          <>
            <Upload className="w-3.5 h-3.5" />
            上传
          </>
        )}
      </button>
    </div>
  );
}

interface ProductFormData {
  id?: string;
  name: string;
  sku: string;
  category: string;
  parent_category?: string;
  brand: string;
  price: string;
  original_price: string;
  specifications: ProductSpec[];
  features: string[];
  description: string;
  usage_instructions: string;
  image_urls: string[];
  tags: string[];
  status: string;
}

interface ProductFormModalProps {
  open: boolean;
  product?: {
    id: string;
    name: string;
    sku: string;
    category: string;
    parent_category?: string | null;
    brand?: string | null;
    price?: number | null;
    original_price?: number | null;
    specifications: ProductSpec[];
    features: string[];
    description?: string | null;
    usage_instructions?: string | null;
    image_urls: string[];
    tags: string[];
    status: string;
  } | null;
  onClose: () => void;
  onSaved: () => void;
  /** Pre-loaded product list for SizeChartFormModal product selector */
  productOptions?: Array<{ id: string; name: string; sku: string }>;
}

const STATUS_OPTIONS = [
  { value: 'on_sale', label: '在售' },
  { value: 'off_sale', label: '已下架' },
  { value: 'discontinued', label: '已停售' },
];

const CATEGORY_OPTIONS = [
  { value: '服装', label: '服装' },
  { value: '女装', label: '女装' },
  { value: '男装', label: '男装' },
  { value: '童装', label: '童装' },
  { value: '鞋类', label: '鞋类' },
  { value: '箱包皮具', label: '箱包皮具' },
  { value: '配饰', label: '配饰' },
  { value: '美妆护肤', label: '美妆护肤' },
  { value: '家居用品', label: '家居用品' },
  { value: '数码电器', label: '数码电器' },
  { value: '食品生鲜', label: '食品生鲜' },
  { value: '母婴用品', label: '母婴用品' },
  { value: '运动户外', label: '运动户外' },
  { value: '其他', label: '其他' },
];

const PARENT_CATEGORY_OPTIONS = [
  { value: 'T恤', label: 'T恤' },
  { value: '衬衫', label: '衬衫' },
  { value: '裤装', label: '裤装' },
  { value: '裙装', label: '裙装' },
  { value: '外套', label: '外套' },
  { value: '卫衣', label: '卫衣' },
  { value: '牛仔', label: '牛仔' },
  { value: '运动服', label: '运动服' },
  { value: '正装', label: '正装' },
  { value: '休闲装', label: '休闲装' },
  { value: '男装', label: '男装' },
  { value: '女装', label: '女装' },
  { value: '皮鞋', label: '皮鞋' },
  { value: '运动鞋', label: '运动鞋' },
  { value: '拖鞋', label: '拖鞋' },
  { value: '箱包', label: '箱包' },
  { value: '背包', label: '背包' },
  { value: '钱包', label: '钱包' },
];

const CHART_TYPE_LABELS: Record<string, string> = {
  clothing: '服装',
  shoes: '鞋类',
  accessories: '配饰',
  custom: '自定义',
};

const CHART_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'clothing', label: '服装' },
  { value: 'shoes', label: '鞋类' },
  { value: 'accessories', label: '配饰' },
  { value: 'custom', label: '自定义' },
];

interface SizeChartSelectorModalProps {
  open: boolean;
  productId: string;
  alreadyAssocIds: string[];
  onClose: () => void;
  onAssociated: () => void;
}

interface SizeChartListItem {
  id: string;
  name: string;
  sku: string | null;
  chart_type: string;
  category: string;
  status: string;
  hit_count: number;
}

function SizeChartSelectorModal({ open, productId, alreadyAssocIds, onClose, onAssociated }: SizeChartSelectorModalProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [charts, setCharts] = useState<SizeChartListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const loadCharts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: '1', page_size: '200', status: 'active' });
      if (typeFilter) params.set('chart_type', typeFilter);
      const res = await apiFetch(`/api/knowledge/size-charts?${params}`);
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setCharts(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    if (open) {
      loadCharts();
      setSearch('');
      setTypeFilter('');
      setSelectedIds(new Set());
      setSaving(false);
    }
  }, [open, loadCharts]);

  const handleConfirm = async () => {
    if (selectedIds.size === 0) return;
    setSaving(true);
    let hasError = false;
    for (const chartId of selectedIds) {
      try {
        const res = await apiFetch('/api/knowledge/size-charts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: chartId, product_id: productId }),
        });
        if (!res.ok) { hasError = true; break; }
      } catch {
        hasError = true;
        break;
      }
    }
    setSaving(false);
    if (hasError) {
      toast.error('部分关联失败，请重试');
    } else {
      toast.success('关联成功');
    }
    onAssociated();
    onClose();
  };

  const filteredCharts = charts.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.sku && c.sku.toLowerCase().includes(q));
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground">选择尺码表</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索名称或SKU"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-2.5 py-1.5 pr-7 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
          >
            {CHART_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-destructive">{error}</p>
              <button onClick={loadCharts} className="mt-2 text-xs text-primary hover:underline">重试</button>
            </div>
          ) : filteredCharts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                {search || typeFilter ? '没有符合条件的尺码表' : '暂无可用尺码表'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredCharts.map(chart => {
                const isAssoc = alreadyAssocIds.includes(chart.id);
                const isSelected = selectedIds.has(chart.id);
                const toggleId = () => {
                  if (isAssoc) return;
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(chart.id)) next.delete(chart.id);
                    else next.add(chart.id);
                    return next;
                  });
                };
                return (
                  <div
                    key={chart.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${isAssoc
                      ? 'border-primary/30 bg-primary/5 opacity-70'
                      : isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    }`}
                    onClick={toggleId}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isAssoc || isSelected
                      ? 'bg-primary border-primary'
                      : 'border-border bg-background'
                    }`}>
                      {(isAssoc || isSelected) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground truncate">{chart.name}</span>
                        {chart.sku && (
                          <span className="text-xs text-muted-foreground truncate">{chart.sku}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {CHART_TYPE_LABELS[chart.chart_type] || chart.chart_type}
                        </span>
                        {chart.category && (
                          <span className="text-xs text-muted-foreground">{chart.category}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${chart.status === 'active'
                        ? 'bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                        {chart.status === 'active' ? '启用' : '禁用'}
                      </span>
                      {isAssoc && (
                        <span className="text-xs text-primary">已关联</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <div className="text-xs text-muted-foreground">
            {selectedIds.size > 0 ? (
              <span className="text-primary font-medium">已选择 {selectedIds.size} 项</span>
            ) : (
              <span>点击选择尺码表</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || selectedIds.size === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              确认关联
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SizeChartSearchAddProps {
  productId: string;
  alreadyAssocIds: string[];
  onAdded: () => void;
}

function SizeChartSearchAdd({ productId, alreadyAssocIds, onAdded }: SizeChartSearchAddProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [charts, setCharts] = useState<SizeChartListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    apiFetch('/api/knowledge/size-charts?page_size=200&status=active')
      .then(r => r.json())
      .then(data => {
        setCharts(data.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = charts.filter(c => {
    if (alreadyAssocIds.includes(c.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.sku && c.sku.toLowerCase().includes(q));
  });

  const handleSelect = async (chartId: string) => {
    const chart = charts.find(c => c.id === chartId);
    if (!chart) return;
    try {
      const res = await apiFetch('/api/knowledge/size-charts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chartId, product_id: productId }),
      });
      if (!res.ok) throw new Error();
      toast.success(`已添加尺码表"${chart.name}"`);
      setOpen(false);
      setSearch('');
      onAdded();
    } catch {
      toast.error('添加失败，请重试');
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="搜索并添加尺码表..."
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-dashed border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
        />
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card rounded-lg border border-border shadow-lg z-50 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {search ? '没有符合条件的尺码表' : '暂无可添加的尺码表'}
            </div>
          ) : (
            <div className="py-1">
              {filtered.map(chart => (
                <button
                  key={chart.id}
                  onClick={() => handleSelect(chart.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <Ruler className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground truncate">{chart.name}</span>
                  {chart.sku && (
                    <span className="text-xs text-muted-foreground shrink-0">{chart.sku}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-[45]" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}

export function ProductFormModal({ open, product, onClose, onSaved, productOptions = [] }: ProductFormModalProps) {
  const isEditing = !!product?.id;

  // 关联尺码表
  const [assocCharts, setAssocCharts] = useState<SizeChartRow[]>([]);
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [showNewChart, setShowNewChart] = useState(false);

  const loadAssocCharts = useCallback(async () => {
    if (!product?.id) return;
    setLoadingCharts(true);
    try {
      // Use findByProductId endpoint (no pagination limit) instead of paginated list API
      const res = await apiFetch(`/api/knowledge/size-charts/by-product/${product.id}`);
      if (res.ok) {
        const data = await res.json();
        setAssocCharts(data.items || []);
      } else {
        // Fallback: use paginated list with large page size
        const fallbackRes = await apiFetch(`/api/knowledge/size-charts?product_id=${product.id}&page_size=1000`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          setAssocCharts(fallbackData.items || []);
        }
      }
    } finally {
      setLoadingCharts(false);
    }
  }, [product?.id]);

  const removeAssoc = useCallback(async (chartId: string) => {
    try {
      const res = await apiFetch('/api/knowledge/size-charts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chartId, product_id: null }),
      });
      if (!res.ok) throw new Error('移除失败');
      toast.success('已移除关联');
      await loadAssocCharts();
    } catch {
      toast.error('移除失败，请重试');
    }
  }, [loadAssocCharts]);

  useEffect(() => {
    if (open && product?.id) loadAssocCharts();
  }, [open, product?.id, loadAssocCharts]);

  const [form, setForm] = useState<ProductFormData>({
    name: '',
    sku: '',
    category: '',
    parent_category: '',
    brand: '',
    price: '',
    original_price: '',
    specifications: [],
    features: [],
    description: '',
    usage_instructions: '',
    image_urls: [],
    tags: [],
    status: 'on_sale',
  });
  const [saving, setSaving] = useState(false);
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecValue, setNewSpecValue] = useState('');
  const [newFeature, setNewFeature] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');

  useEffect(() => {
    if (open) {
      if (product) {
        setForm({
          id: product.id,
          name: product.name,
          sku: product.sku,
          category: product.category || '',
          parent_category: product.parent_category || '',
          brand: product.brand || '',
          price: product.price !== null ? String(product.price) : '',
          original_price: product.original_price !== null ? String(product.original_price) : '',
          specifications: product.specifications || [],
          features: product.features || [],
          description: product.description || '',
          usage_instructions: product.usage_instructions || '',
          image_urls: product.image_urls || [],
          tags: product.tags || [],
          status: product.status,
        });
      } else {
        setForm({
          name: '',
          sku: '',
          category: '',
          parent_category: '',
          brand: '',
          price: '',
          original_price: '',
          specifications: [],
          features: [],
          description: '',
          usage_instructions: '',
          image_urls: [],
          tags: [],
          status: 'on_sale',
        });
      }
      // Reset helpers
      setNewSpecKey('');
      setNewSpecValue('');
      setNewFeature('');
      setNewTag('');
      setNewImageUrl('');
    }
  }, [open, product]);

  const addSpec = () => {
    if (!newSpecKey.trim()) {
      toast.error('请输入规格名称');
      return;
    }
    setForm(f => ({
      ...f,
      specifications: [...f.specifications, { key: newSpecKey.trim(), value: newSpecValue.trim() }],
    }));
    setNewSpecKey('');
    setNewSpecValue('');
    toast.success('已添加规格');
  };

  const removeSpec = (index: number) => {
    setForm(f => ({ ...f, specifications: f.specifications.filter((_, i) => i !== index) }));
  };

  const addFeature = () => {
    if (!newFeature.trim()) {
      toast.error('请输入卖点内容');
      return;
    }
    setForm(f => ({ ...f, features: [...f.features, newFeature.trim()] }));
    setNewFeature('');
    toast.success('已添加卖点');
  };

  const removeFeature = (index: number) => {
    setForm(f => ({ ...f, features: f.features.filter((_, i) => i !== index) }));
  };

  const addTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) {
      toast.error('请输入标签内容');
      return;
    }
    if (form.tags.includes(trimmed)) {
      toast.error('标签已存在');
      return;
    }
    setForm(f => ({ ...f, tags: [...f.tags, trimmed] }));
    setNewTag('');
    toast.success('已添加标签');
  };

  const removeTag = (tag: string) => {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));
  };

  const removeImageUrl = (index: number) => {
    setForm(f => ({ ...f, image_urls: f.image_urls.filter((_, i) => i !== index) }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('请填写商品名称'); return; }
    if (!form.sku.trim()) { toast.error('请填写商品SKU'); return; }
    if (!form.category.trim()) { toast.error('请选择分类'); return; }
    if (!form.price.trim()) { toast.error('请填写售价'); return; }
    if (!form.description.trim()) { toast.error('请填写商品详情'); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        category: form.category.trim() || '未分类',
        parent_category: form.parent_category?.trim() || null,
        brand: form.brand.trim() || null,
        price: form.price ? parseFloat(form.price) : null,
        original_price: form.original_price ? parseFloat(form.original_price) : null,
        specifications: form.specifications,
        features: form.features,
        description: form.description.trim() || null,
        usage_instructions: form.usage_instructions.trim() || null,
        image_urls: form.image_urls,
        tags: form.tags,
        status: form.status,
      };

      let res: Response;
      if (isEditing) {
        res = await apiFetch('/api/knowledge/products', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: product!.id, ...payload }),
        });
      } else {
        res = await apiFetch('/api/knowledge/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '保存失败');
      }

      toast.success(isEditing ? '商品已更新' : '商品已创建');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-base font-semibold text-foreground">
            {isEditing ? '编辑商品' : '新建商品'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* 基础信息 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">基础信息</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">商品名称 <span className="text-destructive">*</span></label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="如：纯棉圆领T恤"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">SKU编号 <span className="text-destructive">*</span></label>
                <input
                  value={form.sku}
                  onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  placeholder="如：SKU-TEE-001"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">品牌</label>
                <input
                  value={form.brand}
                  onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                  placeholder="如：自在服饰"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">分类 <span className="text-red-500">*</span></label>
                <Select
                  value={form.category}
                  onValueChange={(value) => setForm((f) => ({ ...f, category: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">父分类</label>
                <Select
                  value={form.parent_category || '__none__'}
                  onValueChange={(value) => setForm((f) => ({ ...f, parent_category: value === '__none__' ? '' : value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="不设置" />
                  </SelectTrigger>
                  <SelectContent>
                    {PARENT_CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">售价（元） <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="89.00"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">原价（元）</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.original_price}
                  onChange={e => setForm(f => ({ ...f, original_price: e.target.value }))}
                  placeholder="129.00"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {isEditing && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">状态</label>
                  <Select
                    value={form.status}
                    onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* 规格参数 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">规格参数</h3>
            {form.specifications.length > 0 && (
              <div className="space-y-2 mb-3">
                {form.specifications.map((spec, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-1 rounded bg-primary/10 text-primary font-medium min-w-[80px] text-center">{spec.key}</span>
                    <span className="text-muted-foreground">：</span>
                    <span className="flex-1 text-foreground">{spec.value}</span>
                    <button
                      onClick={() => removeSpec(i)}
                      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={newSpecKey}
                onChange={e => setNewSpecKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSpec()}
                placeholder="参数名（如：颜色）"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <input
                value={newSpecValue}
                onChange={e => setNewSpecValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSpec()}
                placeholder="参数值（如：黑色/白色）"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={addSpec}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                添加
              </button>
            </div>
          </div>

          {/* 关联尺码表 */}
          {isEditing && product?.id ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">关联尺码表</h3>
                <button
                  onClick={() => setShowNewChart(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建尺码表
                </button>
              </div>

              {/* Associated chart badges */}
              {loadingCharts ? (
                <p className="text-sm text-muted-foreground py-2 text-center">加载中...</p>
              ) : assocCharts.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-3">
                  {assocCharts.map(chart => (
                    <span
                      key={chart.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                    >
                      <Ruler className="w-3 h-3 shrink-0" />
                      {chart.name}
                      <button
                        onClick={() => removeAssoc(chart.id)}
                        className="ml-0.5 hover:text-destructive/70 rounded-full focus:outline-none"
                        title="移除关联"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2 px-3 rounded-lg bg-muted/30 border border-dashed border-border mb-3">
                  暂无关联尺码表
                </p>
              )}

              {/* Inline searchable add dropdown */}
              <SizeChartSearchAdd
                productId={product.id}
                alreadyAssocIds={assocCharts.map(c => c.id)}
                onAdded={() => { loadAssocCharts(); }}
              />
            </div>
          ) : !isEditing ? (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">关联尺码表</h3>
              <p className="text-sm text-muted-foreground py-3 px-3 rounded-lg bg-muted/30 border border-dashed border-border">
                请先保存商品后再关联尺码表
              </p>
            </div>
          ) : null}

          {/* 卖点 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">产品卖点</h3>
            {form.features.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {form.features.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-success/10 text-success text-xs font-medium">
                    {f}
                    <button onClick={() => removeFeature(i)} className="hover:text-destructive/70">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={newFeature}
                onChange={e => setNewFeature(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addFeature()}
                placeholder="输入卖点后回车"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button onClick={addFeature} className="px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 商品详情 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              商品详情 <span className="text-red-500">*</span>
            </h3>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="详细描述商品的特点、功能、材质等信息..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
          </div>

          {/* 使用说明 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">使用说明</h3>
            <textarea
              value={form.usage_instructions}
              onChange={e => setForm(f => ({ ...f, usage_instructions: e.target.value }))}
              placeholder="使用注意事项、洗涤说明等..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
          </div>

          {/* 商品图片 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">商品图片</h3>
            {form.image_urls.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-3">
                {form.image_urls.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200/png?text=无图'; }}
                    />
                    {/* 遮罩层 - 点击预览大图 */}
                    <button
                      onClick={() => window.open(url, '_blank')}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-full h-full"
                      title="点击查看大图"
                    >
                      <span className="text-white text-xs">点击查看</span>
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={() => removeImageUrl(i)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <ProductImageUploader
                value={newImageUrl}
                onUploadComplete={(url) => {
                  // When URL changes (from upload or manual input), add to list if valid
                  if (url.trim() && (url.startsWith('http://') || url.startsWith('https://'))) {
                    setForm(f => ({ ...f, image_urls: [...f.image_urls, url.trim()] }));
                    setNewImageUrl('');
                  } else {
                    setNewImageUrl(url);
                  }
                }}
                disabled={saving}
              />
            </div>
          </div>

          {/* 标签 */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">标签</h3>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {form.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-destructive/70">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="输入标签后回车"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button onClick={addTag} className="px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? '保存中...' : (isEditing ? '保存修改' : '创建商品')}
          </button>
        </div>

        {/* Selector & creation modals */}
        {showNewChart && (
          <SizeChartFormModal
            open={true}
            defaultProductId={product?.id}
            defaultProductName={product?.name}
            defaultProductSku={product?.sku}
            onClose={() => setShowNewChart(false)}
            onSaved={() => {
              setShowNewChart(false);
              loadAssocCharts();
            }}
            productOptions={productOptions}
          />
        )}
      </div>
    </div>
  );
}
