'use client';

import { useState, useTransition } from 'react';
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Edit3,
  X,
  ChevronUp,
  ChevronDown,
  Search,
  Filter,
  MessageSquare,
  Zap,
  GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { AutoReplyRule } from './types';

interface AutoReplySettingsProps {
  rules: AutoReplyRule[];
  onRulesChange: React.Dispatch<React.SetStateAction<AutoReplyRule[]>>;
}

export function AutoReplySettings({ rules, onRulesChange }: AutoReplySettingsProps) {
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoReplyRule | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [isPending, startTransition] = useTransition();
  const [newRule, setNewRule] = useState<{
    keyword: string;
    match_mode: 'exact' | 'fuzzy';
    reply_content: string;
    priority: number;
  }>({ keyword: '', match_mode: 'fuzzy', reply_content: '', priority: 0 });

  // Filter and sort rules
  const filteredRules = rules
    .filter((rule) => {
      if (filterMode === 'enabled' && !rule.is_enabled) return false;
      if (filterMode === 'disabled' && rule.is_enabled) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          rule.keyword.toLowerCase().includes(query) ||
          rule.reply_content.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => b.priority - a.priority);

  // Stats
  const enabledCount = rules.filter((r) => r.is_enabled).length;
  const disabledCount = rules.length - enabledCount;

  const handleToggleRule = (id: string, enabled: boolean) => {
    startTransition(async () => {
      onRulesChange((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: enabled } : r)));
      try {
        const res = await fetch('/api/auto-reply', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, is_enabled: enabled }),
        });
        if (!res.ok) {
          onRulesChange((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: !enabled } : r)));
          toast.error('更新失败');
        } else {
          toast.success(enabled ? '规则已启用' : '规则已禁用');
        }
      } catch {
        onRulesChange((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: !enabled } : r)));
        toast.error('更新失败');
      }
    });
  };

  const handleDeleteRule = async () => {
    if (!deleteRuleId) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/auto-reply?id=${deleteRuleId}`, { method: 'DELETE' });
        if (res.ok) {
          onRulesChange((prev) => prev.filter((r) => r.id !== deleteRuleId));
          toast.success('规则已删除');
        } else {
          toast.error('删除失败');
        }
      } catch {
        toast.error('删除失败');
      }
      setDeleteRuleId(null);
    });
  };

  const handleAddRule = async () => {
    if (!newRule.keyword || !newRule.reply_content) return;
    try {
      const res = await fetch('/api/auto-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newRule, is_enabled: true }),
      });
      const data = await res.json();
      if (data.rule) {
        onRulesChange((prev) => [...prev, data.rule]);
        setShowAddRule(false);
        setNewRule({ keyword: '', match_mode: 'fuzzy', reply_content: '', priority: 0 });
        toast.success('规则已添加');
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch {
      toast.error('添加失败');
    }
  };

  const handleUpdateRule = async () => {
    if (!editingRule) return;
    if (!editingRule.keyword || !editingRule.reply_content) {
      toast.error('请填写完整信息');
      return;
    }
    try {
      const res = await fetch('/api/auto-reply', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRule.id,
          keyword: editingRule.keyword,
          match_mode: editingRule.match_mode,
          reply_content: editingRule.reply_content,
          priority: editingRule.priority,
          is_enabled: editingRule.is_enabled,
        }),
      });
      const data = await res.json();
      if (data.rule) {
        onRulesChange((prev) => prev.map((r) => (r.id === editingRule.id ? data.rule : r)));
        setEditingRule(null);
        toast.success('规则已更新');
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch {
      toast.error('更新失败');
    }
  };

  const handlePriorityChange = (id: string, direction: 'up' | 'down') => {
    const currentRule = rules.find((r) => r.id === id);
    if (!currentRule) return;

    const otherRule = direction === 'up'
      ? rules.find((r) => r.priority > currentRule.priority && r.priority <= currentRule.priority + 5)
      : rules.find((r) => r.priority < currentRule.priority && r.priority >= currentRule.priority - 5);

    if (!otherRule) return;

    startTransition(async () => {
      const updatedRules = rules.map((r) => {
        if (r.id === id) return { ...r, priority: otherRule.priority };
        if (r.id === otherRule.id) return { ...r, priority: currentRule.priority };
        return r;
      });
      onRulesChange(updatedRules);

      try {
        await Promise.all([
          fetch('/api/auto-reply', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, priority: otherRule.priority }),
          }),
          fetch('/api/auto-reply', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: otherRule.id, priority: currentRule.priority }),
          }),
        ]);
      } catch {
        onRulesChange(rules);
        toast.error('调整优先级失败');
      }
    });
  };

  const getTopPriority = () => Math.max(...rules.map((r) => r.priority), 0);
  const getBottomPriority = () => Math.min(...rules.map((r) => r.priority), 0);

  const getPriorityColor = (priority: number, max: number) => {
    const ratio = priority / max;
    if (ratio >= 0.8) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (ratio >= 0.5) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  };

  const maxPriority = getTopPriority();

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            自动回复规则
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">设置关键词匹配，自动回复常见问题</p>
        </div>
        <button
          onClick={() => setShowAddRule(true)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium',
            'hover:bg-primary/90 transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-primary/50'
          )}
        >
          <Plus className="w-3 h-3" />
          添加规则
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-slate-200 dark:border-slate-700">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">规则总数</p>
                <p className="text-xl font-bold text-foreground">{rules.length}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-800">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">已启用</p>
                <p className="text-xl font-bold text-green-600 dark:text-green-400">{enabledCount}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <ToggleRight className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-800">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">已禁用</p>
                <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{disabledCount}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                <ToggleLeft className="w-5 h-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索关键词或回复内容..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-muted border border-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setFilterMode('all')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
              filterMode === 'all'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            全部
          </button>
          <button
            onClick={() => setFilterMode('enabled')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
              filterMode === 'enabled'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            已启用
          </button>
          <button
            onClick={() => setFilterMode('disabled')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
              filterMode === 'disabled'
                ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            已禁用
          </button>
        </div>
      </div>

      {/* Add Rule Form */}
      {showAddRule && (
        <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10 animate-in slide-in-from-top-2 duration-200 border-0">
          <CardContent className="!px-4 !py-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                新建规则
              </h3>
              <button
                onClick={() => setShowAddRule(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label className="text-xs font-medium text-foreground mb-1.5 block">关键词 *</label>
                <input
                  type="text"
                  value={newRule.keyword}
                  onChange={(e) => setNewRule((prev) => ({ ...prev, keyword: e.target.value }))}
                  placeholder="触发关键词"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">匹配模式</label>
                <select
                  value={newRule.match_mode}
                  onChange={(e) => setNewRule((prev) => ({ ...prev, match_mode: e.target.value as 'exact' | 'fuzzy' }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="fuzzy">模糊匹配</option>
                  <option value="exact">精确匹配</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">优先级</label>
                <input
                  type="number"
                  value={newRule.priority}
                  onChange={(e) => setNewRule((prev) => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                  placeholder="数值越大越优先"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-foreground mb-1.5 block">回复内容 *</label>
              <textarea
                value={newRule.reply_content}
                onChange={(e) => setNewRule((prev) => ({ ...prev, reply_content: e.target.value }))}
                placeholder="自动回复内容..."
                rows={3}
                className="w-full resize-none px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
            </div>
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">当前最高优先级: {getTopPriority()}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddRule(false)}
                  className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleAddRule}
                  disabled={!newRule.keyword || !newRule.reply_content}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  保存
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Rule Form */}
      {editingRule && (
        <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10 animate-in slide-in-from-top-2 duration-200 border-0">
          <CardContent className="!px-4 !py-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-primary" />
                编辑规则
              </h3>
              <button
                onClick={() => setEditingRule(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label className="text-xs font-medium text-foreground mb-1.5 block">关键词 *</label>
                <input
                  type="text"
                  value={editingRule.keyword}
                  onChange={(e) => setEditingRule((prev) => prev ? { ...prev, keyword: e.target.value } : null)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">匹配模式</label>
                <select
                  value={editingRule.match_mode}
                  onChange={(e) => setEditingRule((prev) => prev ? { ...prev, match_mode: e.target.value as 'exact' | 'fuzzy' } : null)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="fuzzy">模糊匹配</option>
                  <option value="exact">精确匹配</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">优先级</label>
                <input
                  type="number"
                  value={editingRule.priority}
                  onChange={(e) => setEditingRule((prev) => prev ? { ...prev, priority: parseInt(e.target.value) || 0 } : null)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-foreground mb-1.5 block">回复内容 *</label>
              <textarea
                value={editingRule.reply_content}
                onChange={(e) => setEditingRule((prev) => prev ? { ...prev, reply_content: e.target.value } : null)}
                rows={3}
                className="w-full resize-none px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setEditingRule(null)}
                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleUpdateRule}
                disabled={!editingRule.keyword || !editingRule.reply_content}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存修改
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules List */}
      <div className="space-y-2">
        {filteredRules.map((rule, index) => (
          <Card
            key={rule.id}
            className={cn(
              'transition-all duration-200 hover:shadow-md group bg-gradient-to-br from-card to-muted/20 shadow-sm border-0',
              !rule.is_enabled && 'opacity-60'
            )}
          >
            <CardContent className="!px-4 !py-3">
              <div className="flex items-start gap-4">
                {/* Priority Column */}
                <div className="flex flex-col items-center gap-0.5 shrink-0 pt-1">
                  <button
                    onClick={() => handlePriorityChange(rule.id, 'up')}
                    disabled={rule.priority >= maxPriority}
                    className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    title="提高优先级"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'font-mono text-xs px-2 py-0.5',
                      getPriorityColor(rule.priority, maxPriority || 1)
                    )}
                  >
                    {rule.priority}
                  </Badge>
                  <button
                    onClick={() => handlePriorityChange(rule.id, 'down')}
                    disabled={rule.priority <= getBottomPriority()}
                    className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                    title="降低优先级"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Drag Handle */}
                <div className="shrink-0 pt-1 cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-4 h-4 text-muted-foreground/30" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-foreground">{rule.keyword}</span>
                    <Badge
                      variant={rule.match_mode === 'exact' ? 'default' : 'outline'}
                      className={cn(
                        'text-xs',
                        rule.match_mode === 'exact'
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : ''
                      )}
                    >
                      {rule.match_mode === 'exact' ? '精确匹配' : '模糊匹配'}
                    </Badge>
                    {!rule.is_enabled && (
                      <Badge variant="outline" className="text-xs border-orange-200 text-orange-600 dark:border-orange-800 dark:text-orange-400">
                        已禁用
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">#{index + 1}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {rule.reply_content}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setEditingRule(rule)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="编辑"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleRule(rule.id, !rule.is_enabled)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                    title={rule.is_enabled ? '禁用' : '启用'}
                  >
                    {rule.is_enabled ? (
                      <ToggleRight className="w-5 h-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    onClick={() => setDeleteRuleId(rule.id)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Empty State */}
        {filteredRules.length === 0 && (
          <Card className="border-dashed border-0 bg-gradient-to-br from-card to-muted/10">
            <CardContent className="py-12">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                  <MessageSquare className="w-8 h-8 text-muted-foreground/50" />
                </div>
                <h3 className="text-sm font-medium text-foreground mb-1">
                  {searchQuery || filterMode !== 'all' ? '没有找到匹配的规则' : '暂无自动回复规则'}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {searchQuery || filterMode !== 'all'
                    ? '尝试调整搜索条件或筛选器'
                    : '点击「添加规则」创建第一条自动回复规则'}
                </p>
                {!searchQuery && filterMode === 'all' && (
                  <button
                    onClick={() => setShowAddRule(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    添加规则
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteRuleId !== null} onOpenChange={() => setDeleteRuleId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这条自动回复规则吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteRuleId(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRule}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
