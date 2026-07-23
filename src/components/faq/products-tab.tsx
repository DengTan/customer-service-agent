'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search, Pencil, Trash2,
  Package, PackageX, TrendingUp,
  ArrowDownCircle, ArrowUpCircle,
  PlusCircle, RefreshCw,
  CheckCircle2,
  Tag,
  Layers,
  Hash,
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
import { cn } from '@/lib/utils';

const STATUS_INFO: Record<string, { label: string; styles: string; dot: string }> = {
  on_sale: {
    label: '在售',
    styles: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-800/50',
    dot: 'bg-emerald-500',
  },
  off_sale: {
    label: '已下架',
    styles: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ring-amber-200 dark:ring-amber-800/50',
    dot: 'bg-amber-500',
  },
  discontinued: {
    label: '已停售',
    styles: 'bg-muted text-muted-foreground ring-border',
    dot: 'bg-muted-foreground/40',
  },
};

export function ProductsTab() {
  const [productList, setProductList] = useState<ProductItem[]>([]);
  const [productCategories, setProductCategories] = useState<Record<string, number>>({});
  const [productTotal, setProductTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productFilterCat, setProductFilterCat] = useState('');
  const [productFilterStatus, setProductFilterStatus] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [confirmToggleProduct, setConfirmToggleProduct] = useState<ProductItem | null>(null);

  const { confirm: confirmDialog } = useConfirmDialog();

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

  return (
    <>
      <div className="p-6 space-y-5">
        {/* Sticky toolbar: stats + filters */}
        <div className="sticky top-0 z-10 -mx-6 px-6 pt-3 pb-3 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 space-y-3">
          {/* Stat Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-muted/20 p-4 group hover:border-emerald-300/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">在售商品</div>
                  <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {loadingProducts ? '—' : productStats.onSale}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-muted/20 p-4 group hover:border-amber-300/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                  <PackageX className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">已下架</div>
                  <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                    {loadingProducts ? '—' : productStats.offSale}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-border/60 bg-gradient-to-br from-card to-muted/20 p-4 group hover:border-primary/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">AI 引用次数</div>
                  <div className="text-2xl font-bold text-primary tabular-nums">
                    {loadingProducts ? '—' : productStats.hitCount}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2.5 pt-3 border-t border-border/60">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索商品名称或 SKU..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full pl-8.5 pr-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
              />
            </div>
            <select
              value={productFilterCat}
              onChange={(e) => setProductFilterCat(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors cursor-pointer"
            >
              <option value="">全部分类</option>
              {productCategoryOptions.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              value={productFilterStatus}
              onChange={(e) => setProductFilterStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors cursor-pointer"
            >
              <option value="">全部状态</option>
              <option value="on_sale">在售</option>
              <option value="off_sale">已下架</option>
              <option value="discontinued">停售</option>
            </select>
            <button
              onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
              className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 active:scale-[0.97] transition-all shadow-sm shadow-primary/20"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              添加商品
            </button>
          </div>
        </div>

        {/* Product list */}
        {loadingProducts ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2.5" />
            加载中...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/10 flex items-center justify-center">
                <Package className="w-7 h-7 text-primary/60" />
              </div>
            </div>
            <h3 className="text-base font-semibold text-foreground/80 mb-1.5">暂无商品</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {productSearch || productFilterCat || productFilterStatus
                ? '没有找到符合条件的商品，请调整筛选条件'
                : '点击右上角「添加商品」开始录入您的第一个商品'}
            </p>
            {(productSearch || productFilterCat || productFilterStatus) && (
              <button
                onClick={() => { setProductSearch(''); setProductFilterCat(''); setProductFilterStatus(''); }}
                className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                清空筛选
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredProducts.map((product) => {
              const statusInfo = STATUS_INFO[product.status] || STATUS_INFO.on_sale;
              return (
                <div
                  key={product.id}
                  className={cn(
                    'group relative rounded-xl border bg-card transition-all duration-200 overflow-hidden',
                    product.status === 'off_sale' || product.status === 'discontinued'
                      ? 'opacity-70 border-border/40 hover:opacity-90'
                      : 'border-border/60 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5',
                  )}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-[16/10] bg-gradient-to-br from-muted/40 to-muted overflow-hidden">
                    {product.image_urls && product.image_urls.length > 0 ? (
                      <img
                        src={product.image_urls[0]}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-10 h-10 text-muted-foreground/30" />
                      </div>
                    )}
                    {/* Status badge overlay */}
                    <div className="absolute top-2.5 left-2.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium ring-2 ring-inset backdrop-blur-sm',
                        product.status === 'off_sale' || product.status === 'discontinued'
                          ? 'bg-card/80 text-muted-foreground ring-transparent'
                          : statusInfo.styles
                      )}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', statusInfo.dot)} />
                        {statusInfo.label}
                      </span>
                    </div>
                    {/* Hit count badge */}
                    {product.hit_count > 0 && (
                      <div className="absolute top-2.5 right-2.5">
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-medium bg-black/60 backdrop-blur-sm text-white">
                          <TrendingUp className="w-2.5 h-2.5" />
                          {product.hit_count}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-3.5 space-y-2.5">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-1">
                        {product.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-muted-foreground">
                        {product.sku && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Hash className="w-2.5 h-2.5" />
                            {product.sku}
                          </span>
                        )}
                        {product.brand && (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                            {product.brand}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="flex items-baseline gap-1.5">
                      {product.price != null && (
                        <span className="text-lg font-bold text-primary tabular-nums">
                          ¥{product.price.toFixed(2)}
                        </span>
                      )}
                      {product.original_price != null && product.original_price > 0 && product.original_price > (product.price || 0) && (
                        <span className="text-xs text-muted-foreground line-through tabular-nums">
                          ¥{product.original_price.toFixed(2)}
                        </span>
                      )}
                      {product.price != null && product.original_price != null && product.original_price > product.price && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium">
                          {Math.round((1 - product.price / product.original_price) * 100)}% OFF
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    {product.tags && product.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {product.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                        {product.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground/60">+{product.tags.length - 3}</span>
                        )}
                      </div>
                    )}

                    {/* Footer actions */}
                    <div className="flex items-center gap-1 pt-2.5 border-t border-border/40 -mx-3.5 px-3.5">
                      <button
                        onClick={() => handleEditProduct(product)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        编辑
                      </button>
                      <div className="w-px h-4 bg-border/60" />
                      <button
                        onClick={() => handleToggleProductStatus(product)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs hover:bg-muted/50 rounded-md transition-colors"
                      >
                        {product.status === 'on_sale' ? (
                          <>
                            <ArrowDownCircle className="w-3 h-3 text-amber-600" />
                            <span className="text-amber-600">下架</span>
                          </>
                        ) : (
                          <>
                            <ArrowUpCircle className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-600">上架</span>
                          </>
                        )}
                      </button>
                      <div className="w-px h-4 bg-border/60" />
                      <button
                        onClick={() => handleDeleteProduct(product.id)}
                        className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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

      {/* Toggle Confirm Dialog */}
      <AlertDialog open={!!confirmToggleProduct} onOpenChange={() => setConfirmToggleProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{confirmToggleProduct?.status === 'on_sale' ? '下架' : '上架'}商品</AlertDialogTitle>
            <AlertDialogDescription>
              确定要{confirmToggleProduct?.status === 'on_sale' ? '下架' : '上架'}
              「{confirmToggleProduct?.name}」吗？
              {confirmToggleProduct?.status === 'on_sale' ? (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">下架后该商品将不会在 AI 回复中被推荐。</span>
              ) : (
                <span className="block mt-1 text-emerald-700 dark:text-emerald-400">上架后该商品将恢复在 AI 回复中被推荐。</span>
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