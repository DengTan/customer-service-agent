'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Upload, Ruler, Eye, Edit3, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ImageUploadInput } from '@/components/common/image-upload-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch } from '@/lib/api-fetch';

interface SizeColumn {
  key: string;
  label: string;
}

interface SizeRow {
  [key: string]: string;
}

interface RecommendDimension {
  key: string;
  label: string;
  unit: string;
  range: [number, number];
  required: boolean;
  options?: string[];
}

const CHART_TYPE_OPTIONS = [
  { value: 'clothing', label: '服装' },
  { value: 'shoes', label: '鞋类' },
  { value: 'accessories', label: '配饰' },
  { value: 'custom', label: '自定义' },
];

const DEFAULT_CLOTHING_DIMENSIONS: RecommendDimension[] = [
  { key: 'height', label: '身高', unit: 'cm', range: [140, 200], required: true },
  { key: 'weight', label: '体重', unit: 'kg', range: [30, 150], required: true },
];

const DEFAULT_SHOES_DIMENSIONS: RecommendDimension[] = [
  { key: 'foot_length', label: '脚长', unit: 'cm', range: [20, 32], required: true },
  { key: 'foot_width', label: '脚宽', unit: 'cm', range: [7, 14], required: false },
];

function normalizeDimensions(dims?: RecommendDimension[] | null): RecommendDimension[] {
  if (!Array.isArray(dims) || dims.length === 0) {
    return [...DEFAULT_CLOTHING_DIMENSIONS];
  }
  return dims.map(d => {
    if (!d.range || !Array.isArray(d.range) || d.range.length < 2) {
      return { ...d, range: [0, 100] as [number, number] };
    }
    return {
      ...d,
      range: [Number(d.range[0]) || 0, Number(d.range[1]) || 100] as [number, number],
    };
  });
}

interface SizeChartFormData {
  name: string;
  chart_type: string;
  category: string;
  product_ids: string[];
  sku: string;
  size_columns: SizeColumn[];
  size_rows: SizeRow[];
  recommend_enabled: boolean;
  recommend_dimensions: RecommendDimension[];
  recommend_rules: string;
  description: string;
  image_url: string;
  status: string;
}

interface SizeChartFormModalProps {
  open: boolean;
  /** Pre-fill product_id and auto-select this product in the dropdown */
  defaultProductId?: string;
  defaultProductName?: string;
  defaultProductSku?: string;
  sizeChart?: {
    id: string;
    name: string;
    chart_type: string;
    category: string;
    product_ids: string[];
    sku: string | null;
    size_columns: SizeColumn[];
    size_rows: SizeRow[];
    recommend_params: { dimensions: RecommendDimension[] } | null;
    recommend_rules: string | null;
    description: string | null;
    image_url: string | null;
    status: string;
  } | null;
  onClose: () => void;
  onSaved: () => void;
  productOptions?: Array<{ id: string; name: string; sku: string }>;
}

export function SizeChartFormModal({
  open,
  defaultProductId,
  defaultProductName,
  defaultProductSku,
  sizeChart,
  onClose,
  onSaved,
  productOptions = [],
}: SizeChartFormModalProps) {
  const isEditing = !!sizeChart?.id;
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productList, setProductList] = useState(productOptions);

  // Product search dropdown state
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<typeof productList>([]);
  const productDropdownRef = useRef<HTMLDivElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<SizeChartFormData>({
    name: '',
    chart_type: 'clothing',
    category: '',
    product_ids: [],
    sku: '',
    size_columns: [
      { key: 'size', label: '尺码' },
      { key: 'bust', label: '胸围(cm)' },
      { key: 'waist', label: '腰围(cm)' },
    ],
    size_rows: [
      { size: 'S', bust: '', waist: '' },
      { size: 'M', bust: '', waist: '' },
      { size: 'L', bust: '', waist: '' },
    ],
    recommend_enabled: true,
    recommend_dimensions: [...DEFAULT_CLOTHING_DIMENSIONS],
    recommend_rules: '',
    description: '',
    image_url: '',
    status: 'active',
  });

  const [newColKey, setNewColKey] = useState('');
  const [newColLabel, setNewColLabel] = useState('');
  const [previewMeasurement, setPreviewMeasurement] = useState({ height: '170', weight: '65' });

  // Load form data when modal opens or sizeChart changes
  useEffect(() => {
    if (!open) return;
    if (sizeChart) {
      setForm({
        name: sizeChart.name,
        chart_type: sizeChart.chart_type || 'clothing',
        category: sizeChart.category || '',
        product_ids: sizeChart.product_ids || [],
        sku: sizeChart.sku || '',
        size_columns: sizeChart.size_columns?.length > 0
          ? sizeChart.size_columns
          : [{ key: 'size', label: '尺码' }, { key: 'bust', label: '胸围(cm)' }],
        size_rows: sizeChart.size_rows?.length > 0
          ? sizeChart.size_rows
          : [{ size: 'S', bust: '', waist: '' }],
        recommend_enabled: true,
        recommend_dimensions: normalizeDimensions(sizeChart.recommend_params?.dimensions),
        recommend_rules: sizeChart.recommend_rules || '',
        description: sizeChart.description || '',
        image_url: sizeChart.image_url || '',
        status: sizeChart.status || 'active',
      });
    } else {
      setForm({
        name: '',
        chart_type: 'clothing',
        category: '',
        product_ids: defaultProductId ? [defaultProductId] : [],
        sku: defaultProductSku || '',
        size_columns: [
          { key: 'size', label: '尺码' },
          { key: 'bust', label: '胸围(cm)' },
          { key: 'waist', label: '腰围(cm)' },
        ],
        size_rows: [
          { size: 'S', bust: '', waist: '' },
          { size: 'M', bust: '', waist: '' },
          { size: 'L', bust: '', waist: '' },
        ],
        recommend_enabled: true,
        recommend_dimensions: [...DEFAULT_CLOTHING_DIMENSIONS],
        recommend_rules: '',
        description: '',
        image_url: '',
        status: 'active',
      });
    }
  }, [open, sizeChart, defaultProductId, defaultProductSku]);

  // Load product list when opening new modal
  useEffect(() => {
    if (!open || productOptions.length > 0) return;
    setLoadingProducts(true);
    apiFetch('/api/knowledge/products?page_size=200')
      .then(res => res.json())
      .then(data => {
        setProductList(data.items?.map((p: { id: string; name: string; sku: string }) => ({
          id: p.id,
          name: p.name,
          sku: p.sku || '',
        })) || []);
      })
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, [open, productOptions.length]);

  // Filter products based on search query (exclude already selected)
  useEffect(() => {
    if (!productSearch.trim()) {
      setFilteredProducts(productList.filter(p => !form.product_ids.includes(p.id)));
    } else {
      const query = productSearch.toLowerCase();
      setFilteredProducts(
        productList.filter(p =>
          !form.product_ids.includes(p.id) &&
          (p.name.toLowerCase().includes(query) ||
          (p.sku && p.sku.toLowerCase().includes(query)))
        )
      );
    }
  }, [productSearch, productList, form.product_ids]);

  // Initialize filtered products when dropdown opens
  useEffect(() => {
    if (showProductDropdown && filteredProducts.length === 0) {
      setFilteredProducts(productList);
    }
  }, [showProductDropdown]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(event.target as Node)) {
        setShowProductDropdown(false);
      }
    };
    if (showProductDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProductDropdown]);

  // Switch default dimensions when chart type changes
  const handleChartTypeChange = (type: string) => {
    setForm(prev => ({
      ...prev,
      chart_type: type,
      recommend_dimensions: type === 'shoes' ? [...DEFAULT_SHOES_DIMENSIONS] : [...DEFAULT_CLOTHING_DIMENSIONS],
      size_columns: type === 'shoes'
        ? [{ key: 'size', label: '尺码' }, { key: 'foot_length', label: '脚长(cm)' }, { key: 'foot_width', label: '脚宽(cm)' }]
        : [{ key: 'size', label: '尺码' }, { key: 'bust', label: '胸围(cm)' }, { key: 'waist', label: '腰围(cm)' }],
      size_rows: type === 'shoes'
        ? [{ size: '35', foot_length: '', foot_width: '' }, { size: '36', foot_length: '', foot_width: '' }, { size: '37', foot_length: '', foot_width: '' }]
        : [{ size: 'S', bust: '', waist: '' }, { size: 'M', bust: '', waist: '' }, { size: 'L', bust: '', waist: '' }],
    }));
  };

  const handleProductChange = (productId: string) => {
    if (!productId || form.product_ids.includes(productId)) {
      setProductSearch('');
      setShowProductDropdown(false);
      return;
    }
    const selected = productList.find(p => p.id === productId);
    setForm(prev => ({
      ...prev,
      product_ids: [...prev.product_ids, productId],
      sku: selected?.sku || prev.sku,
    }));
    setProductSearch('');
    setShowProductDropdown(false);
  };

  const removeProduct = (productId: string) => {
    setForm(prev => ({
      ...prev,
      product_ids: prev.product_ids.filter(id => id !== productId),
    }));
  };

  // Clear all product selections (select "通用尺码表")
  const clearProductSelection = () => {
    setForm(prev => ({
      ...prev,
      product_ids: [],
      sku: '',
    }));
    setProductSearch('');
    setShowProductDropdown(false);
  };

  // Get selected product names for display chips
  const getSelectedProducts = () => {
    return form.product_ids
      .map(id => productList.find(p => p.id === id))
      .filter(Boolean) as typeof productList;
  };

  const addColumn = () => {
    if (!newColKey.trim() || !newColLabel.trim()) {
      toast.error('请填写列标识和列名称');
      return;
    }
    if (form.size_columns.some(c => c.key === newColKey.trim())) {
      toast.error('列标识已存在');
      return;
    }
    setForm(prev => ({
      ...prev,
      size_columns: [...prev.size_columns, { key: newColKey.trim(), label: newColLabel.trim() }],
      size_rows: prev.size_rows.map(row => ({ ...row, [newColKey.trim()]: '' })),
    }));
    setNewColKey('');
    setNewColLabel('');
  };

  const removeColumn = (key: string) => {
    if (key === 'size') {
      toast.error('尺码列为必填列，不能删除');
      return;
    }
    setForm(prev => ({
      ...prev,
      size_columns: prev.size_columns.filter(c => c.key !== key),
      size_rows: prev.size_rows.map(row => {
        const { [key]: _, ...rest } = row;
        return rest;
      }),
    }));
  };

  const addRow = () => {
    const newRow: SizeRow = { size: '' };
    form.size_columns.forEach(c => {
      if (c.key !== 'size') newRow[c.key] = '';
    });
    setForm(prev => ({ ...prev, size_rows: [...prev.size_rows, newRow] }));
  };

  const removeRow = (index: number) => {
    setForm(prev => ({ ...prev, size_rows: prev.size_rows.filter((_, i) => i !== index) }));
  };

  const updateRowCell = (rowIndex: number, key: string, value: string) => {
    setForm(prev => ({
      ...prev,
      size_rows: prev.size_rows.map((row, i) =>
        i === rowIndex ? { ...row, [key]: value } : row,
      ),
    }));
  };

  // Simple recommendation simulation for preview
  const getPreviewRecommendation = () => {
    if (!form.recommend_enabled || form.size_rows.length === 0) return null;
    const h = parseFloat(previewMeasurement.height);
    const w = parseFloat(previewMeasurement.weight);
    if (isNaN(h) || isNaN(w)) return null;

    for (const row of form.size_rows) {
      const bustStr = row['bust'] || '';
      if (bustStr.includes('-')) {
        const [min, max] = bustStr.split('-').map(v => parseFloat(v));
        if (!isNaN(min) && !isNaN(max)) {
          // rough estimate: height maps to size
          const heightSize = h >= 175 ? 'L' : h >= 165 ? 'M' : 'S';
          if (row['size'] === heightSize) {
            return { size: row['size'], reason: `身高${h}cm 体重${w}kg，推荐尺码 ${row['size']}` };
          }
        }
      }
    }
    return { size: form.size_rows[0]?.['size'] || 'M', reason: `根据身高${h}cm体重${w}kg的推荐` };
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('请填写尺码表名称'); return; }
    if (form.size_columns.length === 0) { toast.error('请至少添加一列'); return; }
    if (form.size_rows.length === 0) { toast.error('请至少添加一行尺码数据'); return; }
    if (form.size_rows.some(r => !r['size'])) { toast.error('每行尺码值不能为空'); return; }

    setSaving(true);
    try {
      const payload = {
        ...(isEditing ? { id: sizeChart!.id } : {}),
        name: form.name.trim(),
        chart_type: form.chart_type,
        category: form.category.trim() || '未分类',
        product_ids: form.product_ids.length > 0 ? form.product_ids : null,
        sku: form.sku || null,
        size_columns: form.size_columns,
        size_rows: form.size_rows,
        recommend_params: form.recommend_enabled && form.recommend_dimensions.length > 0
          ? { dimensions: form.recommend_dimensions }
          : null,
        recommend_rules: form.recommend_rules || null,
        description: form.description || null,
        image_url: form.image_url || null,
        status: form.status,
      };

      const res = await apiFetch('/api/knowledge/size-charts', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '保存失败');
      toast.success(isEditing ? '尺码表已更新' : '尺码表已创建');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 'min(900px, 95vw)', height: 'min(80vh, 85vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Ruler className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">
              {isEditing ? '编辑尺码表' : '创建尺码表'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex items-center bg-muted rounded-lg p-0.5 mr-2">
              <button
                onClick={() => setMode('edit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === 'edit' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Edit3 className="w-3 h-3" />编辑
              </button>
              <button
                onClick={() => setMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === 'preview' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Eye className="w-3 h-3" />预览
              </button>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Body */}
        {mode === 'edit' ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">尺码表名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="如：女装T恤尺码表"
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">尺码表类型</label>
                <Select value={form.chart_type} onValueChange={handleChartTypeChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHART_TYPE_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">分类</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  placeholder="如：女装/T恤"
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">关联商品</label>
                <div ref={productDropdownRef} className="relative">
                  {/* Selected chips + search input */}
                  <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-muted border border-border min-h-[42px]">
                    {/* Chips for selected products */}
                    {getSelectedProducts().map(p => (
                      <div
                        key={p.id}
                        className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 border border-primary/20 text-xs"
                      >
                        <span className="text-primary font-medium max-w-[120px] truncate">
                          {p.name}
                          {p.sku && <span className="text-muted-foreground font-normal ml-1">({p.sku})</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeProduct(p.id)}
                          className="flex-shrink-0 w-4 h-4 rounded hover:bg-primary/20 flex items-center justify-center transition-colors"
                        >
                          <X className="w-3 h-3 text-primary/60 hover:text-primary" />
                        </button>
                      </div>
                    ))}
                    {/* Search input */}
                    {form.product_ids.length === 0 && !productSearch && (
                      <div
                        className="flex-1 min-w-[120px] cursor-pointer flex items-center"
                        onClick={() => {
                          setShowProductDropdown(true);
                          setFilteredProducts(productList.filter(p => !form.product_ids.includes(p.id)));
                          productInputRef.current?.focus();
                        }}
                      >
                        <Search className="w-4 h-4 text-muted-foreground/50 mr-2 flex-shrink-0" />
                        <span className="text-sm text-muted-foreground/50">搜索并选择商品...</span>
                      </div>
                    )}
                    {(form.product_ids.length > 0 || productSearch) && (
                      <input
                        ref={productInputRef}
                        type="text"
                        value={productSearch}
                        onChange={e => {
                          setProductSearch(e.target.value);
                          setShowProductDropdown(true);
                          setFilteredProducts(productList.filter(p => !form.product_ids.includes(p.id)));
                        }}
                        onFocus={() => {
                          setShowProductDropdown(true);
                          setFilteredProducts(productList.filter(p => !form.product_ids.includes(p.id)));
                        }}
                        placeholder={form.product_ids.length > 0 ? '继续搜索...' : '搜索商品名称或SKU...'}
                        className="flex-1 min-w-[120px] bg-transparent border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      />
                    )}
                  </div>

                  {/* Dropdown list */}
                  {showProductDropdown && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card rounded-lg border border-border shadow-lg max-h-60 overflow-y-auto">
                      {/* "通用尺码表" option - only show when no products selected */}
                      {form.product_ids.length === 0 && (
                        <div
                          className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted cursor-pointer border-b border-border/50"
                          onClick={() => {
                            clearProductSelection();
                          }}
                        >
                          通用尺码表（无关联）
                        </div>
                      )}
                      {/* Product options */}
                      {filteredProducts.length > 0 ? (
                        filteredProducts.map(p => (
                          <div
                            key={p.id}
                            className="px-3 py-2 cursor-pointer hover:bg-muted transition-colors"
                            onClick={() => {
                              handleProductChange(p.id);
                            }}
                          >
                            <div className="text-sm text-foreground truncate">{p.name}</div>
                            {p.sku && (
                              <div className="text-xs text-muted-foreground">SKU: {p.sku}</div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                          {loadingProducts ? '加载中...' : (productSearch ? '未找到匹配商品' : '暂无可选商品')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {loadingProducts && productList.length === 0 && (
                  <div className="text-xs text-muted-foreground mt-1">加载商品中...</div>
                )}
                <div className="text-xs text-muted-foreground/60 mt-1">
                  可关联多个商品，或留空创建通用尺码表
                </div>
              </div>
            </div>

            {/* Size Columns */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">尺码列定义</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newColKey}
                    onChange={e => setNewColKey(e.target.value)}
                    placeholder="列标识（如 waist）"
                    className="px-2 py-1 rounded bg-muted border-none text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none w-28"
                  />
                  <input
                    type="text"
                    value={newColLabel}
                    onChange={e => setNewColLabel(e.target.value)}
                    placeholder="列名称（如 腰围(cm)）"
                    className="px-2 py-1 rounded bg-muted border-none text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none w-36"
                  />
                  <button
                    onClick={addColumn}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />添加列
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {form.size_columns.map(col => (
                  <div key={col.key} className="flex items-center gap-1.5 bg-muted rounded-md px-2.5 py-1.5 text-xs">
                    <span className="text-muted-foreground/50 font-mono">{col.key}</span>
                    <span className="text-foreground font-medium">{col.label}</span>
                    {col.key === 'size' && <span className="text-primary/50 text-[10px] ml-1">必填</span>}
                    {col.key !== 'size' && (
                      <button
                        onClick={() => removeColumn(col.key)}
                        className="ml-1 text-muted-foreground/40 hover:text-destructive transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Size Rows */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">尺码数据</label>
                <button
                  onClick={addRow}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
                >
                  <Plus className="w-3 h-3" />添加行
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/70">
                      {form.size_columns.map(col => (
                        <th key={col.key} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                          {col.label}
                        </th>
                      ))}
                      <th className="w-10 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.size_rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-border/50 hover:bg-muted/30">
                        {form.size_columns.map(col => (
                          <td key={col.key} className="px-3 py-2">
                            <input
                              type="text"
                              value={row[col.key] || ''}
                              onChange={e => updateRowCell(rowIndex, col.key, e.target.value)}
                              placeholder={col.key === 'size' ? '必填' : '—'}
                              className="w-full bg-transparent border-none text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeRow(rowIndex)}
                            className="text-muted-foreground/40 hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AI Recommendation */}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.recommend_enabled}
                    onChange={e => setForm(p => ({ ...p, recommend_enabled: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded accent-primary"
                  />
                  启用AI尺码推荐
                </label>
              </div>
              {form.recommend_enabled && (
                <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="grid grid-cols-2 gap-3">
                    {form.recommend_dimensions.map(dim => (
                      <div key={dim.key}>
                        <div className="text-xs text-muted-foreground mb-1">
                          {dim.label} {dim.required && <span className="text-primary/50">(必填)</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={dim.range?.[0] ?? 0}
                            onChange={e => setForm(p => ({
                              ...p,
                              recommend_dimensions: p.recommend_dimensions.map(d =>
                                d.key === dim.key ? { ...d, range: [parseFloat(e.target.value) || 0, d.range?.[1] ?? 100] } : d,
                              ),
                            }))}
                            className="flex-1 px-2 py-1 rounded bg-card border-none text-xs text-foreground focus:outline-none"
                            placeholder="最小"
                          />
                          <span className="text-muted-foreground text-xs">—</span>
                          <input
                            type="number"
                            value={dim.range?.[1] ?? 100}
                            onChange={e => setForm(p => ({
                              ...p,
                              recommend_dimensions: p.recommend_dimensions.map(d =>
                                d.key === dim.key ? { ...d, range: [d.range?.[0] ?? 0, parseFloat(e.target.value) || 0] } : d,
                              ),
                            }))}
                            className="flex-1 px-2 py-1 rounded bg-card border-none text-xs text-foreground focus:outline-none"
                            placeholder="最大"
                          />
                          <span className="text-muted-foreground text-xs w-8">{dim.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">推荐规则说明</div>
                    <textarea
                      value={form.recommend_rules}
                      onChange={e => setForm(p => ({ ...p, recommend_rules: e.target.value }))}
                      placeholder="如：偏小一码，建议选大一号"
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-card border-none text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Extra Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">补充说明</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="如：手工测量，存在1-2cm误差"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">尺码表示意图</label>
                <ImageUploadInput
                  value={form.image_url}
                  onChange={(url) => setForm(p => ({ ...p, image_url: url }))}
                  placeholder="上传图片或输入图片URL"
                  preview={true}
                />
              </div>
            </div>
          </div>
        ) : (
          /* Preview Mode */
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="text-xs text-muted-foreground/60 italic">
              预览模式下展示尺码表在 AI 对话中的实际渲染效果（非真实 AI 回复）
            </div>

            {/* Size Table Preview */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">{form.name || '未命名尺码表'}</h3>
              {form.size_rows.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/70">
                        {form.size_columns.map(col => (
                          <th key={col.key} className="px-4 py-2.5 text-center font-semibold text-muted-foreground whitespace-nowrap">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {form.size_rows.map((row, i) => (
                        <tr key={i} className="border-t border-border/50 hover:bg-muted/30">
                          {form.size_columns.map(col => (
                            <td key={col.key} className="px-4 py-2.5 text-center text-foreground">
                              {row[col.key] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground/50 text-center py-8">暂无尺码数据</div>
              )}
              {form.description && (
                <p className="text-xs text-muted-foreground mt-2">* {form.description}</p>
              )}
            </div>

            {/* Recommendation Preview */}
            {form.recommend_enabled && form.size_rows.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">尺码推荐模拟</h3>
                <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">身高 (cm)</label>
                      <input
                        type="number"
                        value={previewMeasurement.height}
                        onChange={e => setPreviewMeasurement(p => ({ ...p, height: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg bg-card border-none text-sm text-foreground focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">体重 (kg)</label>
                      <input
                        type="number"
                        value={previewMeasurement.weight}
                        onChange={e => setPreviewMeasurement(p => ({ ...p, weight: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg bg-card border-none text-sm text-foreground focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="text-center px-4 py-2 rounded-lg bg-primary/10 border border-primary/20">
                    {getPreviewRecommendation() ? (
                      <>
                        <div className="text-2xl font-bold text-primary">{getPreviewRecommendation()!.size}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{getPreviewRecommendation()!.reason}</div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">—</div>
                    )}
                  </div>
                </div>
                {form.recommend_rules && (
                  <p className="text-xs text-muted-foreground italic">推荐规则：{form.recommend_rules}</p>
                )}
              </div>
            )}

            {/* Image Preview */}
            {form.image_url && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">尺码表示意图</h3>
                <img
                  src={form.image_url}
                  alt="尺码表示意图"
                  className="max-w-full rounded-lg border border-border max-h-64 object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border flex-shrink-0 bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? '保存中...' : (isEditing ? '保存修改' : '创建尺码表')}
          </button>
        </div>
      </div>
    </div>
  );
}
