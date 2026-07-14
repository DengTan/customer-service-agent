'use client';

import { useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { AutoReplyRule } from './types';

interface AutoReplySettingsProps {
  rules: AutoReplyRule[];
  onRulesChange: React.Dispatch<React.SetStateAction<AutoReplyRule[]>>;
}

export function AutoReplySettings({ rules, onRulesChange }: AutoReplySettingsProps) {
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState<{
    keyword: string;
    match_mode: 'exact' | 'fuzzy';
    reply_content: string;
    priority: number;
  }>({ keyword: '', match_mode: 'fuzzy', reply_content: '', priority: 0 });

  const handleToggleRule = async (id: string, enabled: boolean) => {
    // Optimistic update
    onRulesChange((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: enabled } : r)));
    try {
      const res = await fetch('/api/auto-reply', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: enabled }),
      });
      if (!res.ok) {
        // Revert on failure
        onRulesChange((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: !enabled } : r)));
      }
    } catch {
      // Revert on error
      onRulesChange((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: !enabled } : r)));
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/auto-reply?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        onRulesChange((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {
      // ignore
    }
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
      }
    } catch {
      // ignore
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">自动回复规则</h2>
          <p className="text-xs text-muted-foreground mt-0.5">设置关键词匹配，自动回复常见问题</p>
        </div>
        <button
          onClick={() => setShowAddRule(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加规则
        </button>
      </div>

      {showAddRule && (
        <div className="mb-4 p-4 rounded-xl border border-border bg-card">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">关键词</label>
              <input
                type="text"
                value={newRule.keyword}
                onChange={(e) => setNewRule((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="触发关键词"
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">匹配模式</label>
              <select
                value={newRule.match_mode}
                onChange={(e) => setNewRule((prev) => ({ ...prev, match_mode: e.target.value as 'exact' | 'fuzzy' }))}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="fuzzy">模糊匹配</option>
                <option value="exact">精确匹配</option>
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs font-medium text-foreground mb-1 block">回复内容</label>
            <textarea
              value={newRule.reply_content}
              onChange={(e) => setNewRule((prev) => ({ ...prev, reply_content: e.target.value }))}
              placeholder="自动回复内容"
              rows={3}
              className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddRule(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleAddRule}
              disabled={!newRule.keyword || !newRule.reply_content}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-foreground">{rule.keyword}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    rule.match_mode === 'exact'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {rule.match_mode === 'exact' ? '精确' : '模糊'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{rule.reply_content}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleToggleRule(rule.id, !rule.is_enabled)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {rule.is_enabled ? (
                  <ToggleRight className="w-6 h-6 text-primary" />
                ) : (
                  <ToggleLeft className="w-6 h-6" />
                )}
              </button>
              <button
                onClick={() => handleDeleteRule(rule.id)}
                className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">暂无自动回复规则</div>
        )}
      </div>
    </section>
  );
}
