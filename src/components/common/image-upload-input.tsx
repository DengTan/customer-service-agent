'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface ImageUploadInputProps {
  /** Current image URL value (controlled) */
  value: string;
  /** Callback when URL changes (from upload or manual input) */
  onChange: (url: string) => void;
  /** Placeholder text for the URL input */
  placeholder?: string;
  /** Accepted image MIME types */
  accept?: string;
  /** Max file size in MB */
  maxSizeMB?: number;
  /** Whether to show a thumbnail preview below the input */
  preview?: boolean;
  /** Upload purpose: 'knowledge' (365-day URL) or 'chat' (30-day URL) */
  purpose?: 'chat' | 'knowledge';
  /** Label text */
  label?: string;
  /** Optional hint text */
  hint?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
}

export function ImageUploadInput({
  value,
  onChange,
  placeholder = '输入图片URL或上传本地图片',
  accept = 'image/jpeg,image/png,image/gif,image/webp',
  maxSizeMB = 10,
  preview = false,
  purpose = 'knowledge',
  label,
  hint,
  disabled = false,
}: ImageUploadInputProps) {
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (file: File) => {
    if (disabled) return;

    // Validate MIME type before upload (belt-and-suspenders; server has magic bytes check)
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

    setUploading(true);
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
      // apiSuccess returns { success: true, url, key }
      if (data.success && data.url) {
        onChange(data.url);
        toast.success('图片上传成功');
      } else {
        throw new Error(data.message || '上传返回异常');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
      // Reset file input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [disabled, maxSizeMB, onChange, purpose]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleClear = useCallback(() => {
    onChange('');
    setImgError(false);
  }, [onChange]);

  // Reset error state when value changes (e.g., new upload replaces failed URL)
  useEffect(() => {
    if (value) setImgError(false);
  }, [value]);

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5" />
          {label}
          {hint && <span className="text-xs text-muted-foreground font-normal">{hint}</span>}
        </label>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="url"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled || uploading}
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
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
      {preview && value && !imgError && (
        <div className="mt-2 relative inline-block group">
          <img
            src={value}
            alt="预览"
            className="h-24 rounded-lg border border-border object-cover"
            onError={() => setImgError(true)}
          />
        </div>
      )}
      {preview && value && imgError && (
        <div className="mt-2 h-24 rounded-lg border border-border bg-muted/50 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">图片加载失败</span>
        </div>
      )}
    </div>
  );
}
