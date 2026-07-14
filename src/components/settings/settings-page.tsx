'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { RotateCcw, Check, Save } from 'lucide-react';
import { SettingsSidebar, type SectionType } from './settings-sidebar';
import type { AutoReplyRule } from './types';
import type { PushTemplate } from '@/lib/types';
import type { Shop } from './types';
import type { ShopStats } from './types';
import type { MainBot } from './types';
import type { SkillGroup } from './types';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

// Lazy load section components
const AutoReplySettings = dynamic(() => import('./auto-reply-settings').then(m => ({ default: m.AutoReplySettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const ChatSettings = dynamic(() => import('./chat-settings').then(m => ({ default: m.ChatSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const AISettings = dynamic(() => import('./ai-settings').then(m => ({ default: m.AISettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const AlertSettings = dynamic(() => import('./alert-settings').then(m => ({ default: m.AlertSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const AppearanceSettings = dynamic(() => import('./appearance-settings').then(m => ({ default: m.AppearanceSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const ShopSettings = dynamic(() => import('./shop-settings').then(m => ({ default: m.ShopSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const PushSettings = dynamic(() => import('./push-settings').then(m => ({ default: m.PushSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const BotSettings = dynamic(() => import('./bot-settings').then(m => ({ default: m.BotSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});
const KnowledgeLearningSettings = dynamic(() => import('./knowledge-learning-settings').then(m => ({ default: m.KnowledgeLearningSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});

// Static imports for components that are already independent
import { AgentAssignmentSettings } from './agent-assignment-settings';
import GorgiasSettings from './gorgias-settings';

export type SettingsResetResult =
  | { ok: true; settings: Record<string, string> }
  | { ok: false; error: string; phase: 'reset' | 'reload' };

/**
 * Phase 2 contract (settings-rls-hardening):
 *   - POST /api/settings/reset with empty body (server-fixed scope).
 *   - On 2xx: GET /api/settings to synchronise UI with the actual post-reset
 *     state (including server-only system_prompt and preserved non-resettable
 *     keys). If the reload fails, return { ok:false, phase:'reload' } so the
 *     caller can show an error and the UI keeps the (now-stale) pre-reset
 *     settings — NEVER a stale "success" toast.
 *   - On non-2xx or network failure: return { ok:false, phase:'reset' }.
 *
 * Pure function (no React state). The component owns the `resetting` state
 * flag, which is also reused to disable the save button until the reload
 * settles (see SettingsPage `resetting || saving`).
 */
export async function performSettingsReset(
  fetchImpl: typeof fetch = fetch,
): Promise<SettingsResetResult> {
  let res: Response;
  try {
    res = await fetchImpl('/api/settings/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error('恢复默认设置网络错误', { error: err });
    return { ok: false, phase: 'reset', error: '恢复默认设置失败，请检查网络连接' };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      phase: 'reset',
      error: (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) || '恢复默认设置失败',
    };
  }

  // Reload — failure here means the DB is reset but the UI is stale; the
  // safe thing is to surface the error and NOT report success.
  let settingsRes: Response;
  try {
    settingsRes = await fetchImpl('/api/settings', { credentials: 'include' });
  } catch (err) {
    logger.error('重置后重新加载设置网络错误', { error: err });
    return { ok: false, phase: 'reload', error: '重置成功，但重新加载设置失败，请刷新页面' };
  }
  if (!settingsRes.ok) {
    logger.warn('重置后重新加载设置 HTTP 失败', { status: settingsRes.status });
    return { ok: false, phase: 'reload', error: '重置成功，但重新加载设置失败，请刷新页面' };
  }

  let data: { data?: { settings?: Record<string, string> } };
  try {
    data = await settingsRes.json();
  } catch (err) {
    logger.error('重置后重新加载设置解析 JSON 失败', { error: err });
    return { ok: false, phase: 'reload', error: '重置成功，但重新加载设置失败，请刷新页面' };
  }
  const settings = data?.data?.settings ?? {};
  return { ok: true, settings };
}

export function SettingsPage() {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionType>('auto-reply');

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Push templates state
  const [pushTemplates, setPushTemplates] = useState<PushTemplate[]>([]);

  // Shop management state
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopStats, setShopStats] = useState<ShopStats>({ total: 0, totalAccounts: 0, usedAccounts: 0, availableAccounts: 0 });

  // Skill groups state
  const [skillGroups, setSkillGroups] = useState<SkillGroup[]>([]);

  // Loading state
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rulesRes, settingsRes, pushTemplatesRes, pushEventsRes, shopsRes, skillGroupsRes] = await Promise.all([
        fetch('/api/auto-reply'),
        fetch('/api/settings'),
        fetch('/api/push/templates'),
        fetch('/api/push/events'),
        fetch('/api/shops?stats=true').catch(() => null),
        fetch('/api/skill-groups').catch(() => null),
      ]);
      const rulesData = await rulesRes.json();
      const settingsData = await settingsRes.json();
      const pushTemplatesData = await pushTemplatesRes.json();
      setRules(rulesData.rules || []);
      setSettings(settingsData.settings || {});
      setPushTemplates(pushTemplatesData.templates || []);
      // Load shops data
      if (shopsRes?.ok) {
        const shopsData = await shopsRes.json();
        setShops(shopsData.shops || []);
        setShopStats(shopsData.stats || { total: 0, totalAccounts: 0, usedAccounts: 0, availableAccounts: 0 });
      }
      // Load skill groups data
      if (skillGroupsRes?.ok) {
        const skillGroupsData = await skillGroupsRes.json();
        setSkillGroups(skillGroupsData.groups || []);
      }
    } catch (err) {
      logger.error('加载设置失败', { error: err });
      toast.error('加载设置失败，请刷新重试');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveSettings = async () => {
    // Cross-validate alert thresholds: Critical must be less than Warning
    const confWarn = parseFloat(settings.alert_confidence_threshold || '0.4');
    const confCrit = parseFloat(settings.alert_confidence_critical_threshold || '0.2');
    const roundsWarn = parseInt(settings.alert_high_rounds_threshold || '10', 10);
    const roundsCrit = parseInt(settings.alert_high_rounds_critical_threshold || '15', 10);

    if (confCrit >= confWarn) {
      toast.error(`低置信度严重告警阈值 (${(confCrit * 100).toFixed(0)}%) 必须小于告警阈值 (${(confWarn * 100).toFixed(0)}%)`);
      return;
    }
    if (roundsCrit <= roundsWarn) {
      toast.error(`高轮次严重告警阈值 (${roundsCrit}) 必须大于告警阈值 (${roundsWarn})`);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '保存设置失败');
      }
    } catch {
      toast.error('保存设置失败，请检查网络连接');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    const confirmed = await confirm({
      title: '恢复出厂设置',
      description: '确定恢复出厂默认设置？所有自定义配置将被覆盖，此操作不可撤销。',
      confirmText: '恢复',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    setResetting(true);
    const result = await performSettingsReset();
    setResetting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSettings(result.settings);
    toast.success('已恢复出厂默认设置');
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'auto-reply':
        return <AutoReplySettings rules={rules} onRulesChange={setRules} />;
      case 'chat':
        return <ChatSettings settings={settings} onSettingsChange={setSettings} />;
      case 'ai':
        return <AISettings settings={settings} onSettingsChange={setSettings} />;
      case 'alert':
        return <AlertSettings settings={settings} onSettingsChange={setSettings} />;
      case 'appearance':
        return <AppearanceSettings settings={settings} onSettingsChange={setSettings} />;
      case 'shop':
        return (
          <ShopSettings
            shops={shops}
            shopStats={shopStats}
            onShopsChange={setShops}
            onShopStatsChange={setShopStats}
            onDataRefresh={loadData}
          />
        );
      case 'agent-assignment':
        return <AgentAssignmentSettings />;
      case 'push':
        return <PushSettings pushTemplates={pushTemplates} onPushTemplatesChange={setPushTemplates} />;
      case 'bot':
        return <BotSettings shops={shops} skillGroups={skillGroups} settings={settings} onDataRefresh={loadData} />;
      case 'gorgias':
        return <GorgiasSettings />;
      case 'knowledge-learning':
        return <KnowledgeLearningSettings settings={settings} onSettingsChange={setSettings} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col page-transition">
      {/* Header */}
      <div className="h-14 border-b border-border px-6 flex items-center bg-card shrink-0">
        <h1 className="text-base font-semibold text-foreground">设置</h1>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={handleResetToDefaults}
            disabled={resetting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
            {resetting ? '恢复中...' : '恢复出厂'}
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={saving || resetting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                已保存
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                {saving ? '保存中...' : '保存设置'}
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Section nav */}
        <SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

        {/* Section content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
                <div className="text-sm text-muted-foreground">加载中...</div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl">
              <Suspense fallback={<div className="p-6"><Skeleton className="h-64 w-full" /></div>}>
                {renderSection()}
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
