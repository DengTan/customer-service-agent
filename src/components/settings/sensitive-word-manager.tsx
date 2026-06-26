'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { X, Plus, Trash2, ToggleLeft, ToggleRight, Search, Edit3, Upload, Download, CheckSquare, Square, ShieldAlert, ShieldCheck, AlertTriangle, Filter } from 'lucide-react';
import { logger as appLogger } from '@/lib/logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SensitiveWord {
  id: string;
  word: string;
  match_mode: 'exact' | 'fuzzy';
  action: 'block' | 'replace' | 'warn';
  replacement?: string | null;
  category?: string | null;
  is_enabled: boolean;
  hit_count: number;
  created_at: string;
}

interface SensitiveWordManagerProps {
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

const CATEGORIES = ['脏话', '政治', '广告', '其他'];
const ACTION_LABELS = {
  block: '阻止',
  replace: '替换',
  warn: '警告',
};
const ACTION_COLORS = {
  block: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  replace: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  warn: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};
const CATEGORY_COLORS = {
  '脏话': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  '政治': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  '广告': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  '其他': 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

export default function SensitiveWordManager({ open, onClose, onCountChange }: SensitiveWordManagerProps) {
  const [words, setWords] = useState<SensitiveWord[]>([]);
  const [allWords, setAllWords] = useState<SensitiveWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingWord, setEditingWord] = useState<SensitiveWord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    word: '',
    match_mode: 'exact' as 'exact' | 'fuzzy',
    action: 'block' as 'block' | 'replace' | 'warn',
    replacement: '',
    category: '脏话',
  });

  // Stats
  const stats = {
    total: allWords.length,
    active: allWords.filter(w => w.is_enabled).length,
    blocked: allWords.filter(w => w.action === 'block' && w.is_enabled).length,
    replaced: allWords.filter(w => w.action === 'replace' && w.is_enabled).length,
    warned: allWords.filter(w => w.action === 'warn' && w.is_enabled).length,
    totalHits: allWords.reduce((sum, w) => sum + w.hit_count, 0),
    byCategory: CATEGORIES.reduce((acc, cat) => {
      acc[cat] = allWords.filter(w => w.category === cat).length;
      return acc;
    }, {} as Record<string, number>),
  };

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content-filter/sensitive-words');
      const data = await res.json();
      const wordsList: SensitiveWord[] = data.words || [];
      setAllWords(wordsList);
      
      // Apply filters
      let filtered = wordsList;
      if (categoryFilter) {
        filtered = filtered.filter(w => w.category === categoryFilter);
      }
      if (searchQuery) {
        filtered = filtered.filter(w =>
          w.word.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      setWords(filtered);
      onCountChange(wordsList.length);
    } catch (err) {
      appLogger.warn('Failed to load sensitive words', { error: err });
      toast.error('加载敏感词失败');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, searchQuery, onCountChange]);

  useEffect(() => {
    if (open) {
      loadWords();
    }
  }, [open, loadWords]);

  const handleSubmit = async () => {
    if (!formData.word.trim()) {
      toast.error('请输入敏感词');
      return;
    }
    if (formData.action === 'replace' && !formData.replacement.trim()) {
      toast.error('请输入替换词');
      return;
    }

    try {
      const payload = {
        word: formData.word.trim(),
        match_mode: formData.match_mode,
        action: formData.action,
        replacement: formData.action === 'replace' ? formData.replacement.trim() : null,
        category: formData.category,
        is_enabled: true,
      };

      let res: Response;
      if (editingWord) {
        res = await fetch('/api/content-filter/sensitive-words', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingWord.id, ...payload }),
        });
      } else {
        res = await fetch('/api/content-filter/sensitive-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        toast.success(editingWord ? '敏感词已更新' : '敏感词已添加');
        resetForm();
        loadWords();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      } else {
        const data = await res.json();
        toast.error(data.error || '操作失败');
      }
    } catch (err) {
      appLogger.warn('Failed to save sensitive word', { error: err });
      toast.error('保存敏感词失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此敏感词？')) return;
    try {
      const res = await fetch(`/api/content-filter/sensitive-words?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('敏感词已删除');
        loadWords();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      appLogger.warn('Failed to delete sensitive word', { error: err });
      toast.error('删除敏感词失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要删除的敏感词');
      return;
    }
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个敏感词？`)) return;
    
    try {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map(id =>
          fetch(`/api/content-filter/sensitive-words?id=${id}`, { method: 'DELETE' })
        )
      );
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      const failed = results.length - succeeded;
      if (failed > 0) {
        toast.warning(`已删除 ${succeeded} 个，${failed} 个失败`);
      } else {
        toast.success(`已删除 ${succeeded} 个敏感词`);
      }
      setSelectedIds(new Set());
      loadWords();
    } catch (err) {
      appLogger.warn('Failed to batch delete', { error: err });
      toast.error('批量删除失败');
    }
  };

  const handleBatchToggle = async (enable: boolean) => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要操作的敏感词');
      return;
    }
    
    try {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map(id =>
          fetch('/api/content-filter/sensitive-words', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, is_enabled: enable }),
          })
        )
      );
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      const failed = results.length - succeeded;
      if (failed > 0) {
        toast.warning(`已${enable ? '启用' : '禁用'} ${succeeded} 个，${failed} 个失败`);
      } else {
        toast.success(`已${enable ? '启用' : '禁用'} ${succeeded} 个敏感词`);
      }
      setSelectedIds(new Set());
      loadWords();
    } catch (err) {
      appLogger.warn('Failed to batch toggle', { error: err });
      toast.error('批量操作失败');
    }
  };

  const handleToggle = async (word: SensitiveWord) => {
    try {
      const res = await fetch('/api/content-filter/sensitive-words', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: word.id, is_enabled: !word.is_enabled }),
      });
      if (res.ok) {
        loadWords();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      }
    } catch (err) {
      appLogger.warn('Failed to toggle sensitive word', { error: err });
    }
  };

  const handleExport = () => {
    const exportData = words.map(w => ({
      word: w.word,
      match_mode: w.match_mode,
      action: w.action,
      replacement: w.replacement || '',
      category: w.category || '其他',
      is_enabled: w.is_enabled ? '是' : '否',
    }));
    
    const csv = [
      ['敏感词', '匹配模式', '处理动作', '替换词', '分类', '是否启用'].join(','),
      ...exportData.map(row => [
        row.word,
        row.match_mode === 'exact' ? '精确匹配' : '模糊匹配',
        ACTION_LABELS[row.action],
        row.replacement,
        row.category,
        row.is_enabled,
      ].join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `敏感词列表_${new Date().toLocaleDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出成功');
  };

  const resetForm = () => {
    setShowAddForm(false);
    setEditingWord(null);
    setFormData({
      word: '',
      match_mode: 'exact',
      action: 'block',
      replacement: '',
      category: '脏话',
    });
  };

  const startEdit = (word: SensitiveWord) => {
    setEditingWord(word);
    setFormData({
      word: word.word,
      match_mode: word.match_mode,
      action: word.action,
      replacement: word.replacement || '',
      category: word.category || '脏话',
    });
    setShowAddForm(true);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === words.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(words.map(w => w.id)));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">敏感词管理</h2>
            <p className="text-xs text-muted-foreground mt-0.5">配置消息敏感词过滤规则</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Stats Cards */}
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <div className="grid grid-cols-6 gap-3">
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">总计</span>
              </div>
              <div className="text-xl font-bold text-foreground">{stats.total}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">启用</span>
              </div>
              <div className="text-xl font-bold text-primary">{stats.active}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-xs text-muted-foreground">阻止</span>
              </div>
              <div className="text-xl font-bold text-red-600 dark:text-red-400">{stats.blocked}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground">替换</span>
              </div>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.replaced}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground">警告</span>
              </div>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">{stats.warned}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground">总命中</span>
              </div>
              <div className="text-xl font-bold text-foreground">{stats.totalHits}</div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索敏感词..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Select value={categoryFilter || 'all'} onValueChange={(v) => setCategoryFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[160px]">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  <div className="flex items-center justify-between gap-4">
                    <span>{cat}</span>
                    <span className="text-muted-foreground">({stats.byCategory[cat]})</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-sm hover:bg-muted/80 transition-colors"
            title="导出 CSV"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => toast.info('导入功能开发中')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-sm hover:bg-muted/80 transition-colors"
            title="导入"
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>

        {/* Batch Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 bg-primary/5 border-b border-primary/20">
            <span className="text-sm text-primary font-medium">已选择 {selectedIds.size} 项</span>
            <button
              onClick={() => handleBatchToggle(true)}
              className="text-xs text-primary hover:underline"
            >
              批量启用
            </button>
            <button
              onClick={() => handleBatchToggle(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              批量禁用
            </button>
            <button
              onClick={handleBatchDelete}
              className="text-xs text-destructive hover:underline"
            >
              批量删除
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground ml-auto"
            >
              取消选择
            </button>
          </div>
        )}

        {/* Add/Edit Form */}
        {showAddForm && (
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">敏感词 *</label>
                <input
                  type="text"
                  value={formData.word}
                  onChange={(e) => setFormData((prev) => ({ ...prev, word: e.target.value }))}
                  placeholder="输入敏感词"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">分类</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">匹配模式</label>
                <select
                  value={formData.match_mode}
                  onChange={(e) => setFormData((prev) => ({ ...prev, match_mode: e.target.value as 'exact' | 'fuzzy' }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="exact">精确匹配</option>
                  <option value="fuzzy">模糊匹配</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">处理动作</label>
                <select
                  value={formData.action}
                  onChange={(e) => setFormData((prev) => ({ ...prev, action: e.target.value as 'block' | 'replace' | 'warn' }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="block">阻止</option>
                  <option value="replace">替换</option>
                  <option value="warn">警告</option>
                </select>
              </div>
              {formData.action === 'replace' && (
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">替换词 *</label>
                  <input
                    type="text"
                    value={formData.replacement}
                    onChange={(e) => setFormData((prev) => ({ ...prev, replacement: e.target.value }))}
                    placeholder="输入替换词"
                    className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={resetForm}
                className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                {editingWord ? '保存修改' : '添加'}
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">加载中...</div>
          ) : words.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {searchQuery || categoryFilter ? '未找到匹配的敏感词' : '暂无敏感词，点击添加按钮创建'}
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Header Row */}
              <div className="grid grid-cols-[40px_1fr_100px_100px_80px_100px_80px] gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <div className="flex items-center">
                  <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground">
                    {selectedIds.size === words.length && words.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div>敏感词</div>
                <div>分类</div>
                <div>动作</div>
                <div>匹配</div>
                <div>命中</div>
                <div className="text-right">操作</div>
              </div>
              {/* Data Rows */}
              <div className="divide-y divide-border">
                {words.map((word) => (
                  <div
                    key={word.id}
                    className={`grid grid-cols-[40px_1fr_100px_100px_80px_100px_80px] gap-2 px-4 py-3 items-center hover:bg-muted/30 transition-colors ${
                      !word.is_enabled ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      <button onClick={() => toggleSelect(word.id)} className="text-muted-foreground hover:text-foreground">
                        {selectedIds.has(word.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${word.is_enabled ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                        {word.word}
                      </span>
                      {word.action === 'replace' && word.replacement && (
                        <span className="text-xs text-muted-foreground">
                          → {word.replacement}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[word.category as keyof typeof CATEGORY_COLORS] || CATEGORY_COLORS['其他']}`}>
                        {word.category || '其他'}
                      </span>
                    </div>
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${ACTION_COLORS[word.action]}`}>
                        {ACTION_LABELS[word.action]}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">
                        {word.match_mode === 'exact' ? '精确' : '模糊'}
                      </span>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        {word.hit_count}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggle(word)}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title={word.is_enabled ? '禁用' : '启用'}
                      >
                        {word.is_enabled ? (
                          <ToggleRight className="w-5 h-5 text-primary" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        onClick={() => startEdit(word)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(word.id)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
