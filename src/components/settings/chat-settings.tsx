'use client';

import { ToggleLeft, ToggleRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import SensitiveWordManager from './sensitive-word-manager';
import DomainWhitelistManager from './domain-whitelist-manager';

interface ChatSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

async function fetchTotalCount(endpoint: string): Promise<number> {
  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return 0;
    const data = await res.json();
    if (typeof data?.total === 'number') return data.total;
    if (Array.isArray(data?.words)) return data.words.length;
    if (Array.isArray(data?.domains)) return data.domains.length;
    if (Array.isArray(data?.items)) return data.items.length;
    return 0;
  } catch {
    return 0;
  }
}

export function ChatSettings({ settings, onSettingsChange }: ChatSettingsProps) {
  const [showSensitiveWordManager, setShowSensitiveWordManager] = useState(false);
  const [showDomainManager, setShowDomainManager] = useState(false);
  const [sensitiveWordCount, setSensitiveWordCount] = useState(0);
  const [domainCount, setDomainCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchTotalCount('/api/content-filter/sensitive-words'),
      fetchTotalCount('/api/content-filter/domains'),
    ]).then(([words, domains]) => {
      if (cancelled) return;
      setSensitiveWordCount(words);
      setDomainCount(domains);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">对话设置</h2>
      <p className="text-xs text-muted-foreground mb-4">配置对话行为和交互方式</p>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div>
          <label className="text-xs font-medium text-foreground mb-1 block">欢迎语</label>
          <textarea
            value={settings.welcome_message || ''}
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, welcome_message: e.target.value }))}
            rows={3}
            placeholder="设置对话开始时的欢迎语..."
            className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">对话超时时间（分钟）</label>
            <input
              type="number"
              value={settings.session_timeout || '30'}
              onChange={(e) => onSettingsChange((prev) => ({ ...prev, session_timeout: e.target.value }))}
              min="1"
              className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">最大对话轮次</label>
            <input
              type="number"
              value={settings.max_turns || '20'}
              onChange={(e) => onSettingsChange((prev) => ({ ...prev, max_turns: e.target.value }))}
              min="1"
              className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground">满意度评价</p>
            <p className="text-xs text-muted-foreground">对话结束后邀请用户评价</p>
          </div>
          <button
            onClick={() => onSettingsChange((prev) => ({ ...prev, rating_enabled: prev.rating_enabled === 'true' ? 'false' : 'true' }))}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {settings.rating_enabled === 'true' ? (
              <ToggleRight className="w-6 h-6 text-primary" />
            ) : (
              <ToggleLeft className="w-6 h-6" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground">新对话通知</p>
            <p className="text-xs text-muted-foreground">有新对话时发送通知</p>
          </div>
          <button
            onClick={() => onSettingsChange((prev) => ({ ...prev, new_conversation_notify: prev.new_conversation_notify === 'true' ? 'false' : 'true' }))}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {settings.new_conversation_notify === 'true' ? (
              <ToggleRight className="w-6 h-6 text-primary" />
            ) : (
              <ToggleLeft className="w-6 h-6" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground">未处理对话提醒</p>
            <p className="text-xs text-muted-foreground">有未处理的对话时提醒</p>
          </div>
          <button
            onClick={() => onSettingsChange((prev) => ({ ...prev, unhandled_remind_enabled: (prev.unhandled_remind_enabled ?? 'true') === 'true' ? 'false' : 'true' }))}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="切换未处理对话提醒"
          >
            {(settings.unhandled_remind_enabled ?? 'true') === 'true' ? (
              <ToggleRight className="w-6 h-6 text-primary" />
            ) : (
              <ToggleLeft className="w-6 h-6" />
            )}
          </button>
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1 block">
            未处理超时阈值（分钟）
          </label>
          <input
            type="number"
            min={1}
            max={1440}
            value={settings.unhandled_remind_minutes ?? '30'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^\d+$/.test(v)) {
                onSettingsChange((prev) => ({ ...prev, unhandled_remind_minutes: v }));
              }
            }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            用户发消息后超过该时间仍未被客服接管时触发提醒。
          </p>
        </div>

        {/* Content Security Settings */}
        <div className="border-t border-border pt-4 mt-4">
          <h3 className="text-sm font-medium text-foreground mb-3">内容安全</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">启用内容过滤</p>
                <p className="text-xs text-muted-foreground">对用户消息进行敏感词和链接过滤</p>
              </div>
              <button
                onClick={() => onSettingsChange((prev) => ({ ...prev, content_filter_enabled: prev.content_filter_enabled === 'true' ? 'false' : 'true' }))}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {settings.content_filter_enabled === 'true' ? (
                  <ToggleRight className="w-6 h-6 text-primary" />
                ) : (
                  <ToggleLeft className="w-6 h-6" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">敏感词过滤</p>
                <p className="text-xs text-muted-foreground">过滤脏话、违规词等</p>
              </div>
              <button
                onClick={() => onSettingsChange((prev) => ({ ...prev, sensitive_word_filter_enabled: prev.sensitive_word_filter_enabled === 'true' ? 'false' : 'true' }))}
                disabled={settings.content_filter_enabled !== 'true'}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {settings.sensitive_word_filter_enabled === 'true' ? (
                  <ToggleRight className="w-6 h-6 text-primary" />
                ) : (
                  <ToggleLeft className="w-6 h-6" />
                )}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">URL 白名单</p>
                <p className="text-xs text-muted-foreground">只允许发送白名单中的链接</p>
              </div>
              <button
                onClick={() => onSettingsChange((prev) => ({ ...prev, url_filter_enabled: prev.url_filter_enabled === 'true' ? 'false' : 'true' }))}
                disabled={settings.content_filter_enabled !== 'true'}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {settings.url_filter_enabled === 'true' ? (
                  <ToggleRight className="w-6 h-6 text-primary" />
                ) : (
                  <ToggleLeft className="w-6 h-6" />
                )}
              </button>
            </div>

            <div className="mt-2">
              <label className="text-xs font-medium text-foreground mb-1 block">URL 拦截提示</label>
              <input
                type="text"
                value={settings.url_block_message || '抱歉,发送的链接不在白名单范围内'}
                onChange={(e) => onSettingsChange((prev) => ({ ...prev, url_block_message: e.target.value }))}
                placeholder="URL 被拦截时显示的提示"
                disabled={settings.content_filter_enabled !== 'true' || settings.url_filter_enabled !== 'true'}
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40"
              />
            </div>

            {/* Management Buttons */}
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setShowSensitiveWordManager(true)}
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
              >
                管理敏感词 ({sensitiveWordCount})
              </button>
              <button
                onClick={() => setShowDomainManager(true)}
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
              >
                管理白名单域名 ({domainCount})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showSensitiveWordManager && (
        <SensitiveWordManager
          open={showSensitiveWordManager}
          onClose={() => setShowSensitiveWordManager(false)}
          onCountChange={setSensitiveWordCount}
        />
      )}
      {showDomainManager && (
        <DomainWhitelistManager
          open={showDomainManager}
          onClose={() => setShowDomainManager(false)}
          onCountChange={setDomainCount}
        />
      )}
    </section>
  );
}
