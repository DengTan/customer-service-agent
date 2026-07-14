'use client';

import { useEffect, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

interface ImagePreviewDialogProps {
  /** Image URL to preview, null when closed */
  src: string | null;
  /** Optional alt text / caption */
  alt?: string;
  /** Optional title shown above the image */
  title?: string;
  /** Close handler */
  onClose: () => void;
}

export function ImagePreviewDialog({ src, alt, title, onClose }: ImagePreviewDialogProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Reset zoom/rotation when image changes or dialog reopens
  useEffect(() => {
    if (src) {
      setScale(1);
      setRotation(0);
    }
  }, [src]);

  // ESC key to close
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!src) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [src]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm popup-enter"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || alt || '图片预览'}
    >
      {/* Toolbar */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1 bg-card/90 backdrop-blur rounded-lg p-1 shadow-lg border border-border/50 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setScale(s => Math.max(0.25, s - 0.25))}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="缩小"
          aria-label="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-muted-foreground px-2 min-w-[48px] text-center tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setScale(s => Math.min(4, s + 0.25))}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="放大"
          aria-label="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setRotation(r => (r + 90) % 360)}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="旋转"
          aria-label="旋转"
        >
          <RotateCw className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => { setScale(1); setRotation(0); }}
          className="p-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="重置"
          aria-label="重置"
        >
          重置
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="关闭 (ESC)"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Title bar */}
      {(title || alt) && (
        <div
          className="absolute top-4 left-4 max-w-[60vw] bg-card/90 backdrop-blur rounded-lg px-3 py-2 shadow-lg border border-border/50 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-medium text-foreground truncate">{title || alt}</p>
        </div>
      )}

      {/* Image container */}
      <div
        className="relative max-w-[92vw] max-h-[88vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || title || '预览'}
          className="block max-w-full max-h-[88vh] object-contain rounded-lg shadow-2xl select-none"
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}