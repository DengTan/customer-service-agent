'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
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
import type { ThemeMode, ThemeSettings } from '@/lib/theme-settings-context';
import { useThemeSettings } from '@/lib/theme-settings-context';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { SECRET_KEYS } from '@/lib/settings-schema';

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
const ExternalKnowledgeSettings = dynamic(() => import('./external-knowledge-settings').then(m => ({ default: m.ExternalKnowledgeSettings })), {
  loading: () => <div className="p-6"><Skeleton className="h-64 w-full" /></div>,
});

// Static imports for components that are already independent
import { AgentAssignmentSettings } from './agent-assignment-settings';
import GorgiasSettings from './gorgias-settings';

// ─── Type Guards ─────────────────────────────────────────────────

/**
 * Narrowing helper for the /api/settings GET response.
 * Avoids scattered optional-chaining in call-sites.
 */
function isSettingsResponse(value: unknown): value is { data: { settings: Record<string, string> } } {
  if (value === null || typeof value !== 'object') return false;
  const d = (value as Record<string, unknown>).data;
  if (d === null || typeof d !== 'object') return false;
  const s = (d as Record<string, unknown>).settings;
  return typeof s === 'object' && s !== null && !Array.isArray(s);
}

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

  let data: unknown;
  try {
    data = await settingsRes.json();
  } catch (err) {
    logger.error('重置后重新加载设置解析 JSON 失败', { error: err });
    return { ok: false, phase: 'reload', error: '重置成功，但重新加载设置失败，请刷新页面' };
  }
  // L-4: Use type guard to safely narrow the response shape
  const settings = isSettingsResponse(data) ? data.data.settings : {};
  return { ok: true, settings };
}

export function SettingsPage() {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [externalKbSettings, setExternalKbSettings] = useState<{
    enabled: boolean;
    provider: string;
    baseUrl: string;
    apiKeyMasked: string;
    datasetId: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionType>('auto-reply');
  /**
   * Per-section validity reporters. Each child mounts and reports its
   * current validity via `onValidationChange`; we remember the most
   * recent report per child (by sectionId) and the overall page is
   * considered valid iff every reported child is valid.
   *
   * Why we pre-build 5 separate callbacks (rather than a factory that
   * returns one inline arrow per render): the inline arrow path leaks a
   * fresh function reference on every parent render, which propagates
   * through every NumberInput child and forces its `runValidation` /
   * `handleChange` / `handleBlur` closures to rebuild on every keystroke.
   * Pre-binding once keeps the reference chain stable for the lifetime
   * of the SettingsPage mount.
   */
  const childValidityRef = useRef<Record<string, boolean>>({});
  const [numericSettingsValid, setNumericSettingsValid] = useState(true);
  const [invalidFieldKey, setInvalidFieldKey] = useState<string | null>(null);

  // Single shared reporter. We wrap it once and reuse it for every
  // section — each section passes its own id at the call site. The
  // resulting closure captures `setNumericSettingsValid` / `setInvalidFieldKey`
  // which are stable across renders, so this callback stays stable too.
  const reportChildValidity = useCallback(
    (sectionId: string) => (isValid: boolean, key: string | null) => {
      if (childValidityRef.current[sectionId] === isValid && key === null) return;
      childValidityRef.current[sectionId] = isValid;
      const entries = Object.entries(childValidityRef.current);
      const firstInvalid = entries.find(([, v]) => !v);
      if (firstInvalid) {
        // Preserve the key from the failing child if it provided one,
        // otherwise default to the section id.
        setNumericSettingsValid(false);
        setInvalidFieldKey(key ?? firstInvalid[0]);
      } else {
        setNumericSettingsValid(true);
        setInvalidFieldKey(null);
      }
    },
    [],
  );

  const chatValidityHandler = useMemo(() => reportChildValidity('chat'), [reportChildValidity]);
  const aiValidityHandler = useMemo(() => reportChildValidity('ai'), [reportChildValidity]);
  const alertValidityHandler = useMemo(() => reportChildValidity('alert'), [reportChildValidity]);
  const appearanceValidityHandler = useMemo(
    () => reportChildValidity('appearance'),
    [reportChildValidity],
  );
  const knowledgeLearningValidityHandler = useMemo(
    () => reportChildValidity('knowledge-learning'),
    [reportChildValidity],
  );
  const themeSettings = useThemeSettings();

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
      const [rulesRes, settingsRes, pushTemplatesRes, pushEventsRes, shopsRes, skillGroupsRes, externalKbRes] = await Promise.all([
        fetch('/api/auto-reply'),
        fetch('/api/settings'),
        fetch('/api/push/templates'),
        fetch('/api/push/events'),
        fetch('/api/shops?stats=true').catch(() => null),
        fetch('/api/skill-groups').catch(() => null),
        fetch('/api/knowledge/external/settings').catch(() => null),
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
      // Load external knowledge settings.
      // Catch returns null on network failure, while non-2xx still resolves to a Response
      // with .ok=false — both cases must NOT silently keep the previous state, otherwise
      // the UI would render hardcoded "default" values that look like a successful reset.
      if (externalKbRes) {
        if (externalKbRes.ok) {
          try {
            const externalKbData = await externalKbRes.json();
            setExternalKbSettings(externalKbData);
          } catch (err) {
            logger.error('外部知识库设置解析失败', { error: err });
            toast.error('外部知识库设置加载失败：响应格式错误');
          }
        } else {
          logger.warn('外部知识库设置加载 HTTP 失败', { status: externalKbRes.status });
          toast.error(`外部知识库设置加载失败 (HTTP ${externalKbRes.status})`);
        }
      } else {
        logger.warn('外部知识库设置网络请求失败');
        toast.error('外部知识库设置加载失败，请检查网络连接');
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
    // Block save if any numeric field is currently in an invalid state.
    // The UI already disables the button, but a stale handler (e.g. the
    // user pressed Enter while focus was elsewhere) can still fire here.
    if (!numericSettingsValid) {
      const fieldLabel = invalidFieldKey ?? '数值字段';
      toast.error(`${fieldLabel} 当前值不合法，请修正后再保存`);
      return;
    }

    // Cross-validate alert thresholds. AlertSettings already runs these
    // rules live and reports them via onValidationChange — so by the
    // time we get here the save button should be disabled if either
    // pair violates its constraint. The checks below are a defensive
    // belt-and-suspenders copy that protects against:
//   (a) a stale settings object captured by this closure (e.g. async
//       race if the user mashes Enter while setSettings is still
//       pending),
//   (b) programmatic callers that bypass the disabled-button path
//       (tests, hot-reload, future refactors).
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

    // Strip secret / server-internal keys that the generic PUT endpoint does not accept.
    // These keys have dedicated API routes (e.g. /api/gorgias/settings, /api/push/secret/rotate)
    // and must never be sent through the generic settings endpoint.
    // Defense in depth: settings-schema.ts WRITABLE_SETTING_KEYS also blocks these at the service layer.

    const writableSettings: Record<string, string> = {};
    const systemPrompt = settings.system_prompt;
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'system_prompt') continue; // handled by dedicated endpoint
      if (!SECRET_KEYS.includes(key)) {
        writableSettings[key] = value;
      }
    }

    setSaving(true);
    try {
      // 1. Save all non-secret settings via the generic endpoint
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: writableSettings }),
      });
      const data = await res.json().catch(() => ({}));

      // 2. Save system_prompt via the dedicated narrow-scope endpoint
      //    (system_prompt is no longer writable via the generic endpoint;
      //     calling it here is safe even if the value hasn't changed — it's idempotent)
      const spRes = await fetch('/api/settings/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: systemPrompt ?? '' }),
      });
      const spData = await spRes.json().catch(() => ({}));

      if (res.ok && data.success && spRes.ok && spData.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        // Re-fetch full settings so the single source of truth (server DB) is
        // reflected in the Theme Context and localStorage.
        try {
          const fullRes = await fetch('/api/settings');
          if (fullRes.ok) {
            const full = await fullRes.json();
            const db = full.settings ?? {};
            const appearance: ThemeSettings = {
              theme: (db.theme as ThemeMode) ?? 'system',
              fontSize: db.font_size ?? '14',
              showTimestamps: db.show_timestamps === 'true',
              compactMode: db.compact_mode === 'true',
            };
            themeSettings.syncFromServer(appearance);
          }
        } catch {
          // Non-fatal: save succeeded, sync is best-effort
        }
      } else {
        // Build the most useful error message
        const genericError = data.error || spData.error || '保存设置失败';
        const detail = data.detail;
        let fullMsg = genericError;
        // System-prompt specific errors
        if (spData.code && !res.ok) {
          fullMsg = `系统提示词保存失败: ${spData.error}`;
        } else if (detail) {
          if (detail.invalidKeys?.length) {
            fullMsg += `\n不支持的设置键: ${detail.invalidKeys.join(', ')}`;
          }
          if (detail.invalidValues?.length) {
            const bad = detail.invalidValues.map((v: { key: string; value: unknown }) => `${v.key}=${v.value}`).join(', ');
            fullMsg += `\n无效的值: ${bad}`;
          }
        }
        toast.error(fullMsg);
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
        return (
          <ChatSettings
            settings={settings}
            onSettingsChange={setSettings}
            onValidationChange={chatValidityHandler}
          />
        );
      case 'ai':
        return (
          <AISettings
            settings={settings}
            onSettingsChange={setSettings}
            onValidationChange={aiValidityHandler}
          />
        );
      case 'alert':
        return (
          <AlertSettings
            settings={settings}
            onSettingsChange={setSettings}
            onValidationChange={alertValidityHandler}
          />
        );
      case 'appearance':
        return (
          <AppearanceSettings
            settings={settings}
            onSettingsChange={setSettings}
            onValidationChange={appearanceValidityHandler}
          />
        );
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
        return (
          <KnowledgeLearningSettings
            settings={settings}
            onSettingsChange={setSettings}
            onValidationChange={knowledgeLearningValidityHandler}
          />
        );
      case 'external-knowledge':
        return (
          <ExternalKnowledgeSettings
            externalKbSettings={externalKbSettings}
            onSettingsChange={setExternalKbSettings}
          />
        );
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
            disabled={saving || resetting || !numericSettingsValid}
            title={
              !numericSettingsValid
                ? `当前存在非法数值字段${invalidFieldKey ? `: ${invalidFieldKey}` : ''}`
                : undefined
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
