'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Folder,
  FolderOpen,
  PlusCircle,
  Pencil,
  Trash2,
  X,
  Check,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CategoryItem {
  category: string;
  count: number;
}

interface TreeNode {
  name: string;
  count: number;
}

interface CategoryManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCategoryChange?: () => void;
}

export function CategoryManagerModal({
  open,
  onOpenChange,
  onCategoryChange,
}: CategoryManagerModalProps) {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Create new category
  const [showCreate, setShowCreate] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creating, setCreating] = useState(false);

  // Rename
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Delete
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CategoryItem | null>(null);

  // Build flat list from API response
  const tree = useMemo<Record<string, TreeNode>>(() => {
    const result: Record<string, TreeNode> = {};
    for (const cat of categories) {
      if (!cat.category) continue;
      result[cat.category] = { name: cat.category, count: cat.count };
    }
    return result;
  }, [categories]);

  // Sorted root categories
  const rootCategories = useMemo(() => {
    return Object.values(tree).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [tree]);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/knowledge/categories');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (err) {
      toast.error('加载分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadCategories();
    }
  }, [open, loadCategories]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setShowCreate(false);
      setNewCategoryName('');
      setRenamingCategory(null);
      setRenameValue('');
      setDeletingCategory(null);
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
    }
  }, [open]);

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) { toast.error('请输入分类名称'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/knowledge/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error((data && (data.error?.message || data.error)) || '创建分类失败');
        return;
      }
      toast.success(`分类「${name}」已创建`);
      setShowCreate(false);
      setNewCategoryName('');
      await loadCategories();
      onCategoryChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建分类失败');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renamingCategory) return;
    const newName = renameValue.trim();
    if (!newName) { toast.error('请输入新名称'); return; }
    if (newName === renamingCategory) {
      setRenamingCategory(null);
      return;
    }
    setRenaming(true);
    try {
      // Rename: find items with old category, update to new category
      const res = await fetch('/api/knowledge/items/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: renamingCategory, new_category: newName }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error((data && data.error) || '重命名失败');
        return;
      }
      toast.success(`已将「${renamingCategory}」重命名为「${newName}」`);
      setRenamingCategory(null);
      setRenameValue('');
      await loadCategories();
      onCategoryChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setRenaming(false);
    }
  };

  const openDeleteConfirm = (cat: CategoryItem) => {
    setDeleteTarget(cat);
    setConfirmDeleteOpen(true);
  };

  const handleDeleteCategory = async () => {
    if (!deleteTarget) return;
    const catName = deleteTarget.category;
    setDeleting(true);
    setDeletingCategory(catName);
    try {
      const res = await fetch('/api/knowledge/items/delete-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: catName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data && (data.error || data.message)) || '删除分类失败');
        return;
      }
      const count = data?.count ?? 0;
      if (count > 0) {
        toast.success(`分类「${catName}」已删除，${count} 条资料已变为不分类`);
      } else {
        toast.success(`分类「${catName}」已删除`);
      }
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
      await loadCategories();
      onCategoryChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除分类失败');
    } finally {
      setDeleting(false);
      setDeletingCategory(null);
    }
  };

  const startRename = (cat: CategoryItem) => {
    setRenamingCategory(cat.category);
    setRenameValue(cat.category);
  };

  const cancelRename = () => {
    setRenamingCategory(null);
    setRenameValue('');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="w-[560px] max-w-[95vw] max-h-[80vh] p-0 gap-0 flex flex-col"
        >
          <DialogTitle className="sr-only">分类管理</DialogTitle>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 flex-shrink-0 bg-gradient-to-r from-primary/4 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/20">
                <FolderOpen className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">分类管理</h2>
                <p className="text-[11px] text-muted-foreground">管理知识库分类结构</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                新建分类
              </button>
              <button
                onClick={() => onOpenChange(false)}
                className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : rootCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                  <Folder className="w-6 h-6 text-muted-foreground/60" />
                </div>
                <p className="text-sm text-muted-foreground">暂无分类</p>
                <p className="text-xs text-muted-foreground/60 mt-1">点击右上角「新建分类」开始</p>
              </div>
            ) : (
              <div className="space-y-1">
                {rootCategories.map((node) => (
                  <CategoryTreeItem
                    key={node.name}
                    node={node}
                    renamingCategory={renamingCategory}
                    renameValue={renameValue}
                    onRenameChange={setRenameValue}
                    onStartRename={startRename}
                    onCancelRename={cancelRename}
                    onConfirmRename={handleRename}
                    onOpenDelete={openDeleteConfirm}
                    renaming={renaming}
                    deletingCategory={deletingCategory}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Category Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent showCloseButton={false} className="w-[400px] max-w-[95vw] p-0 gap-0">
          <DialogTitle className="sr-only">新建分类</DialogTitle>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
            <h3 className="text-sm font-semibold text-foreground">新建分类</h3>
            <button
              onClick={() => setShowCreate(false)}
              className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">分类名称</label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory(); }}
                placeholder="输入分类名称"
                autoFocus
                className="w-full h-9 px-3 rounded-md bg-background border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCreate(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleCreateCategory}
                disabled={creating || !newCategoryName.trim()}
              >
                {creating && <Loader2 className="w-3 h-3 animate-spin" />}
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent showCloseButton={false} className="w-[400px] max-w-[95vw] p-0 gap-0">
          <DialogTitle className="sr-only">确认删除分类</DialogTitle>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-foreground">确认删除分类</h3>
              <span className="text-[11px] text-muted-foreground">·  此操作不可撤销</span>
            </div>
            <button
              onClick={() => setConfirmDeleteOpen(false)}
              className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-foreground leading-relaxed">
              确定要删除分类「<span className="font-semibold text-foreground">{deleteTarget?.category}</span>」吗？
            </p>
            {(deleteTarget?.count ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  该分类下有 <span className="font-medium text-foreground tabular-nums">{deleteTarget?.count}</span> 条资料，删除后将变为「不分类」
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDeleteOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteCategory}
                disabled={deleting}
              >
                {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                确认删除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Category Tree Item ───────────────────────────────────────────────────────

interface CategoryTreeItemProps {
  node: TreeNode;
  renamingCategory: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onStartRename: (cat: CategoryItem) => void;
  onCancelRename: () => void;
  onConfirmRename: () => void;
  onOpenDelete: (cat: CategoryItem) => void;
  renaming: boolean;
  deletingCategory: string | null;
}

function CategoryTreeItem({
  node,
  renamingCategory,
  renameValue,
  onRenameChange,
  onStartRename,
  onCancelRename,
  onConfirmRename,
  onOpenDelete,
  renaming,
  deletingCategory,
}: CategoryTreeItemProps) {
  const isRenaming = renamingCategory === node.name;
  const isDeleting = deletingCategory === node.name;

  const catItem: CategoryItem = {
    category: node.name,
    count: node.count,
  };

  return (
    <div
      className="group flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors"
    >
      {/* Folder icon */}
      <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />

      {/* Name or rename input */}
      {isRenaming ? (
        <div className="flex-1 flex items-center gap-1.5">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirmRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            autoFocus
            className="flex-1 px-2 py-1 rounded bg-background border border-primary/60 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={onConfirmRename}
            disabled={renaming}
            className="w-6 h-6 rounded bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center disabled:opacity-50 transition-colors"
          >
            {renaming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          </button>
          <button
            onClick={onCancelRename}
            className="w-6 h-6 rounded bg-muted text-muted-foreground hover:bg-muted/80 flex items-center justify-center transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-xs font-medium text-foreground truncate">{node.name}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {node.count > 0 ? `${node.count} 条` : '空'}
          </span>
        </>
      )}

      {/* Action buttons */}
      {!isRenaming && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onStartRename(catItem)}
            className="w-6 h-6 rounded hover:bg-primary/10 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            title="重命名"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onOpenDelete(catItem)}
            disabled={isDeleting}
            className={cn(
              'w-6 h-6 rounded flex items-center justify-center transition-colors',
              isDeleting
                ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
            )}
            title="删除"
          >
            {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      )}
    </div>
  );
}
