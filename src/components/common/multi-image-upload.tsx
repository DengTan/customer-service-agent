'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, X, Loader2, ImageIcon, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface UploadedImage {
  url: string;
  name: string;
  description?: string;
}

interface MultiImageUploadProps {
  /** Current images array */
  images: UploadedImage[];
  /** Callback when images array changes */
  onChange: (images: UploadedImage[]) => void;
  /** Max number of images allowed */
  maxImages?: number;
  /** Max file size per image in MB */
  maxSizeMB?: number;
  /** Upload purpose: 'knowledge' (365-day URL) or 'chat' (30-day URL) */
  purpose?: 'chat' | 'knowledge';
  /** Whether the input is disabled */
  disabled?: boolean;
}

export function MultiImageUpload({
  images,
  onChange,
  maxImages = 20,
  maxSizeMB = 10,
  purpose = 'knowledge',
  disabled = false,
}: MultiImageUploadProps) {
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (file: File, targetIndex?: number) => {
    if (disabled) return;
    if (images.length >= maxImages) {
      toast.error(`最多只能上传 ${maxImages} 张图片`);
      return;
    }

    // Validate MIME type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('仅支持 JPG/PNG/GIF/WebP 格式的图片');
      return;
    }

    // Validate file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`图片大小不能超过 ${maxSizeMB}MB`);
      return;
    }

    setUploadingIndex(targetIndex ?? images.length);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', purpose);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `上传失败 (HTTP ${res.status})`);
      }

      const data = await res.json();
      if (data.success && data.url) {
        const newImage: UploadedImage = {
          url: data.url,
          name: file.name,
        };
        
        if (targetIndex !== undefined && targetIndex < images.length) {
          // Replace existing image
          const newImages = [...images];
          newImages[targetIndex] = newImage;
          onChange(newImages);
        } else {
          // Add new image
          onChange([...images, newImage]);
        }
        toast.success('图片上传成功');
      } else {
        throw new Error(data.message || '上传返回异常');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploadingIndex(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [disabled, images, maxImages, maxSizeMB, onChange, purpose]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Upload files one by one
      Array.from(files).forEach((file, index) => {
        const targetIndex = index === 0 ? undefined : images.length + index;
        handleFileUpload(file, targetIndex);
      });
    }
  }, [handleFileUpload, images.length]);

  const handleRemove = useCallback((index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onChange(newImages);
  }, [images, onChange]);

  const handleUpdateDescription = useCallback((index: number, description: string) => {
    const newImages = [...images];
    newImages[index] = { ...newImages[index], description };
    onChange(newImages);
  }, [images, onChange]);

  return (
    <div className="space-y-3">
      {/* Image Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, index) => (
            <div key={`${img.url}-${index}`} className="relative group rounded-lg border border-border bg-muted/30 overflow-hidden">
              {/* Image thumbnail */}
              <div className="aspect-square">
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
              </div>
              
              {/* Hover overlay with remove button */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              {/* Image name badge */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <p className="text-[10px] text-white/90 truncate">{img.name}</p>
              </div>
            </div>
          ))}
          
          {/* Upload placeholder when adding more */}
          {images.length < maxImages && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "aspect-square rounded-lg border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 cursor-pointer flex flex-col items-center justify-center gap-1 transition-colors",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <Plus className="w-5 h-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">添加</span>
            </div>
          )}
        </div>
      )}

      {/* Empty state - show upload area */}
      {images.length === 0 && (
        <div
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 cursor-pointer transition-colors",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <ImageIcon className="w-6 h-6 text-primary/60" />
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground font-medium">点击上传图片</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">支持 JPG/PNG/GIF/WebP，最多 {maxImages} 张</p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploadingIndex !== null}
      />

      {/* Upload button when there are some images but not at max */}
      {images.length > 0 && images.length < maxImages && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploadingIndex !== null}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-colors",
            (disabled || uploadingIndex !== null) && "opacity-50 cursor-not-allowed"
          )}
        >
          {uploadingIndex !== null ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              上传中...
            </>
          ) : (
            <>
              <Upload className="w-3.5 h-3.5" />
              继续添加图片
            </>
          )}
        </button>
      )}

      {/* Description fields */}
      {images.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground font-medium">图片描述 <span className="text-destructive">*</span></p>
          {images.map((img, index) => (
            <div key={`desc-${index}`} className="flex items-center gap-2">
              <div className="w-8 h-8 rounded border border-border overflow-hidden shrink-0">
                <img src={img.url} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={img.description || ''}
                  onChange={(e) => handleUpdateDescription(index, e.target.value)}
                  placeholder={`图片${index + 1}的描述（必填，用于向量检索）...`}
                  className={cn(
                    "w-full px-2 py-1.5 rounded border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors",
                    !img.description?.trim() ? "border-amber-400 bg-amber-50/50" : "border-border/60"
                  )}
                />
                {!img.description?.trim() && (
                  <span className="absolute -top-5 right-0 text-[10px] text-amber-600">请填写描述</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
