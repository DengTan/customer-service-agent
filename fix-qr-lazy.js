#!/usr/bin/env node
// Fix quick-replies-panel.tsx: integrate useLazyList, create ReplyList, remove old state

const fs = require('fs');

// Step 1: Read original file (detect encoding)
const rawBytes = fs.readFileSync('d:/customer_service_agent-main/src/components/quick-replies/quick-replies-panel.tsx');

// Try to decode - file might be GBK
let text;
try {
  // GBK (codepage 936) covers all the Chinese chars used
  const iconv = require('iconv-lite');
  text = iconv.decode(rawBytes, 'gbk');
} catch (e) {
  // fallback: treat as UTF-8
  text = rawBytes.toString('utf8');
}

const lines = text.split('\n');

function ln(n) {
  return lines[n - 1];
}

function replace(startLine, endLine, newLines) {
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  lines.length = 0;
  lines.push(...before, ...newLines, ...after);
}

// ============================================================
// CHANGE 1: Add useLazyList import (after "from 'react'")
// Line 3 is: import { useState, useEffect, useMemo, useRef, useCallback } from "react";
// ============================================================
replace(3, 3, [
  'import { useState, useEffect, useMemo, useRef, useCallback } from "react";',
  "import { useLazyList } from '@/hooks/use-lazy-list';",
]);

// ============================================================
// CHANGE 2: Replace old state + loadReplies with useLazyList
// Lines 110-157 contain old state and loadReplies
// New code starts at the component body, after QuickRepliesPanel({
// ============================================================
const newState = [
  "  const [search, setSearch] = useState('');",
  "  const [categoryFilter, setCategoryFilter] = useState('all');",
  "  const [scopeFilter, setScopeFilter] = useState('all');",
  "  const [dialogOpen, setDialogOpen] = useState(false);",
  "  const [editingId, setEditingId] = useState<string | null>(null);",
  "  const [deletingId, setDeletingId] = useState<string | null>(null);",
  "  const [saving, setSaving] = useState(false);",
  "  const [importDialogOpen, setImportDialogOpen] = useState(false);",
  "  const [importing, setImporting] = useState(false);",
  "  const [copiedId, setCopiedId] = useState<string | null>(null);",
  "  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);",
  "  const [form, setForm] = useState({",
  "    title: '',",
  "    content: '',",
  "    category: '其他',",
  "    scope: 'global',",
  "  });",
  '',
  "  // Lazy loading via useLazyList",
  "  const PAGE_SIZE = 20;",
  "  const fetchFnRef = useRef(async ({ page, limit }: { page: number; limit: number }) => {",
  "    const params = new URLSearchParams();",
  "    params.set('page', String(page));",
  "    params.set('limit', String(limit));",
  "    if (categoryFilter && categoryFilter !== 'all' && categoryFilter !== '全部') {",
  "      params.set('category', categoryFilter);",
  "    }",
  "    if (scopeFilter && scopeFilter !== 'all' && scopeFilter !== '全部') {",
  "      params.set('scope', scopeFilter);",
  "    }",
  "    if (search.trim()) params.set('search', search.trim());",
  "    const res = await fetch(`${API_BASE}?${params}`);",
  "    if (!res.ok) throw new Error('加载失败');",
  "    const data = await res.json();",
  "    return { items: data.items || [], total: data.total || 0 };",
  "  });",
  '',
  "  const {",
  "    items: replies,",
  "    total,",
  "    hasMore,",
  "    isInitialLoading,",
  "    isLoadingMore,",
  "    loadMore,",
  "    reset,",
  "    updateItems,",
  "    setTotal,",
  "  } = useLazyList({ fetchFn: fetchFnRef.current, pageSize: PAGE_SIZE });",
  '',
  "  // Get all categories from loaded replies",
  "  const categories = useMemo(() => {",
  "    const cats = new Set(replies.map((r) => r.category).filter((c): c is string => Boolean(c)));",
  "    return Array.from(cats).sort();",
  "  }, [replies]);",
];

replace(110, 165, newState);

// ============================================================
// CHANGE 3: Add ReplyList component (before QuickRepliesPanel)
// Find where QuickRepliesPanel starts and insert ReplyList before it
// ============================================================
const qrPanelStart = lines.findIndex(l => l.includes('export function QuickRepliesPanel'));
if (qrPanelStart === -1) throw new Error('Cannot find QuickRepliesPanel');

const replyListCode = [
  "// ReplyList sub-component with IntersectionObserver for lazy loading",
  "interface ReplyListProps {",
  "  replies: QuickReply[];",
  "  isInitialLoading: boolean;",
  "  isLoadingMore: boolean;",
  "  hasMore: boolean;",
  "  onLoadMore: () => void;",
  "  onSelect?: (reply: QuickReply) => void;",
  "  onCopy: (reply: QuickReply, e: React.MouseEvent) => void;",
  "  onEdit: (reply: QuickReply) => void;",
  "  onDelete: (id: string) => void;",
  "  onCreateFirst: () => void;",
  "  copiedId: string | null;",
  "  deletingId: string | null;",
  "  search: string;",
  "  categoryFilter: string;",
  "  scopeFilter: string;",
  "}",
  '',
  "function ReplyList({",
  "  replies,",
  "  isInitialLoading,",
  "  isLoadingMore,",
  "  hasMore,",
  "  onLoadMore,",
  "  onSelect,",
  "  onCopy,",
  "  onEdit,",
  "  onDelete,",
  "  onCreateFirst,",
  "  copiedId,",
  "  deletingId,",
  "  search,",
  "  categoryFilter,",
  "  scopeFilter,",
  "}: ReplyListProps) {",
  "  const observerTarget = useRef<HTMLDivElement>(null);",
  '',
  "  // IntersectionObserver for infinite scroll",
  "  useEffect(() => {",
  "    if (!observerTarget.current || !hasMore || isLoadingMore) return;",
  "    const observer = new IntersectionObserver(",
  "      (entries) => {",
  "        if (entries[0].isIntersecting) onLoadMore();",
  "      },",
  "      { threshold: 0.1 }",
  "    );",
  "    observer.observe(observerTarget.current);",
  "    return () => observer.disconnect();",
  "  }, [hasMore, isLoadingMore, onLoadMore]);",
  '',
  "  if (isInitialLoading) {",
  "    return (",
  "      <div className=\"flex-1 flex items-center justify-center\">",
  "        <div className=\"flex flex-col items-center gap-2 py-12\">",
  "          <div className=\"w-8 h-8 rounded-full border-4 border-primary/20 border-t-primary animate-spin\" />",
  "          <p className=\"text-xs text-muted-foreground\">加载中...</p>",
  "        </div>",
  "      </div>",
  "    );",
  "  }",
  '',
  "  if (replies.length === 0) {",
  "    return (",
  "      <div className=\"flex-1 flex flex-col items-center justify-center gap-3 py-12\">",
  "        <BookOpen className=\"w-12 h-12 text-muted-foreground/30\" />",
  "        <div className=\"text-center\">",
  "          <p className=\"text-sm font-medium text-muted-foreground\">暂无话术</p>",
  "          {(search || categoryFilter !== 'all' || scopeFilter !== 'all') && (",
  "            <p className=\"text-xs text-muted-foreground mt-1\">调整筛选条件试试</p>",
  "          )}",
  "          {!search && categoryFilter === 'all' && scopeFilter === 'all' && (",
  "            <Button variant=\"outline\" size=\"sm\" onClick={onCreateFirst} className=\"mt-3 h-7 text-xs gap-1\">",
  "              <Plus className=\"w-3 h-3\" />",
  "              新建话术",
  "            </Button>",
  "          )}",
  "        </div>",
  "      </div>",
  "    );",
  "  }",
  '',
  "  return (",
  "    <div className=\"flex-1 overflow-y-auto\">",
  "      {replies.map((reply) => {",
  "        const isCopied = copiedId === reply.id;",
  "        const isDeleting = deletingId === reply.id;",
  "        return (",
  "          <div",
  "            key={reply.id}",
  "            className={cn(",
  "              'px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer group',",
  "              isDeleting && 'opacity-50 pointer-events-none',",
  "            )}",
  "            onClick={() => onSelect?.(reply)}",
  "          >",
  "            <div className=\"flex items-start justify-between gap-2\">",
  "              <div className=\"flex-1 min-w-0\">",
  "                <div className=\"flex items-center gap-1.5 mb-1\">",
  "                  <span className=\"text-sm font-medium text-foreground truncate\">{reply.title}</span>",
  "                  {reply.scope !== 'global' && (",
  "                    <span className={cn('shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium', SCOPE_COLORS[reply.scope] || 'bg-gray-100 text-gray-600')}>",
  "                      {SCOPE_LABELS[reply.scope] || reply.scope}",
  "                    </span>",
  "                  )}",
  "                </div>",
  "                <p className=\"text-xs text-muted-foreground line-clamp-2\">{reply.content}</p>",
  "                {reply.category && (",
  "                  <span className=\"inline-block mt-1 text-[10px] text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded\">",
  "                    {reply.category}",
  "                  </span>",
  "                )}",
  "              </div>",
  '',
  "              {/* 操作按钮 */}",
  "              <div className=\"flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0\">",
  "                <Button",
  "                  variant=\"ghost\"",
  "                  size=\"icon\"",
  "                  className=\"h-7 w-7\"",
  "                  onClick={(e) => { e.stopPropagation(); onCopy(reply, e); }}",
  "                  title=\"复制\"",
  "                >",
  "                  {isCopied ? <Check className=\"w-3.5 h-3.5 text-green-500\" /> : <Copy className=\"w-3.5 h-3.5\" />}",
  "                </Button>",
  "                <Button",
  "                  variant=\"ghost\"",
  "                  size=\"icon\"",
  "                  className=\"h-7 w-7\"",
  "                  onClick={(e) => { e.stopPropagation(); onEdit(reply); }}",
  "                  title=\"编辑\"",
  "                >",
  "                  <Edit2 className=\"w-3.5 h-3.5\" />",
  "                </Button>",
  "                <Button",
  "                  variant=\"ghost\"",
  "                  size=\"icon\"",
  "                  className=\"h-7 w-7 text-destructive hover:text-destructive\"",
  "                  onClick={(e) => { e.stopPropagation(); onDelete(reply.id); }}",
  "                  title=\"删除\"",
  "                  disabled={isDeleting}",
  "                >",
  "                  {isDeleting ? (",
  "                    <div className=\"w-3.5 h-3.5 rounded-full border-2 border-destructive/30 border-t-destructive animate-spin\" />",
  "                  ) : (",
  "                    <Trash2 className=\"w-3.5 h-3.5\" />",
  "                  )}",
  "                </Button>",
  "              </div>",
  "            </div>",
  "          </div>",
  "        );",
  "      })}",
  '',
  "      {/* IntersectionObserver target + load more indicator */}",
  "      <div ref={observerTarget} className=\"h-px\" />",
  "      {isLoadingMore && (",
  "        <div className=\"flex items-center justify-center py-3 gap-2 text-xs text-muted-foreground\">",
  "          <div className=\"w-4 h-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin\" />",
  "          加载更多...",
  "        </div>",
  "      )}",
  "      {!hasMore && replies.length > 0 && (",
  "        <div className=\"py-3 text-center text-xs text-muted-foreground/50\">没有更多了</div>",
  "      )}",
  "    </div>",
  "  );",
  "}",
  '',
];

lines.splice(qrPanelStart, 0, ...replyListCode);

// ============================================================
// CHANGE 4: Fix stats bar - replace loading with isLoadingMore
// ============================================================
const statsLineIdx = lines.findIndex(l => l.includes('共 ') && l.includes('条话术'));
if (statsLineIdx !== -1) {
  // Replace the entire line that has "loading ? "筛选中""
  const statsLine = lines[statsLineIdx];
  // Find and replace the loading reference
  lines[statsLineIdx] = statsLine.replace(
    /className=\{\s*loading \? "text-orange-600" : "text-green-600"\s*\}/,
    'className={isLoadingMore ? "text-orange-600" : "text-green-600"}'
  );
}

// ============================================================
// CHANGE 5: Fix handleExport - add page and limit params
// Also fix the fetch URL to include page/limit for export
// ============================================================
const exportLineIdx = lines.findIndex(l => l.trim().startsWith('const res = await fetch(`${API_BASE}/export'));
if (exportLineIdx !== -1) {
  // Add page and limit params to the export URL
  lines[exportLineIdx] = lines[exportLineIdx].replace(
    '`${API_BASE}/export?format=${format}`',
    '`${API_BASE}/export?format=${format}&page=1&limit=10000`'
  );
}

// ============================================================
// Write the result back as UTF-8
// ============================================================
const output = lines.join('\n');
fs.writeFileSync(
  'd:/customer_service_agent-main/src/components/quick-replies/quick-replies-panel.tsx',
  '\ufeff' + output,
  'utf8'
);

console.log('Done! Changes applied:');
console.log('1. Added useLazyList import');
console.log('2. Replaced old state + loadReplies with useLazyList hook');
console.log('3. Added ReplyList sub-component with IntersectionObserver');
console.log('4. Fixed loading reference in stats bar');
console.log('5. Fixed export URL to include pagination params');
console.log('Total lines:', lines.length);
