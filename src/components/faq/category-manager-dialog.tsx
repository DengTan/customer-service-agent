'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Search, Check, X } from 'lucide-react';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-fetch';

interface Category {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  description: string | null;
  item_count: number;
  created_at: string;
  updated_at: string | null;
}

interface CategoryManagerDialogProps {
  onClose?: () => void;
}

const COLOR_OPTIONS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

export function CategoryManagerDialog({ onClose }: CategoryManagerDialogProps) {
  const { confirm } = useConfirmDialog();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(COLOR_OPTIONS[0]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/knowledge/categories');
      if (res.ok) {
        const data = await res.json();
        const cats = data.categories || [];
        setCategories(cats);
      }
    } catch {
      toast.error('加载分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const filteredCategories = searchQuery
    ? categories.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : categories;

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('请输入分类名称');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/knowledge/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          color: newColor,
        }),
      });
      if (res.ok) {
        toast.success('分类创建成功');
        setShowCreateForm(false);
        setNewName('');
        setNewColor(COLOR_OPTIONS[0]);
        loadCategories();
      } else {
        const err = await res.json();
        toast.error(err.error || err.message || '创建失败');
      }
    } catch {
      toast.error('创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      toast.error('请输入分类名称');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/knowledge/categories/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          color: editColor,
        }),
      });
      if (res.ok) {
        toast.success('分类已更新');
        setEditingId(null);
        loadCategories();
      } else {
        const err = await res.json();
        toast.error(err.error || err.message || '更新失败');
      }
    } catch {
      toast.error('更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor(COLOR_OPTIONS[0]);
  };

  const handleDelete = async (cat: Category) => {
    const confirmed = cat.item_count > 0
      ? await confirm({
          title: '删除分类',
          description: `「${cat.name}」下有 ${cat.item_count} 个条目，删除后这些条目将不再关联任何分类。确定要删除吗？`,
          confirmText: '删除',
          cancelText: '取消',
          destructive: true,
        })
      : await confirm({
          title: '删除分类',
          description: `确定要删除「${cat.name}」吗？`,
          confirmText: '删除',
          cancelText: '取消',
          destructive: true,
        });

    if (!confirmed) return;

    setDeletingId(cat.id);
    try {
      const res = await apiFetch(`/api/knowledge/categories/${cat.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('分类已删除');
        loadCategories();
      } else {
        const err = await res.json();
        toast.error(err.error || err.message || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search & Create */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索分类..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus className="w-3 h-3" />
            新建
          </button>
        )}
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
          <input
            type="text"
            placeholder="输入分类名称..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setShowCreateForm(false); setNewName(''); }
            }}
          />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 flex-1">
              <span className="text-[10px] text-muted-foreground shrink-0">颜色:</span>
              <div className="flex gap-1 flex-wrap">
                {COLOR_OPTIONS.map(color => (
                  <button
                    key={color}
                    onClick={() => setNewColor(color)}
                    className={cn(
                      'w-5 h-5 rounded-full transition-transform',
                      newColor === color && 'ring-2 ring-offset-1 ring-primary scale-110',
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                保存
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewName(''); setNewColor(COLOR_OPTIONS[0]); }}
                className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category List */}
      <div className="max-h-[300px] overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
        {loading ? (
          <div className="text-center py-8 text-xs text-muted-foreground">加载中...</div>
        ) : filteredCategories.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            {searchQuery ? '未找到匹配的分类' : '暂无分类'}
          </div>
        ) : (
          filteredCategories.map(cat => {
            const isEditing = editingId === cat.id;
            const isDeleting = deletingId === cat.id;

            return (
              <div
                key={cat.id}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                  isEditing
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-transparent hover:bg-muted/50',
                )}
              >
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                    />
                    <div className="flex items-center gap-1">
                      <div className="flex gap-1">
                        {COLOR_OPTIONS.map(color => (
                          <button
                            key={color}
                            onClick={() => setEditColor(color)}
                            className={cn(
                              'w-4 h-4 rounded-full transition-transform',
                              editColor === color && 'ring-2 ring-offset-1 ring-primary scale-110',
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="p-1.5 rounded-md hover:bg-primary/10 text-primary disabled:opacity-50 ml-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={saving}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="flex-1 text-xs truncate">{cat.name}</span>
                    {cat.item_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">({cat.item_count})</span>
                    )}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(cat)}
                        className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        disabled={isDeleting}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
