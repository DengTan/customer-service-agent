'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, Upload, ImageIcon, Ruler, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { ImageUploadInput } from '@/components/common/image-upload-input';

interface ProductSpec {
  key: string;
  value: string;
}

interface SizeChartRow {
  id: string;
  name: string;
  chart_type: string;
  status: string;
  hit_count: number;
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
}

const STATUS_OPTIONS = [
  { value: 'on_sale', label: '在售' },
  { value: 'off_sale', label: '已下架' },
  { value: 'discontinued', label: '已停售' },
];

const CHART_TYPE_LABELS: Record<string, string> = {
  clothing: '服装',
  shoes: '鞋类',
  accessories: '配饰',
  custom: '自定义',
};

export function ProductFormModal({ open, product, onClose, onSaved }: ProductFormModalProps) {
  const isEditing = !!product?.id;

  // 关联尺码表
  const [assocCharts, setAssocCharts] = useState<SizeChartRow[]>([]);
  const [loadingCharts, setLoadingCharts] = useState(false);

  const loadAssocCharts = useCallback(async () => {
    if (!product?.id) return;
    setLoadingCharts(true);
    try {
      const res = await fetch(`/api/knowledge/size-charts?product_id=${product.id}`);
      if (res.ok) {
        const data = await res.json();
        setAssocCharts(data.items || []);
      }
    } finally {
      setLoadingCharts(false);
    }
  }, [product?.id]);

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
    if (!newSpecKey.trim()) return;
    setForm(f => ({
      ...f,
      specifications: [...f.specifications, { key: newSpecKey.trim(), value: newSpecValue.trim() }],
    }));
    setNewSpecKey('');
    setNewSpecValue('');
  };

  const removeSpec = (index: number) => {
    setForm(f => ({ ...f, specifications: f.specifications.filter((_, i) => i !== index) }));
  };

  const addFeature = () => {
    if (!newFeature.trim()) return;
    setForm(f => ({ ...f, features: [...f.features, newFeature.trim()] }));
    setNewFeature('');
  };

  const removeFeature = (index: number) => {
    setForm(f => ({ ...f, features: f.features.filter((_, i) => i !== index) }));
  };

  const addTag = () => {
    if (!newTag.trim() || form.tags.includes(newTag.trim())) return;
    setForm(f => ({ ...f, tags: [...f.tags, newTag.trim()] }));
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));
  };

  const addImageUrl = () => {
    if (!newImageUrl.trim()) return;
    setForm(f => ({ ...f, image_urls: [...f.image_urls, newImageUrl.trim()] }));
    setNewImageUrl('');
  };

  const removeImageUrl = (index: number) => {
    setForm(f => ({ ...f, image_urls: f.image_urls.filter((_, i) => i !== index) }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('请填写商品名称'); return; }
    if (!form.sku.trim()) { toast.error('请填写商品SKU'); return; }

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
        res = await fetch('/api/knowledge/products', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: product!.id, ...payload }),
        });
      } else {
        res = await fetch('/api/knowledge/products', {
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
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
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
                <label className="block text-xs font-medium text-muted-foreground mb-1">分类</label>
                <input
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="如：服装"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">父分类</label>
                <input
                  value={form.parent_category}
                  onChange={e => setForm(f => ({ ...f, parent_category: e.target.value }))}
                  placeholder="如：男装"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">售价（元）</label>
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
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
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
          {isEditing && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">关联尺码表</h3>
              {loadingCharts ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : assocCharts.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无关联尺码表，可在「尺码配置」中为当前商品创建尺码表</p>
              ) : (
                <div className="space-y-2">
                  {assocCharts.map(chart => (
                    <div key={chart.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Ruler className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{chart.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {CHART_TYPE_LABELS[chart.chart_type as keyof typeof CHART_TYPE_LABELS] || chart.chart_type}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${chart.status === 'active' ? 'bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                          {chart.status === 'active' ? '启用' : '禁用'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>引用 {chart.hit_count} 次</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">商品详情</h3>
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
                    <img src={url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).src = 'https://placehold.co/80x80/png?text=无图'; }} />
                    <button
                      onClick={() => removeImageUrl(i)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ImageUploadInput
                  value={newImageUrl}
                  onChange={(url) => {
                    setNewImageUrl(url);
                    // Only auto-add when URL appears to be from a completed upload
                    // (contains a recognized storage domain), not from manual typing
                    if (url.trim() && /https?:\/\/[^/]+\.(coze\.cn|aliyuncs\.com|amazonaws\.com|bcebos\.com|七牛|qiniu|oss)/i.test(url)) {
                      setForm(f => ({ ...f, image_urls: [...f.image_urls, url.trim()] }));
                      setNewImageUrl('');
                    }
                  }}
                  placeholder="上传图片或输入图片URL后添加"
                />
              </div>
              <button
                onClick={addImageUrl}
                className="flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                添加
              </button>
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
      </div>
    </div>
  );
}
