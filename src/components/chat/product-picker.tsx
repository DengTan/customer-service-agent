'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Search, X, Package, Loader2, Send, ShoppingBag } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/common/pagination';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ProductCardData {
  id: string;
  name: string;
  sku: string;
  price: string;
  image_url?: string;
  description?: string;
}

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  image_urls?: string[] | null;
  description?: string | null;
}

interface ProductPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (product: ProductCardData) => void;
}

const PAGE_SIZE = 6;

export function ProductPicker({ open, onOpenChange, onSelect }: ProductPickerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Debounced search - reset page when search changes
  useEffect(() => {
    setPage(1);
  }, [search]);

  // Load products when page or search changes
  useEffect(() => {
    loadProducts(search, page);
  }, [search, page, open]);

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch('');
      setProducts([]);
      setPage(1);
      setTotal(0);
    }
  }, [open]);

  const loadProducts = async (query: string, pageNum: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('search', query.trim());
      params.set('status', 'on_sale'); // Only show on-sale products
      params.set('page', String(pageNum));
      params.set('page_size', String(PAGE_SIZE));

      const res = await fetch(`/api/knowledge/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.items || []);
        setTotal(data.total || 0);
      }
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleSelect = (product: Product) => {
    const cardData: ProductCardData = {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price != null ? String(product.price) : '',
      image_url: product.image_urls?.[0] || undefined,
      description: product.description || undefined,
    };
    onSelect(cardData);
    onOpenChange(false);
  };

  // Listen for view product detail events
  useEffect(() => {
    const handleViewProductDetail = (e: CustomEvent<{ productId: string }>) => {
      const { productId } = e.detail;
      // Find the product and select it
      const product = products.find(p => p.id === productId);
      if (product) {
        handleSelect(product);
      }
    };

    window.addEventListener('viewProductDetail', handleViewProductDetail as EventListener);
    return () => {
      window.removeEventListener('viewProductDetail', handleViewProductDetail as EventListener);
    };
  }, [products]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border/60 bg-gradient-to-r from-primary/5 to-transparent shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-3 text-lg font-semibold">
              <div className="p-2 rounded-xl bg-primary/10">
                <ShoppingBag className="w-5 h-5 text-primary" />
              </div>
              选择商品发送
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Search input */}
        <div className="px-6 py-4 border-b border-border/40 shrink-0 bg-muted/20">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="搜索商品名称或SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 pr-10 bg-background border-border/50 focus:border-primary/50 rounded-xl"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          {total > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              共找到 <span className="font-medium text-foreground">{total}</span> 件商品
            </p>
          )}
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">正在加载商品...</span>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="p-4 rounded-full bg-muted/50 mb-4">
                <Package className="w-10 h-10 opacity-40" />
              </div>
              <p className="text-sm font-medium">
                {search ? '未找到匹配的商品' : '暂无商品'}
              </p>
              {search && (
                <p className="text-xs text-muted-foreground mt-1">
                  尝试更换关键词搜索
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="group relative flex flex-col rounded-2xl bg-card border border-border/50 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden"
                >
                  {/* Product image */}
                  <div className="relative aspect-square bg-muted/30 overflow-hidden">
                    {product.image_urls?.[0] ? (
                      <Image
                        src={product.image_urls[0]}
                        alt={product.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-12 h-12 text-muted-foreground/30" />
                      </div>
                    )}
                    {/* Hover overlay with send button */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <button
                        onClick={() => handleSelect(product)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-medium shadow-lg hover:bg-primary/90 active:scale-95 transition-all"
                      >
                        <Send className="w-4 h-4" />
                        <span>发送</span>
                      </button>
                    </div>
                  </div>

                  {/* Product info */}
                  <div className="p-3 flex flex-col flex-1">
                    <h4 className="font-medium text-sm text-foreground line-clamp-2 leading-snug mb-2 flex-1">
                      {product.name}
                    </h4>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs text-muted-foreground truncate font-mono">
                        {product.sku}
                      </code>
                      <span className="text-base font-bold text-primary shrink-0">
                        {product.price != null ? (
                          <>¥{Number(product.price).toFixed(2)}</>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </span>
                    </div>
                    {product.description && (
                      <p className="text-xs text-muted-foreground/70 mt-2 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="shrink-0 border-t border-border/60 px-6 py-3 bg-muted/20">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
