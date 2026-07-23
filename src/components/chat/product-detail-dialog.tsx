'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, Package, Tag, Layers, FileText, Info } from 'lucide-react';
import { Loader2 } from 'lucide-react';

interface ProductDetailData {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string | null;
  price: number | null;
  original_price: number | null;
  specifications: Array<{ key: string; value: string }>;
  features: string[];
  description: string | null;
  usage_instructions: string | null;
  image_urls: string[];
  tags: string[];
  status: string;
  hit_count: number;
}

interface ProductDetailDialogProps {
  open: boolean;
  productId: string | null;
  onClose: () => void;
}

export function ProductDetailDialog({ open, productId, onClose }: ProductDetailDialogProps) {
  const [product, setProduct] = useState<ProductDetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && productId) {
      loadProductDetail(productId);
    } else {
      setProduct(null);
    }
  }, [open, productId]);

  const loadProductDetail = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/knowledge/products/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProduct(data.product || data);
      }
    } catch {
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="relative bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col mx-4 border border-border/50">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <h2 className="font-semibold text-lg text-foreground">商品详情</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted transition-all duration-200 hover:scale-105"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">正在加载商品信息...</span>
            </div>
          ) : product ? (
            <div className="space-y-6">
              {/* Product Images */}
              {product.image_urls && product.image_urls.length > 0 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {product.image_urls.slice(0, 3).map((url, idx) => (
                      <div 
                        key={idx} 
                        className={`relative rounded-xl overflow-hidden bg-muted border border-border/50 ${
                          idx === 0 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square'
                        }`}
                      >
                        <Image
                          src={url}
                          alt={`${product.name} - 图片${idx + 1}`}
                          fill
                          className="object-cover hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    ))}
                  </div>
                  {product.image_urls.length > 3 && (
                    <p className="text-xs text-muted-foreground text-center">
                      共 {product.image_urls.length} 张图片
                    </p>
                  )}
                </div>
              )}

              {/* Basic Info Card */}
              <div className="bg-gradient-to-br from-card to-card/80 rounded-2xl p-5 border border-border/50 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-foreground mb-2">{product.name}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {product.category && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted/60">
                          <Layers className="w-3.5 h-3.5" />
                          {product.category}
                        </span>
                      )}
                      {product.brand && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted/60">
                          <Tag className="w-3.5 h-3.5" />
                          {product.brand}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                    product.status === 'on_sale' 
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                      : product.status === 'off_sale' 
                      ? 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  }`}>
                    {product.status === 'on_sale' ? '在售' : product.status === 'off_sale' ? '已下架' : '已停售'}
                  </span>
                </div>

                {/* SKU */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">SKU</span>
                  <code className="px-2 py-0.5 rounded-md bg-muted/60 text-foreground font-mono text-xs">
                    {product.sku}
                  </code>
                </div>
              </div>

              {/* Price Card */}
              <div className="bg-gradient-to-r from-primary/8 via-primary/5 to-primary/8 rounded-2xl p-5 border border-primary/10">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold text-primary">
                    ¥{product.price != null ? Number(product.price).toFixed(2) : '-'}
                  </span>
                  {product.original_price && product.original_price > (product.price || 0) && (
                    <>
                      <span className="text-base text-muted-foreground line-through">
                        ¥{Number(product.original_price).toFixed(2)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-xs font-medium">
                        节省 ¥{(Number(product.original_price) - Number(product.price!)).toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Specifications */}
              {product.specifications && product.specifications.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <div className="p-1.5 rounded-lg bg-muted">
                      <Info className="w-4 h-4" />
                    </div>
                    <span>规格参数</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {product.specifications.map((spec, idx) => (
                      <div 
                        key={idx} 
                        className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-muted/40 border border-border/30 hover:bg-muted/60 transition-colors"
                      >
                        <span className="text-sm text-muted-foreground">{spec.key}</span>
                        <span className="text-sm font-medium text-foreground">{spec.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Features */}
              {product.features && product.features.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <div className="p-1.5 rounded-lg bg-muted">
                      <Tag className="w-4 h-4" />
                    </div>
                    <span>商品卖点</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {product.features.map((feature, idx) => (
                      <span 
                        key={idx} 
                        className="px-4 py-2 rounded-full bg-gradient-to-r from-primary/10 to-primary/5 text-primary text-sm font-medium border border-primary/10"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              {product.description && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <div className="p-1.5 rounded-lg bg-muted">
                      <FileText className="w-4 h-4" />
                    </div>
                    <span>商品描述</span>
                  </div>
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {product.description}
                    </p>
                  </div>
                </div>
              )}

              {/* Usage Instructions */}
              {product.usage_instructions && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <div className="p-1.5 rounded-lg bg-muted">
                      <Info className="w-4 h-4" />
                    </div>
                    <span>使用说明</span>
                  </div>
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {product.usage_instructions}
                    </p>
                  </div>
                </div>
              )}

              {/* Tags */}
              {product.tags && product.tags.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <div className="p-1.5 rounded-lg bg-muted">
                      <Tag className="w-4 h-4" />
                    </div>
                    <span>标签</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {product.tags.map((tag, idx) => (
                      <span 
                        key={idx} 
                        className="px-3 py-1.5 rounded-lg bg-secondary/50 text-secondary-foreground text-xs border border-border/50"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="p-4 rounded-full bg-muted/50 mb-4">
                <Package className="w-10 h-10 opacity-30" />
              </div>
              <p className="text-sm font-medium">商品信息加载失败</p>
              <p className="text-xs text-muted-foreground mt-1">请稍后重试</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
