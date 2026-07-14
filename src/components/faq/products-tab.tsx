'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search, Plus, Pencil, Trash2,
  Package, PackageX, TrendingUp,
  ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ProductFormModal } from './product-form-modal';
import { ProductItem } from './types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

export function ProductsTab() {
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
  const [confirmToggleProduct, setConfirmToggleProduct] = useState<ProductItem | null>(null);

  // Confirm dialog
  const { confirm: confirmDialog } = useConfirmDialog();

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
  const handleToggleProductStatus = (product: ProductItem) => {
    setConfirmToggleProduct(product);
  };

  const confirmToggleProductStatus = async () => {
    if (!confirmToggleProduct) return;
    const product = confirmToggleProduct;
    const newStatus = product.status === 'on_sale' ? 'off_sale' : 'on_sale';
    setConfirmToggleProduct(null);
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

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleDeleteProduct = async (id: string) => {
    const confirmed = await confirmDialog({
      title: '删除商品',
      description: '确定要删除该商品吗？此操作无法撤销。',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
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

  return (
    <>
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
              <div className="w-8 h-8 rounded-md bg-amber-200 dark:bg-amber-900/30 flex items-center justify-center">
                <PackageX className="w-4 h-4 text-amber-700" />
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
          <button
            onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加商品
          </button>
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
                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                        : product.status === 'off_sale'
                        ? 'bg-amber-200 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
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
                      <ArrowDownCircle className="w-3.5 h-3.5 text-amber-600 hover:text-amber-700" />
                    ) : (
                      <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-600 hover:text-emerald-700" />
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

      {/* Product Form Modal */}
      <ProductFormModal
        open={showProductForm}
        onClose={handleCloseProductModal}
        onSaved={handleProductSaved}
        product={editingProduct}
      />

      {/* Product Toggle Confirm Dialog */}
      <AlertDialog open={!!confirmToggleProduct} onOpenChange={() => setConfirmToggleProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{confirmToggleProduct?.status === 'on_sale' ? '下架' : '上架'}商品</AlertDialogTitle>
            <AlertDialogDescription>
              确定要{confirmToggleProduct?.status === 'on_sale' ? '下架' : '上架'}
              「{confirmToggleProduct?.name}」吗？
              {confirmToggleProduct?.status === 'on_sale' ? (
                <span className="block mt-1 text-amber-600">下架后该商品将不会在 AI 回复中被推荐。</span>
              ) : (
                <span className="block mt-1 text-emerald-700">上架后该商品将恢复在 AI 回复中被推荐。</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmToggleProduct(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleProductStatus}
              className={confirmToggleProduct?.status === 'on_sale'
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }
            >
              确认{confirmToggleProduct?.status === 'on_sale' ? '下架' : '上架'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
