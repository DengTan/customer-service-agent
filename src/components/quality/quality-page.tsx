'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import AppLayout from '@/components/app-layout';
import { Search, Plus, Tag, Shield, ClipboardCheck, Edit2, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { ConversationTagDef, QualityRule, QualityCheck } from '@/lib/types';

const TAG_CATEGORY_LABELS: Record<string, string> = {
  question_type: '问题类型',
  sentiment: '情绪',
  business_line: '业务线',
};

const TAG_CATEGORY_COLORS: Record<string, string> = {
  question_type: 'bg-primary/10 text-primary',
  sentiment: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  business_line: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
};

const RULE_TYPE_LABELS: Record<string, string> = {
  first_response_timeout: '首响超时',
  keyword_violation: '关键词违规',
  satisfaction_below: '满意度低于阈值',
  high_turn_count: '高轮次告警',
  negative_sentiment: '负面情绪检测',
};

const TAG_COLORS = ['#2F6BFF', '#DC2626', '#F97316', '#16A37B', '#8B5CF6', '#06B6D4', '#D4A017', '#E11D48'];

export function QualityPage() {
  const [activeTab, setActiveTab] = useState<'tags' | 'rules' | 'checks'>('tags');

  // Tags state
  const [tags, setTags] = useState<ConversationTagDef[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagForm, setTagForm] = useState({ name: '', color: '#2F6BFF', category: 'question_type' });

  // Rules state
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [ruleFilter, setRuleFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', type: 'first_response_timeout', config_text: '{}', is_enabled: true });

  // Checks state
  const [checks, setChecks] = useState<QualityCheck[]>([]);
  const [checkFilter, setCheckFilter] = useState({ result: 'all', type: 'all' });

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/conversation-tags');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTags(data.tags || []);
    } catch (e) { console.error(e); }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/quality-checks?list=rules');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRules(data.rules || []);
    } catch (e) { console.error(e); }
  }, []);

  const fetchChecks = useCallback(async () => {
    try {
      const res = await fetch('/api/quality-checks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChecks(data.checks || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    fetchTags();
    fetchRules();
    fetchChecks();
  }, [fetchTags, fetchRules, fetchChecks]);

  // Tag CRUD
  const handleCreateTag = async () => {
    try {
      const res = await fetch('/api/conversation-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tagForm),
      });
      if (!res.ok) {
        toast.error('创建标签失败');
        return;
      }
      setTagDialogOpen(false);
      setTagForm({ name: '', color: '#2F6BFF', category: 'question_type' });
      fetchTags();
    } catch (e) { console.error(e); }
  };

  const handleDeleteTag = async (id: string) => {
    if (!confirm('确定删除该标签？')) return;
    try {
      const res = await fetch(`/api/conversation-tags?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('删除标签失败');
        return;
      }
      fetchTags();
    } catch (e) { console.error(e); }
  };

  // Rule CRUD
  const handleCreateRule = async () => {
    try {
      const config = JSON.parse(ruleForm.config_text || '{}');
      const res = await fetch('/api/quality-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ruleForm.name, type: ruleForm.type, config, is_enabled: ruleForm.is_enabled }),
      });
      if (!res.ok) {
        toast.error('创建规则失败');
        return;
      }
      setRuleDialogOpen(false);
      setRuleForm({ name: '', type: 'first_response_timeout', config_text: '{}', is_enabled: true });
      fetchRules();
    } catch (e) { console.error(e); }
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/quality-checks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: !enabled }),
      });
      if (!res.ok) {
        toast.error('更新规则失败');
        return;
      }
      fetchRules();
    } catch (e) { console.error(e); }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('确定删除该规则？')) return;
    try {
      const res = await fetch(`/api/quality-checks?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('删除规则失败');
        return;
      }
      fetchRules();
    } catch (e) { console.error(e); }
  };

  // Filtered data
  const filteredTags = tags.filter(t =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const filteredRules = rules.filter(r => {
    if (ruleFilter === 'enabled') return r.is_enabled;
    if (ruleFilter === 'disabled') return !r.is_enabled;
    return true;
  });

  const filteredChecks = checks.filter(c => {
    if (checkFilter.result !== 'all' && c.result !== checkFilter.result) return false;
    if (checkFilter.type !== 'all') {
      const rule = rules.find(r => r.id === c.rule_id);
      if (rule?.type !== checkFilter.type) return false;
    }
    return true;
  });

  const clearFilters = () => {
    if (activeTab === 'tags') setTagSearch('');
    if (activeTab === 'rules') setRuleFilter('all');
    if (activeTab === 'checks') setCheckFilter({ result: 'all', type: 'all' });
  };

  const hasFilters = activeTab === 'tags' ? tagSearch : 
    activeTab === 'rules' ? ruleFilter !== 'all' :
    checkFilter.result !== 'all' || checkFilter.type !== 'all';

  const tabs = [
    { key: 'tags' as const, label: '对话标签', icon: Tag },
    { key: 'rules' as const, label: '质检规则', icon: Shield },
    { key: 'checks' as const, label: '质检记录', icon: ClipboardCheck },
  ];

  return (
    <AppLayout>
      <div className="h-full flex flex-col page-transition">
        {/* Header */}
        <div className="h-14 border-b border-border px-6 flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-foreground">质检管理</h1>
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-muted rounded-xl p-0.5 ml-4">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeTab === tab.key
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <Button 
            onClick={() => activeTab === 'tags' ? setTagDialogOpen(true) : setRuleDialogOpen(true)} 
            size="sm" 
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {activeTab === 'tags' ? '创建标签' : '创建规则'}
          </Button>
        </div>

      {/* Tab: Tags */}
      {activeTab === 'tags' && (
        <>
          {/* Filters */}
          <div className="px-6 py-4 border-b border-border/50 bg-card/50 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 max-w-sm min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="搜索标签..."
                  value={tagSearch}
                  onChange={e => setTagSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-3 h-3" />
                  清除筛选
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTags.map(tag => (
                <div key={tag.id} className="border border-border rounded-xl bg-card overflow-hidden card-hover-lift">
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="font-medium text-sm text-foreground">{tag.name}</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="编辑"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          onClick={() => handleDeleteTag(tag.id)}
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Badge variant="secondary" className={TAG_CATEGORY_COLORS[tag.category] || ''}>
                        {TAG_CATEGORY_LABELS[tag.category] || tag.category}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        关联 {tag.conversation_count || 0} 个对话
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filteredTags.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {tagSearch ? '未找到匹配的标签' : '暂无标签，点击创建'}
              </div>
            )}
          </div>
        </>
      )}

      {/* Tab: Rules */}
      {activeTab === 'rules' && (
        <>
          {/* Filters */}
          <div className="px-6 py-4 border-b border-border/50 bg-card/50 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {(['all', 'enabled', 'disabled'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setRuleFilter(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      ruleFilter === f
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f === 'all' ? '全部' : f === 'enabled' ? '已启用' : '已禁用'}
                  </button>
                ))}
              </div>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-3 h-3" />
                  清除筛选
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="border border-border rounded-xl bg-card overflow-hidden max-w-4xl">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">规则名称</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">类型</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">触发条件</th>
                    <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3 w-24">状态</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 w-20">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.map((rule, idx) => {
                    const configObj = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;
                    const configDesc = Object.entries(configObj as Record<string, unknown>)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(', ') || '无';

                    return (
                      <tr key={rule.id} className={idx !== filteredRules.length - 1 ? 'border-b border-border/50' : ''}>
                        <td className="px-5 py-3.5 text-sm font-medium text-foreground">{rule.name}</td>
                        <td className="px-4 py-3.5">
                          <Badge variant="secondary">
                            {RULE_TYPE_LABELS[rule.type] || rule.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-muted-foreground">{configDesc}</td>
                        <td className="px-4 py-3.5 text-center">
                          <Switch
                            checked={rule.is_enabled}
                            onCheckedChange={() => handleToggleRule(rule.id, rule.is_enabled)}
                          />
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button
                            className="inline-flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={() => handleDeleteRule(rule.id)}
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredRules.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">暂无质检规则</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Tab: Checks */}
      {activeTab === 'checks' && (
        <>
          {/* Filters */}
          <div className="px-6 py-4 border-b border-border/50 bg-card/50 shrink-0">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {(['all', 'pass', 'fail'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setCheckFilter(prev => ({ ...prev, result: r }))}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      checkFilter.result === r
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r === 'all' ? '全部结果' : r === 'pass' ? '通过' : '未通过'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setCheckFilter(prev => ({ ...prev, type: 'all' }))}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    checkFilter.type === 'all'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  全部类型
                </button>
                {Object.entries(RULE_TYPE_LABELS).slice(0, 3).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setCheckFilter(prev => ({ ...prev, type: k }))}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      checkFilter.type === k
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="w-3 h-3" />
                  清除筛选
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="border border-border rounded-xl bg-card overflow-hidden max-w-4xl">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">对话ID</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">规则名称</th>
                    <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3 w-20">结果</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">详情</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 w-36">检测时间</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChecks.map((check, idx) => {
                    const rule = rules.find(r => r.id === check.rule_id);
                    return (
                      <tr key={check.id} className={idx !== filteredChecks.length - 1 ? 'border-b border-border/50' : ''}>
                        <td className="px-5 py-3.5">
                          <span className="text-sm font-mono text-primary cursor-pointer hover:underline">
                            {check.conversation_id?.substring(0, 8)}...
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-foreground">{rule?.name || '未知规则'}</td>
                        <td className="px-4 py-3.5 text-center">
                          <Badge variant={check.result === 'pass' ? 'secondary' : 'destructive'} className={check.result === 'pass' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : ''}>
                            {check.result === 'pass' ? '通过' : '未通过'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-muted-foreground">{check.detail || '-'}</td>
                        <td className="px-4 py-3.5 text-right text-sm text-muted-foreground">
                          {new Date(check.created_at).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredChecks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">暂无质检记录</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Tag Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">创建对话标签</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">标签名称</label>
              <input
                type="text"
                placeholder="输入标签名称"
                value={tagForm.name}
                onChange={e => setTagForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">颜色</label>
              <div className="flex gap-2">
                {TAG_COLORS.map(color => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      tagForm.color === color ? 'border-foreground scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setTagForm(prev => ({ ...prev, color }))}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">分类</label>
              <Select value={tagForm.category} onValueChange={v => setTagForm(prev => ({ ...prev, category: v }))}>
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="question_type">问题类型</SelectItem>
                  <SelectItem value="sentiment">情绪</SelectItem>
                  <SelectItem value="business_line">业务线</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTagDialogOpen(false)} className="rounded-lg">取消</Button>
            <Button onClick={handleCreateTag} disabled={!tagForm.name.trim()} className="rounded-lg">创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">创建质检规则</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">规则名称</label>
              <input
                type="text"
                placeholder="输入规则名称"
                value={ruleForm.name}
                onChange={e => setRuleForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">规则类型</label>
              <Select value={ruleForm.type} onValueChange={v => setRuleForm(prev => ({ ...prev, type: v }))}>
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">配置 (JSON)</label>
              <Textarea
                value={ruleForm.config_text}
                onChange={e => setRuleForm(prev => ({ ...prev, config_text: e.target.value }))}
                placeholder='{"threshold_minutes": 5}'
                rows={3}
                className="bg-muted border-none resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={ruleForm.is_enabled}
                onCheckedChange={v => setRuleForm(prev => ({ ...prev, is_enabled: v }))}
              />
              <label className="text-sm">启用规则</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRuleDialogOpen(false)} className="rounded-lg">取消</Button>
            <Button onClick={handleCreateRule} disabled={!ruleForm.name.trim()} className="rounded-lg">创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AppLayout>
  );
}
