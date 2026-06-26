'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { X, Plus, Trash2, ToggleLeft, ToggleRight, Search, Edit3, Globe, Upload, Download, CheckSquare, Square, ShieldCheck, Link, Clock, Zap, Filter, Loader2 } from 'lucide-react';
import { logger as appLogger } from '@/lib/logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AllowedDomain {
  id: string;
  domain: string;
  pattern_type: 'exact' | 'wildcard' | 'suffix';
  description?: string | null;
  is_enabled: boolean;
  hit_count: number;
  created_at: string;
}

interface DomainWhitelistManagerProps {
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

const PATTERN_TYPES = [
  { value: 'exact', label: '精确匹配', desc: '完整域名，如 shop.example.com' },
  { value: 'wildcard', label: '通配符', desc: '*.example.com 匹配所有子域名' },
  { value: 'suffix', label: '域名后缀', desc: 'example.com 匹配所有子域名' },
];

const COMMON_DOMAINS = [
  { domain: '*.taobao.com', pattern_type: 'wildcard', description: '淘宝' },
  { domain: '*.tmall.com', pattern_type: 'wildcard', description: '天猫' },
  { domain: '*.jd.com', pattern_type: 'wildcard', description: '京东' },
  { domain: '*.alipay.com', pattern_type: 'wildcard', description: '支付宝' },
  { domain: '*.weixin.qq.com', pattern_type: 'wildcard', description: '微信' },
  { domain: '*.bilibili.com', pattern_type: 'wildcard', description: 'B站' },
];

const PATTERN_LABELS: Record<string, string> = {
  exact: '精确',
  wildcard: '通配符',
  suffix: '后缀',
};
const PATTERN_COLORS: Record<string, string> = {
  exact: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  wildcard: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  suffix: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function DomainWhitelistManager({ open, onClose, onCountChange }: DomainWhitelistManagerProps) {
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [allDomains, setAllDomains] = useState<AllowedDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDomain, setEditingDomain] = useState<AllowedDomain | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    domain: '',
    pattern_type: 'exact' as 'exact' | 'wildcard' | 'suffix',
    description: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stats
  const stats = {
    total: allDomains.length,
    active: allDomains.filter(d => d.is_enabled).length,
    totalHits: allDomains.reduce((sum, d) => sum + d.hit_count, 0),
    byPattern: {
      exact: allDomains.filter(d => d.pattern_type === 'exact').length,
      wildcard: allDomains.filter(d => d.pattern_type === 'wildcard').length,
      suffix: allDomains.filter(d => d.pattern_type === 'suffix').length,
    },
    recentAdded: allDomains.filter(d => {
      const created = new Date(d.created_at);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return created >= weekAgo;
    }).length,
  };

  const loadDomains = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content-filter/domains');
      const data = await res.json();
      let domainsList: AllowedDomain[] = data.domains || [];
      setAllDomains(domainsList);
      
      // Apply search filter
      if (searchQuery) {
        domainsList = domainsList.filter((d: AllowedDomain) =>
          d.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.description?.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      setDomains(domainsList);
      onCountChange(data.domains?.length || 0);
    } catch (err) {
      appLogger.warn('Failed to load domains', { error: err });
      toast.error('加载域名白名单失败');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, onCountChange]);

  useEffect(() => {
    if (open) {
      loadDomains();
    }
  }, [open, loadDomains]);

  const handleSubmit = async () => {
    if (!formData.domain.trim()) {
      toast.error('请输入域名');
      return;
    }

    // Validate domain format
    const domainRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+/;
    if (!domainRegex.test(formData.domain)) {
      toast.error('请输入有效的域名格式');
      return;
    }

    try {
      // Normalize domain (remove protocol if present)
      const normalizedDomain = formData.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

      const payload = {
        domain: normalizedDomain,
        pattern_type: formData.pattern_type,
        description: formData.description.trim() || null,
        is_enabled: true,
      };

      let res: Response;
      if (editingDomain) {
        res = await fetch('/api/content-filter/domains', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingDomain.id, ...payload }),
        });
      } else {
        res = await fetch('/api/content-filter/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        toast.success(editingDomain ? '域名已更新' : '域名已添加');
        resetForm();
        loadDomains();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      } else {
        const data = await res.json();
        toast.error(data.error || '操作失败');
      }
    } catch (err) {
      appLogger.warn('Failed to save domain', { error: err });
      toast.error('保存域名失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此域名？')) return;
    try {
      const res = await fetch(`/api/content-filter/domains?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('域名已删除');
        loadDomains();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      appLogger.warn('Failed to delete domain', { error: err });
      toast.error('删除域名失败');
    }
  };

  const handleToggle = async (domain: AllowedDomain) => {
    try {
      const res = await fetch('/api/content-filter/domains', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: domain.id, is_enabled: !domain.is_enabled }),
      });
      if (res.ok) {
        loadDomains();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      }
    } catch (err) {
      appLogger.warn('Failed to toggle domain', { error: err });
    }
  };

  const handleQuickAdd = async (preset: typeof COMMON_DOMAINS[0]) => {
    try {
      const res = await fetch('/api/content-filter/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: preset.domain,
          pattern_type: preset.pattern_type,
          description: preset.description,
          is_enabled: true,
        }),
      });

      if (res.ok) {
        toast.success(`已添加 ${preset.description}`);
        loadDomains();
      } else if (res.status === 403) {
        toast.error('无权限执行此操作');
      } else {
        const data = await res.json();
        toast.error(data.error || '添加失败');
      }
    } catch (err) {
      appLogger.warn('Failed to quick add domain', { error: err });
      toast.error('添加域名失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要删除的域名');
      return;
    }
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个域名？`)) return;
    
    try {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map(id =>
          fetch(`/api/content-filter/domains?id=${id}`, { method: 'DELETE' })
        )
      );
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      const failed = results.length - succeeded;
      if (failed > 0) {
        toast.warning(`已删除 ${succeeded} 个，${failed} 个失败`);
      } else {
        toast.success(`已删除 ${succeeded} 个域名`);
      }
      setSelectedIds(new Set());
      loadDomains();
    } catch (err) {
      appLogger.warn('Failed to batch delete', { error: err });
      toast.error('批量删除失败');
    }
  };

  const handleBatchToggle = async (enable: boolean) => {
    if (selectedIds.size === 0) {
      toast.error('请先选择要操作的域名');
      return;
    }
    
    try {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map(id =>
          fetch('/api/content-filter/domains', {
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
        toast.success(`已${enable ? '启用' : '禁用'} ${succeeded} 个域名`);
      }
      setSelectedIds(new Set());
      loadDomains();
    } catch (err) {
      appLogger.warn('Failed to batch toggle', { error: err });
      toast.error('批量操作失败');
    }
  };

  const handleExport = () => {
    const exportData = domains.map(d => ({
      domain: d.domain,
      pattern_type: d.pattern_type,
      description: d.description || '',
      is_enabled: d.is_enabled ? '是' : '否',
    }));
    
    const csv = [
      ['域名', '匹配模式', '描述', '是否启用'].join(','),
      ...exportData.map(row => [
        row.domain,
        PATTERN_LABELS[row.pattern_type],
        row.description,
        row.is_enabled,
      ].join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `域名白名单_${new Date().toLocaleDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出成功');
  };

  const handleImport = useCallback(async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('文件大小不能超过 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      const lines = content.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        toast.error('CSV 文件至少需要包含标题行和 1 条数据');
        return;
      }

      // Parse CSV (skip header)
      const domains: Array<{ domain: string; pattern_type?: string; description?: string }> = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (handle quoted fields)
        const parts: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            parts.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        parts.push(current.trim());

        // Map CSV columns: 域名, 匹配模式, 描述
        const domain = parts[0];
        if (!domain) continue;

        domains.push({
          domain,
          pattern_type: parts[1] === '通配符' ? 'wildcard' : parts[1] === '域名后缀' ? 'suffix' : 'exact',
          description: parts[2] || undefined,
        });
      }

      if (domains.length === 0) {
        toast.error('未找到有效数据');
        return;
      }

      setImporting(true);
      try {
        const res = await fetch('/api/content-filter/domains/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domains }),
        });

        const data = await res.json();
        if (data.success) {
          toast.success(data.message || `成功导入 ${data.results.success} 条`);
          loadDomains();
        } else {
          toast.error(data.error || '导入失败');
        }
      } catch (err) {
        appLogger.api.warn('Import domains failed', { error: err });
        toast.error('导入失败，请重试');
      } finally {
        setImporting(false);
      }
    };

    reader.onerror = () => {
      toast.error('读取文件失败');
    };

    reader.readAsText(file);
  }, [loadDomains]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setShowAddForm(false);
    setEditingDomain(null);
    setFormData({
      domain: '',
      pattern_type: 'exact',
      description: '',
    });
  };

  const startEdit = (domain: AllowedDomain) => {
    setEditingDomain(domain);
    setFormData({
      domain: domain.domain,
      pattern_type: domain.pattern_type,
      description: domain.description || '',
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
    if (selectedIds.size === domains.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(domains.map(d => d.id)));
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
            <h2 className="text-base font-semibold text-foreground">域名白名单管理</h2>
            <p className="text-xs text-muted-foreground mt-0.5">配置允许发送的链接域名白名单</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Stats Cards */}
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <div className="grid grid-cols-5 gap-3">
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">总计</span>
              </div>
              <div className="text-xl font-bold text-foreground">{stats.total}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Link className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">已启用</span>
              </div>
              <div className="text-xl font-bold text-primary">{stats.active}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Globe className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-muted-foreground">通配符</span>
              </div>
              <div className="text-xl font-bold text-purple-600 dark:text-purple-400">{stats.byPattern.wildcard}</div>
            </div>
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">本周新增</span>
              </div>
              <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.recentAdded}</div>
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
              placeholder="搜索域名..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-sm hover:bg-muted/80 transition-colors"
            title="导出 CSV"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-sm hover:bg-muted/80 transition-colors disabled:opacity-50"
            title="导入 CSV"
          >
            {importing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {importing ? '导入中...' : '导入'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>

        {/* Quick Add Section */}
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">快捷添加</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {COMMON_DOMAINS.map((preset) => {
              const exists = allDomains.some((d) => d.domain === preset.domain);
              return (
                <button
                  key={preset.domain}
                  onClick={() => handleQuickAdd(preset)}
                  disabled={exists}
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                    exists
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  }`}
                >
                  {exists ? `✓ ${preset.description}` : `+ ${preset.description}`}
                </button>
              );
            })}
          </div>
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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">域名 *</label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData((prev) => ({ ...prev, domain: e.target.value }))}
                  placeholder="例如: *.example.com"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">匹配模式</label>
                <Select value={formData.pattern_type} onValueChange={(v) => setFormData((prev) => ({ ...prev, pattern_type: v as 'exact' | 'wildcard' | 'suffix' }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PATTERN_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">描述（可选）</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="例如: 官方商城"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            {/* Pattern type description */}
            <div className="mt-2 text-xs text-muted-foreground">
              {PATTERN_TYPES.find((t) => t.value === formData.pattern_type)?.desc}
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
                {editingDomain ? '保存修改' : '添加'}
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">加载中...</div>
          ) : domains.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {searchQuery ? '未找到匹配的域名' : '暂无域名白名单，点击添加按钮创建'}
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Header Row */}
              <div className="grid grid-cols-[40px_1fr_100px_100px_80px_80px] gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <div className="flex items-center">
                  <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground">
                    {selectedIds.size === domains.length && domains.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div>域名</div>
                <div>描述</div>
                <div>匹配模式</div>
                <div>命中</div>
                <div className="text-right">操作</div>
              </div>
              {/* Data Rows */}
              <div className="divide-y divide-border">
                {domains.map((domain) => (
                  <div
                    key={domain.id}
                    className={`grid grid-cols-[40px_1fr_100px_100px_80px_80px] gap-2 px-4 py-3 items-center hover:bg-muted/30 transition-colors ${
                      !domain.is_enabled ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      <button onClick={() => toggleSelect(domain.id)} className="text-muted-foreground hover:text-foreground">
                        {selectedIds.has(domain.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Globe className="w-4 h-4 text-primary" />
                      </div>
                      <span className={`text-sm font-medium font-mono ${domain.is_enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {domain.domain}
                      </span>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground truncate block">
                        {domain.description || '-'}
                      </span>
                    </div>
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${PATTERN_COLORS[domain.pattern_type]}`}>
                        {PATTERN_LABELS[domain.pattern_type]}
                      </span>
                      {!domain.is_enabled && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive ml-1">
                          禁用
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">
                        {domain.hit_count}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggle(domain)}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title={domain.is_enabled ? '禁用' : '启用'}
                      >
                        {domain.is_enabled ? (
                          <ToggleRight className="w-5 h-5 text-primary" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        onClick={() => startEdit(domain)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(domain.id)}
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
