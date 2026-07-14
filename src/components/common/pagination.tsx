'use client';

import { useState } from 'react';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  disabled = false,
}: PaginationProps) {
  const [jumpValue, setJumpValue] = useState('');

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const handleJump = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const num = parseInt(jumpValue, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      onPageChange(num);
      setJumpValue('');
    }
  };

  const handleJumpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setJumpValue(e.target.value);
  };

  if (totalPages <= 0) return null;

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      {/* Left: total count + optional page size selector */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground shrink-0">
        <span>共 {total} 条</span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span>每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-[70px] text-xs border-input bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>条</span>
          </div>
        )}
      </div>

      {/* Right: navigation buttons + optional jump input */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(1)}
          disabled={disabled || !canPrev}
          title="首页"
          className="shrink-0"
        >
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || !canPrev}
          title="上一页"
          className="shrink-0"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <span className="px-2 text-sm text-muted-foreground min-w-[80px] text-center shrink-0">
          第 {page} / {totalPages} 页
        </span>

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || !canNext}
          title="下一页"
          className="shrink-0"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(totalPages)}
          disabled={disabled || !canNext}
          title="尾页"
          className="shrink-0"
        >
          <ChevronsRight className="size-4" />
        </Button>

        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 ml-2 shrink-0">
            <span className="text-sm text-muted-foreground">跳转</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={handleJumpChange}
              onKeyDown={handleJump}
              disabled={disabled}
              className="h-7 w-14 rounded-md border border-input bg-transparent px-2 text-xs text-center transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              placeholder="页码"
            />
          </div>
        )}
      </div>
    </div>
  );
}
