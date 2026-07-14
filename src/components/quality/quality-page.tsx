'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import AppLayout from '@/components/app-layout';
import { Search, Plus, Tag, Shield, ClipboardCheck, Edit2, Trash2, RotateCcw, Loader2, BarChart3, TrendingUp, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import type { ConversationTagDef, QualityRule, QualityCheck } from '@/lib/types';
import { QUALITY_RULE_TYPE_LABELS } from '@/lib/types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

// Quality stats interface
interface QualityStats {
  overall: {
    total: number;
    pass_count: number;
    fail_count: number;
    pass_rate: number;
  };
  by_date: Array<{
    date: string;
    total: number;
    pass_count: number;
    fail_count: number;
    pass_rate: number;
  }>;
  by_rule: Array<{
    rule_type: string | null;
    rule_name: string | null;
    total: number;
    pass_count: number;
    fail_count: number;
    pass_rate: number;
  }>;
}

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

const TAG_COLORS = ['#2F6BFF', '#DC2626', '#F97316', '#16A37B', '#8B5CF6', '#06B6D4', '#D4A017', '#E11D48'];

// Chart colors
const CHART_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

// Quality stats date range options
const DATE_RANGE_OPTIONS = [
  { label: '最近7天', value: '7' },
  { label: '最近30天', value: '30' },
  { label: '最近90天', value: '90' },
];

// Rule type configuration for dynamic forms
interface RuleTypeConfig {
  label: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'tags' | 'select';
    placeholder?: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    defaultValue?: string | number | string[];
  }>;
  defaultConfig: Record<string, unknown>;
}

const RULE_TYPE_CONFIGS: Record<string, RuleTypeConfig> = {
  first_response_timeout: {
    label: '首响超时',
    description: '检测AI首次回复是否超过指定时间',
    fields: [
      {
        key: 'threshold_minutes',
        label: '超时阈值（分钟）',
        type: 'number',
        placeholder: '5',
        required: true,
        defaultValue: 5,
      },
    ],
    defaultConfig: { threshold_minutes: 5 },
  },
  keyword_violation: {
    label: '关键词违规',
    description: '检测AI回复中是否包含禁止关键词',
    fields: [
      {
        key: 'forbidden_keywords',
        label: '禁止关键词（用逗号分隔）',
        type: 'tags',
        placeholder: '输入关键词后按回车添加',
        required: true,
        defaultValue: [],
      },
    ],
    defaultConfig: { forbidden_keywords: [] },
  },
  satisfaction_below: {
    label: '满意度低于阈值',
    description: '当用户满意度评分低于指定阈值时触发',
    fields: [
      {
        key: 'threshold',
        label: '评分阈值（1-5星）',
        type: 'number',
        placeholder: '3',
        required: true,
        defaultValue: 3,
      },
    ],
    defaultConfig: { threshold: 3 },
  },
  high_turn_count: {
    label: '高轮次告警',
    description: '对话轮次超过指定数量时触发',
    fields: [
      {
        key: 'threshold',
        label: '轮次阈值',
        type: 'number',
        placeholder: '20',
        required: true,
        defaultValue: 20,
      },
    ],
    defaultConfig: { threshold: 20 },
  },
  negative_sentiment: {
    label: '负面情绪检测',
    description: '检测AI回复中是否包含负面情绪关键词',
    fields: [
      {
        key: 'negative_keywords',
        label: '负面关键词（用逗号分隔）',
        type: 'tags',
        placeholder: '输入关键词后按回车添加',
        required: true,
        defaultValue: [],
      },
    ],
    defaultConfig: { negative_keywords: [] },
  },
};

// Helper to build config from rule type
function buildConfigFromRuleType(ruleType: string, ruleForm: { type: string }): Record<string, unknown> {
  const config = RULE_TYPE_CONFIGS[ruleType]?.defaultConfig || {};
  // Preserve existing config values if editing
  return { ...config };
}

export function QualityPage() {
  const [activeTab, setActiveTab] = useState<'tags' | 'rules' | 'checks' | 'stats'>('tags');

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Tags state
  const [tags, setTags] = useState<ConversationTagDef[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<ConversationTagDef | null>(null);
  const [tagForm, setTagForm] = useState({ name: '', color: '#2F6BFF', category: 'question_type' });

  // Rules state
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [ruleFilter, setRuleFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QualityRule | null>(null);
  const [ruleForm, setRuleForm] = useState({ 
    name: '', 
    type: 'first_response_timeout', 
    config: {} as Record<string, unknown>,
    is_enabled: true 
  });
  
  // State for dynamic keyword tags input
  const [keywordInput, setKeywordInput] = useState('');

  // Checks state
  const [checks, setChecks] = useState<QualityCheck[]>([]);
  const [checkFilter, setCheckFilter] = useState({ result: 'all', type: 'all' });
  const [checkDetailDialogOpen, setCheckDetailDialogOpen] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState<QualityCheck | null>(null);

  // Stats state
  const [stats, setStats] = useState<QualityStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [dateRange, setDateRange] = useState('30');

  // Loading states for delete operations
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/conversation-tags');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTags(data.tags || []);
    } catch (e) { logger.error('Unexpected error', { error: e }); }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/quality-checks?list=rules');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRules(data.rules || []);
    } catch (e) { logger.error('Unexpected error', { error: e }); }
  }, []);

  const fetchChecks = useCallback(async () => {
    try {
      const res = await fetch('/api/quality-checks?type=records');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChecks(data.records || []);
    } catch (e) { logger.error('Unexpected error', { error: e }); }
  }, []);

  const fetchStats = useCallback(async (days: string) => {
    setStatsLoading(true);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await fetch(`/api/quality-checks/stats?start_date=${startDate}&end_date=${endDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data.data || null);
    } catch (e) {
      logger.error('Failed to fetch quality stats', { error: e });
      toast.error('获取质检统计数据失败');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
    fetchRules();
    fetchChecks();
  }, [fetchTags, fetchRules, fetchChecks]);

  // Fetch stats when switching to stats tab
  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStats(dateRange);
    }
  }, [activeTab, dateRange, fetchStats]);
  const openEditTagDialog = (tag: ConversationTagDef) => {
    setEditingTag(tag);
    setTagForm({
      name: tag.name,
      color: tag.color,
      category: tag.category,
    });
    setTagDialogOpen(true);
  };

  const handleSaveTag = async () => {
    try {
      const res = await fetch('/api/conversation-tags', {
        method: editingTag ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTag?.id,
          name: tagForm.name,
          color: tagForm.color,
          category: tagForm.category,
        }),
      });
      if (!res.ok) {
        toast.error(editingTag ? '更新标签失败' : '创建标签失败');
        return;
      }
      setTagDialogOpen(false);
      setEditingTag(null);
      setTagForm({ name: '', color: '#2F6BFF', category: 'question_type' });
      fetchTags();
    } catch (e) { logger.error('Unexpected error', { error: e }); }
  };

  const handleDeleteTag = async (id: string) => {
    const confirmed = await confirm({
      title: '删除标签',
      description: '确定删除该标签？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingTagId(id);
    try {
      const res = await fetch(`/api/conversation-tags?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('删除标签失败');
        return;
      }
      fetchTags();
    } catch (e) { logger.error('Unexpected error', { error: e }); }
    finally { setDeletingTagId(null); }
  };

  // Rule CRUD
  const openEditRuleDialog = (rule: QualityRule) => {
    const configObj = typeof rule.config === 'string' ? JSON.parse(rule.config) : (rule.config ?? {});
    setEditingRule(rule);
    setRuleForm({
      name: rule.name,
      type: rule.type,
      config: configObj,
      is_enabled: rule.is_enabled,
    });
    // Set keyword input for tags fields
    const keywordsField = RULE_TYPE_CONFIGS[rule.type]?.fields.find(f => f.type === 'tags');
    if (keywordsField && configObj[keywordsField.key]) {
      // Keywords are already in the config
    }
    setKeywordInput('');
    setRuleDialogOpen(true);
  };

  const handleRuleTypeChange = (newType: string) => {
    const defaultConfig = buildConfigFromRuleType(newType, ruleForm);
    setRuleForm(prev => ({
      ...prev,
      type: newType,
      config: defaultConfig,
    }));
    setKeywordInput('');
  };

  const handleSaveRule = async () => {
    try {
      const res = await fetch('/api/quality-checks', {
        method: editingRule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRule?.id,
          name: ruleForm.name,
          type: ruleForm.type,
          config: ruleForm.config,
          is_enabled: ruleForm.is_enabled,
        }),
      });
      if (!res.ok) {
        toast.error(editingRule ? '更新规则失败' : '创建规则失败');
        return;
      }
      setRuleDialogOpen(false);
      setEditingRule(null);
      setRuleForm({ name: '', type: 'first_response_timeout', config: buildConfigFromRuleType('first_response_timeout', ruleForm), is_enabled: true });
      setKeywordInput('');
      fetchRules();
    } catch (e) { logger.error('Unexpected error', { error: e }); }
  };

  const handleAddKeyword = (key: string) => {
    if (keywordInput.trim()) {
      const currentKeywords = (ruleForm.config[key] as string[]) || [];
      if (!currentKeywords.includes(keywordInput.trim())) {
        setRuleForm(prev => ({
          ...prev,
          config: {
            ...prev.config,
            [key]: [...currentKeywords, keywordInput.trim()],
          },
        }));
      }
      setKeywordInput('');
    }
  };

  const handleRemoveKeyword = (key: string, keyword: string) => {
    setRuleForm(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: (prev.config[key] as string[] || []).filter(k => k !== keyword),
      },
    }));
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
    } catch (e) { logger.error('Unexpected error', { error: e }); }
  };

  const handleDeleteRule = async (id: string) => {
    const confirmed = await confirm({
      title: '删除规则',
      description: '确定删除该规则？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    setDeletingRuleId(id);
    try {
      const res = await fetch(`/api/quality-checks?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('删除规则失败');
        return;
      }
      fetchRules();
    } catch (e) { logger.error('Unexpected error', { error: e }); }
    finally { setDeletingRuleId(null); }
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
    { key: 'stats' as const, label: '质检统计', icon: BarChart3 },
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
            onClick={() => {
              if (activeTab === 'tags') {
                setEditingTag(null);
                setTagForm({ name: '', color: '#2F6BFF', category: 'question_type' });
                setTagDialogOpen(true);
              } else if (activeTab === 'rules') {
                setEditingRule(null);
                setRuleForm({ name: '', type: 'first_response_timeout', config: buildConfigFromRuleType('first_response_timeout', ruleForm), is_enabled: true });
                setKeywordInput('');
                setRuleDialogOpen(true);
              }
            }}
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
                          onClick={() => openEditTagDialog(tag)}
                          title="编辑"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                          onClick={() => handleDeleteTag(tag.id)}
                          disabled={deletingTagId === tag.id}
                          title="删除"
                        >
                          {deletingTagId === tag.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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
                            {QUALITY_RULE_TYPE_LABELS[rule.type] || rule.type}
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
                          <div className="flex items-center justify-end gap-1">
                            <button
                              className="inline-flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              onClick={() => openEditRuleDialog(rule)}
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              className="inline-flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                              onClick={() => handleDeleteRule(rule.id)}
                              disabled={deletingRuleId === rule.id}
                              title="删除"
                            >
                              {deletingRuleId === rule.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
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
                {Object.entries(QUALITY_RULE_TYPE_LABELS).map(([k, v]) => (
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
                      <tr 
                        key={check.id} 
                        className={`${idx !== filteredChecks.length - 1 ? 'border-b border-border/50' : ''} cursor-pointer hover:bg-muted/50 transition-colors`}
                        onClick={() => {
                          setSelectedCheck(check);
                          setCheckDetailDialogOpen(true);
                        }}
                      >
                        <td className="px-5 py-3.5">
                          <span
                            className="text-sm font-mono text-primary cursor-pointer hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(check.conversation_id || '').catch(() => {});
                              toast.success('已复制对话ID');
                            }}
                            title="点击复制完整ID"
                          >
                            {check.conversation_id || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-foreground">{rule?.name || '未知规则'}</td>
                        <td className="px-4 py-3.5 text-center">
                          <Badge variant={check.result === 'pass' ? 'secondary' : 'destructive'} className={check.result === 'pass' ? 'bg-emerald-200 text-emerald-700 dark:text-emerald-400' : ''}>
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

      {/* Tab: Stats */}
      {activeTab === 'stats' && (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Date range selector */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-foreground">质检统计</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">时间范围：</span>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                {DATE_RANGE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setDateRange(opt.value)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      dateRange === opt.value
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {statsLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : stats ? (
            <>
              {/* Overall stats cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="border border-border rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">质检总数</span>
                  </div>
                  <div className="text-2xl font-bold text-foreground">{stats.overall.total}</div>
                </div>
                <div className="border border-border rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm text-muted-foreground">通过数</span>
                  </div>
                  <div className="text-2xl font-bold text-emerald-600">{stats.overall.pass_count}</div>
                </div>
                <div className="border border-border rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-muted-foreground">未通过数</span>
                  </div>
                  <div className="text-2xl font-bold text-red-600">{stats.overall.fail_count}</div>
                </div>
                <div className="border border-border rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-muted-foreground">通过率</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-600">{(stats.overall.pass_rate * 100).toFixed(1)}%</div>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Pass rate trend */}
                {stats.by_date.length > 0 && (
                  <div className="border border-border rounded-xl bg-card p-4">
                    <h3 className="text-sm font-medium text-foreground mb-4">通过率趋势</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={stats.by_date.slice(0, 14).reverse()}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                            tickFormatter={(value) => new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                          />
                          <YAxis 
                            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                            tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                            domain={[0, 1]}
                          />
                          <Tooltip 
                            formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, '通过率']}
                            labelFormatter={(label) => new Date(label).toLocaleDateString('zh-CN')}
                            contentStyle={{ 
                              backgroundColor: 'var(--card)', 
                              border: '1px solid var(--border)',
                              borderRadius: '8px'
                            }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="pass_rate" 
                            stroke="#22c55e" 
                            strokeWidth={2}
                            dot={{ fill: '#22c55e', r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Pass/Fail distribution */}
                <div className="border border-border rounded-xl bg-card p-4">
                  <h3 className="text-sm font-medium text-foreground mb-4">通过/未通过分布</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: '通过', value: stats.overall.pass_count },
                            { name: '未通过', value: stats.overall.fail_count },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                        >
                          <Cell fill="#22c55e" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'var(--card)', 
                            border: '1px solid var(--border)',
                            borderRadius: '8px'
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Fail count by rule */}
                {stats.by_rule.length > 0 && (
                  <div className="border border-border rounded-xl bg-card p-4 lg:col-span-2">
                    <h3 className="text-sm font-medium text-foreground mb-4">各规则未通过情况</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.by_rule} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                          <YAxis 
                            dataKey="rule_name" 
                            type="category" 
                            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                            width={120}
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'var(--card)', 
                              border: '1px solid var(--border)',
                              borderRadius: '8px'
                            }}
                          />
                          <Bar dataKey="fail_count" name="未通过数" fill="#ef4444" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="pass_count" name="通过数" fill="#22c55e" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mb-4" />
              <p>暂无质检统计数据</p>
            </div>
          )}
        </div>
      )}

      {/* Tag Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={(open) => {
        setTagDialogOpen(open);
        if (!open) {
          setEditingTag(null);
          setTagForm({ name: '', color: '#2F6BFF', category: 'question_type' });
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{editingTag ? '编辑对话标签' : '创建对话标签'}</DialogTitle>
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
            <Button onClick={handleSaveTag} disabled={!tagForm.name.trim()} className="rounded-lg">{editingTag ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rule Dialog */}
      <Dialog open={ruleDialogOpen} onOpenChange={(open) => {
        setRuleDialogOpen(open);
        if (!open) {
          setEditingRule(null);
          setRuleForm({ name: '', type: 'first_response_timeout', config: buildConfigFromRuleType('first_response_timeout', ruleForm), is_enabled: true });
          setKeywordInput('');
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{editingRule ? '编辑质检规则' : '创建质检规则'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
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
              <Select 
                value={ruleForm.type} 
                onValueChange={v => {
                  handleRuleTypeChange(v);
                }}
              >
                <SelectTrigger className="bg-muted border-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RULE_TYPE_CONFIGS).map(([k, config]) => (
                    <SelectItem key={k} value={k}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ruleForm.type && RULE_TYPE_CONFIGS[ruleForm.type] && (
                <p className="text-xs text-muted-foreground mt-1">
                  {RULE_TYPE_CONFIGS[ruleForm.type].description}
                </p>
              )}
            </div>

            {/* Dynamic config fields based on rule type */}
            {ruleForm.type && RULE_TYPE_CONFIGS[ruleForm.type] && (
              <div className="space-y-4 border-t border-border pt-4">
                <h4 className="text-sm font-medium text-foreground">规则配置</h4>
                {RULE_TYPE_CONFIGS[ruleForm.type].fields.map(field => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">{field.label}</label>
                    
                    {field.type === 'number' && (
                      <Input
                        type="number"
                        placeholder={field.placeholder}
                        value={(ruleForm.config[field.key] as number) || ''}
                        onChange={e => setRuleForm(prev => ({
                          ...prev,
                          config: { ...prev.config, [field.key]: parseInt(e.target.value) || 0 },
                        }))}
                        className="bg-muted"
                      />
                    )}
                    
                    {field.type === 'text' && (
                      <Input
                        type="text"
                        placeholder={field.placeholder}
                        value={(ruleForm.config[field.key] as string) || ''}
                        onChange={e => setRuleForm(prev => ({
                          ...prev,
                          config: { ...prev.config, [field.key]: e.target.value },
                        }))}
                        className="bg-muted"
                      />
                    )}
                    
                    {field.type === 'tags' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            placeholder={field.placeholder}
                            value={keywordInput}
                            onChange={e => setKeywordInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddKeyword(field.key);
                              }
                            }}
                            className="bg-muted"
                          />
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleAddKeyword(field.key)}
                          >
                            添加
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(ruleForm.config[field.key] as string[] || []).map((keyword, idx) => (
                            <Badge key={idx} variant="secondary" className="gap-1 pr-1">
                              {keyword}
                              <button
                                type="button"
                                className="ml-1 hover:text-destructive"
                                onClick={() => handleRemoveKeyword(field.key, keyword)}
                              >
                                ×
                              </button>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {field.type === 'select' && (
                      <Select 
                        value={String(ruleForm.config[field.key] || field.defaultValue || '')} 
                        onValueChange={v => setRuleForm(prev => ({
                          ...prev,
                          config: { ...prev.config, [field.key]: v },
                        }))}
                      >
                        <SelectTrigger className="bg-muted border-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
              </div>
            )}

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
            <Button onClick={handleSaveRule} disabled={!ruleForm.name.trim()} className="rounded-lg">{editingRule ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check Detail Dialog */}
      <Dialog open={checkDetailDialogOpen} onOpenChange={(open) => {
        setCheckDetailDialogOpen(open);
        if (!open) setSelectedCheck(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">质检记录详情</DialogTitle>
          </DialogHeader>
          {selectedCheck && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">对话ID</label>
                  <div className="text-sm font-mono text-foreground break-all">
                    {selectedCheck.conversation_id || '-'}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">检测结果</label>
                  <div>
                    <Badge 
                      variant={selectedCheck.result === 'pass' ? 'secondary' : 'destructive'} 
                      className={selectedCheck.result === 'pass' ? 'bg-emerald-200 text-emerald-700 dark:text-emerald-400' : ''}
                    >
                      {selectedCheck.result === 'pass' ? '通过' : '未通过'}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">规则名称</label>
                  <div className="text-sm text-foreground">
                    {rules.find(r => r.id === selectedCheck.rule_id)?.name || '未知规则'}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">规则类型</label>
                  <div className="text-sm text-foreground">
                    {(() => {
                      const ruleType = rules.find(r => r.id === selectedCheck.rule_id)?.type;
                      return ruleType ? (QUALITY_RULE_TYPE_LABELS[ruleType] || ruleType) : '-';
                    })()}
                  </div>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-foreground">检测时间</label>
                  <div className="text-sm text-foreground">
                    {selectedCheck.created_at ? new Date(selectedCheck.created_at).toLocaleString('zh-CN') : '-'}
                  </div>
                </div>
              </div>
              
              {selectedCheck.detail && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">详情</label>
                  <div className={`text-sm p-3 rounded-lg ${
                    selectedCheck.result === 'fail' 
                      ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400' 
                      : 'bg-muted'
                  }`}>
                    {selectedCheck.detail}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCheckDetailDialogOpen(false)} className="rounded-lg">关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AppLayout>
  );
}
