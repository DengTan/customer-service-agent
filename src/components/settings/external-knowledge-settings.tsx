'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Globe, TestTube, CheckCircle, XCircle, Loader2, ExternalLink, Info, Sparkles } from 'lucide-react';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

// ─── DTO Types (aligns with API naming) ──────────────────────

/** Shape returned by GET /api/knowledge/external/settings */
export type ExternalKbSettingsState = {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKeyMasked: string;
  datasetId: string;
  searchMode: 'embedding' | 'hybrid' | 'fullText';
  useRerank: boolean;
} | null;

/** Shape accepted by PUT /api/knowledge/external/settings */
export type ExternalKbSettingsRequest = {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  datasetId?: string;
  searchMode?: 'embedding' | 'hybrid' | 'fullText';
  useRerank?: boolean;
};

/** API error response shape (used for type narrowing) */
interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
}

export interface ExternalKnowledgeSettingsProps {
  externalKbSettings: ExternalKbSettingsState;
  onSettingsChange: React.Dispatch<React.SetStateAction<ExternalKbSettingsState>>;
}

export function ExternalKnowledgeSettings({ externalKbSettings, onSettingsChange }: ExternalKnowledgeSettingsProps) {
  /**
   * Design Note (L-2):
   * External KB uses an "input-on-change" save pattern where each field triggers
   * an immediate PUT request on change. This differs from Gorgias's unified "Save"
   * button pattern. The rationale:
   * - External KB settings are typically configured once during initial setup
   * - Each field (baseUrl, datasetId) is independent, so incremental saves avoid
   *   data loss if the user navigates away mid-configuration
   * - API Key specifically uses input-on-change to ensure the masked display
   *   updates immediately after saving
   *
   * L-3: Demo mode is handled server-side in the API route, which returns
   * demo data when isDemoMode() is true. No client-side demo mode check needed.
   *
   * Loading-state semantics:
   *   - `externalKbSettings === null` means the parent has not finished
   *     loading (or the GET just failed — the parent emits a toast for
   *     that case). We render a loading skeleton instead of silently
   *     showing hardcoded defaults, which previously masked load failures
   *     as a successful "reset to default" appearance.
   *   - Once the parent supplies a settings object we render it verbatim.
   */
  const { confirm } = useConfirmDialog();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [apiKey, setApiKey] = useState('');

  const isLoaded = externalKbSettings !== null;
  const settings = externalKbSettings || {
    enabled: false,
    provider: 'fastgpt' as const,
    baseUrl: '',
    apiKeyMasked: '',
    datasetId: '',
    searchMode: 'embedding' as const,
    useRerank: false,
  };

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = async (updates: ExternalKbSettingsRequest): Promise<boolean> => {
    try {
      const res = await fetch('/api/knowledge/external/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Check if this is a demo mode response (settings not actually saved)
        if (data.demo) {
          toast.info('Demo 模式：设置未实际保存');
        } else {
          onSettingsChange((prev) => prev ? { ...prev, ...updates } : null);
        }
        return true;
      }

      // Parse error message from structured response.
      // In dev mode `apiError` puts `internalMessage` (e.g. the raw
      // `TypeError: fetch failed` from supabase-js) into `data.error`
      // alongside the user-facing message; we surface that as-is so the
      // user can tell transient network errors apart from real failures.
      const errorMsg = data.error || '保存失败';
      toast.error(errorMsg);
      return false;
    } catch (err) {
      logger.error('保存外部知识库设置失败', { error: err });
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${msg || '请检查网络连接'}`);
      return false;
    }
  };

  const handleTestConnection = async () => {
    if (!settings.baseUrl || !settings.datasetId) {
      toast.error('请填写 API 地址和知识库 ID');
      return;
    }

    // Decide whether to test with a freshly-typed key, or the key already
    // stored in settings. The latter lets the user re-test on page reload
    // without having to retype the key (which is never returned in plaintext).
    if (!apiKey && !settings.apiKeyMasked) {
      toast.error('请填写 API Key');
      return;
    }

    if (!settings.baseUrl.startsWith('http://') && !settings.baseUrl.startsWith('https://')) {
      toast.error('API 地址必须以 http:// 或 https:// 开头');
      return;
    }

    setTesting(true);
    setTestResult(null);
    setTestMessage('');

    // If the user typed a new key, use it; otherwise fall back to the
    // saved-key endpoint which reads from settings server-side.
    const endpoint = apiKey
      ? '/api/knowledge/external/test-connection'
      : '/api/knowledge/external/test-connection/saved';

    const payload = apiKey
      ? { provider: settings.provider, baseUrl: settings.baseUrl, apiKey, datasetId: settings.datasetId }
      : { provider: settings.provider, baseUrl: settings.baseUrl, datasetId: settings.datasetId };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setTestResult('success');
        setTestMessage(data.message || '连接成功');
        toast.success('连接测试成功');
      } else {
        setTestResult('error');
        setTestMessage(data.message || '连接失败');
        toast.error(data.message || '连接测试失败');
      }
    } catch (err) {
      logger.error('外部知识库连接测试失败', { error: err });
      setTestResult('error');
      setTestMessage('网络错误，请检查连接');
      toast.error('连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleRestoreDefaults = async () => {
    const confirmed = await confirm({
      title: '恢复默认',
      description: '确定要恢复外部知识库设置为默认值吗？',
      confirmText: '恢复',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    const res = await fetch('/api/knowledge/external/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
        provider: 'fastgpt',
        baseUrl: '',
        apiKey: '',
        datasetId: '',
        searchMode: 'embedding',
        useRerank: false,
      }),
    });
    if (res.ok) {
      onSettingsChange({
        enabled: false,
        provider: 'fastgpt',
        baseUrl: '',
        apiKeyMasked: '',
        datasetId: '',
        searchMode: 'embedding',
        useRerank: false,
      });
      setApiKey('');
      setTestResult(null);
      setTestMessage('');
      toast.success('已恢复默认值');
    } else {
      toast.error('恢复失败');
    }
  };

  const handleToggleEnabled = async () => {
    const newEnabled = !settings.enabled;
    await handleSave({ enabled: newEnabled });
  };

  const handleProviderChange = async (provider: string) => {
    await handleSave({ provider });
  };

  const handleBaseUrlChange = async (baseUrl: string) => {
    await handleSave({ baseUrl });
    setTestResult(null);
  };

  const handleSaveApiKey = async (value: string) => {
    setApiKey(value);
    setTestResult(null);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (value) {
        const res = await fetch('/api/knowledge/external/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: value }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          toast.error(errData.error || '保存 API Key 失败');
          return;
        }
        const data = await res.json();
        if (res.ok && data.success) {
          if (data.demo) {
            toast.info('Demo 模式：API Key 未实际保存');
          } else {
            // Always mask with at least 8 asterisks prefix to avoid exposing short keys
            const maskedKey = '••••••••' + value.slice(-4);
            onSettingsChange((prev) => prev ? { ...prev, apiKeyMasked: maskedKey } : null);
          }
        } else {
          toast.error(data.error || '保存 API Key 失败');
        }
      }
    }, 500);
  };

  const handleDatasetIdChange = async (datasetId: string) => {
    await handleSave({ datasetId });
    setTestResult(null);
  };

  const handleSearchModeChange = async (searchMode: 'embedding' | 'hybrid' | 'fullText') => {
    await handleSave({ searchMode });
  };

  const handleToggleUseRerank = async () => {
    const newValue = !settings.useRerank;
    await handleSave({ useRerank: newValue });
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-sm font-semibold text-foreground">外部知识库</h2>
          <p className="text-xs text-muted-foreground mt-0.5">接入 FastGPT 等外部知识库服务</p>
        </div>
        <button
          onClick={handleRestoreDefaults}
          disabled={!isLoaded}
          className="text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          恢复默认
        </button>
      </div>

      {!isLoaded ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在加载外部知识库配置…
          </div>
        </div>
      ) : (

      <div className="space-y-6">
        {/* Enable Toggle */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                settings.enabled ? 'bg-primary/10' : 'bg-muted'
              }`}>
                <Globe className={`w-5 h-5 ${settings.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block">启用外部知识库</label>
                <p className="text-xs text-muted-foreground">启用后将同时检索外部知识库内容</p>
              </div>
            </div>
            <button
              onClick={handleToggleEnabled}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>

        {/* Provider Selection */}
        {settings.enabled && (
          <>
            <div className="rounded-xl border border-border bg-card p-5">
              <label className="text-xs font-medium text-foreground mb-3 block">知识库提供商</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'fastgpt', label: 'FastGPT', icon: '🚀', desc: '开源知识库平台' },
                ].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handleProviderChange(p.value)}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      settings.provider === p.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{p.icon}</span>
                      <span className="text-sm font-medium text-foreground">{p.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Connection Settings */}
            <div className="rounded-xl border border-border bg-card p-5">
              <label className="text-xs font-medium text-foreground mb-4 block">连接配置</label>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    API 地址 <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="url"
                    value={settings.baseUrl}
                    onChange={(e) => handleBaseUrlChange(e.target.value)}
                    placeholder="https://your-fastgpt.example.com"
                    className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    FastGPT 的 API 根地址，格式：https://your-domain.com/api 或 http://host:port/api
                  </p>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    API Key <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => handleSaveApiKey(e.target.value)}
                    placeholder={settings.apiKeyMasked ? `已保存 (${settings.apiKeyMasked})` : '输入 API Key'}
                    className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {settings.apiKeyMasked && (
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      当前已保存: {settings.apiKeyMasked}（输入新值可覆盖）
                    </p>
                  )}
                  {!settings.apiKeyMasked && (
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      在 FastGPT 中创建开放式应用后获取的 API Key
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    知识库 ID <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={settings.datasetId}
                    onChange={(e) => handleDatasetIdChange(e.target.value)}
                    placeholder="输入知识库 ID"
                    className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    在 FastGPT 知识库设置中获取的知识库 ID
                  </p>
                </div>
              </div>
            </div>

            {/* Search Mode Settings */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                <label className="text-xs font-medium text-foreground">检索配置</label>
              </div>

              {/* Search Mode Selection */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">检索模式</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'embedding', label: '向量检索', desc: '基于语义相似度', icon: '🔍' },
                      { value: 'hybrid', label: '混合检索', desc: '向量+关键词', icon: '⚡' },
                      { value: 'fullText', label: '全文检索', desc: '纯关键词匹配', icon: '📝' },
                    ].map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => handleSearchModeChange(mode.value as 'embedding' | 'hybrid' | 'fullText')}
                        className={cn(
                          'p-3 rounded-lg border text-left transition-all',
                          settings.searchMode === mode.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/30 hover:bg-muted/30'
                        )}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm">{mode.icon}</span>
                          <span className="text-xs font-medium text-foreground">{mode.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{mode.desc}</p>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-2">
                    {settings.searchMode === 'embedding' && '基于语义理解，适合模糊问题匹配'}
                    {settings.searchMode === 'hybrid' && '结合向量和关键词，平衡精确度与召回率'}
                    {settings.searchMode === 'fullText' && '纯关键词匹配，适合专有名词和术语搜索'}
                  </p>
                </div>

                {/* ReRank Toggle */}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-medium text-foreground block">启用 ReRank</label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        使用重排序模型优化结果排序（需要 FastGPT 支持）
                      </p>
                    </div>
                    <button
                      onClick={handleToggleUseRerank}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        settings.useRerank ? 'bg-primary' : 'bg-muted'
                      )}
                    >
                      <span className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                        settings.useRerank ? 'translate-x-6' : 'translate-x-1'
                      )} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Test Connection */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TestTube className="w-4 h-4 text-muted-foreground" />
                  <label className="text-xs font-medium text-foreground">连接测试</label>
                </div>
                {testResult && (
                  <div className={`flex items-center gap-1.5 text-xs ${
                    testResult === 'success' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {testResult === 'success' ? (
                      <CheckCircle className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {testMessage}
                  </div>
                )}
              </div>

              <button
                onClick={handleTestConnection}
                disabled={testing || !settings.baseUrl || !settings.datasetId || (!apiKey && !settings.apiKeyMasked)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    测试中...
                  </>
                ) : (
                  <>
                    <TestTube className="w-4 h-4" />
                    测试连接
                  </>
                )}
              </button>

              {!settings.baseUrl || !settings.datasetId ? (
                <p className="text-[10px] text-muted-foreground/70 mt-2 text-center">
                  请填写 API 地址和知识库 ID
                </p>
              ) : !apiKey && !settings.apiKeyMasked ? (
                <p className="text-[10px] text-muted-foreground/70 mt-2 text-center">
                  请输入 API Key 后进行测试
                </p>
              ) : !apiKey && settings.apiKeyMasked ? (
                <p className="text-[10px] text-muted-foreground/70 mt-2 text-center">
                  密钥已保存（{settings.apiKeyMasked}）。点击「测试连接」将使用已保存的 Key 进行验证。
                </p>
              ) : null}
            </div>

            {/* Usage Tips */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">使用说明</p>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li>1. 在 FastGPT 中创建知识库并导入文档</li>
                    <li>2. 创建一个开放式应用，关联该知识库</li>
                    <li>3. 获取应用的 API Key 并填入上方配置</li>
                    <li>4. 填写知识库的 ID（可在知识库设置中查看）</li>
                    <li>5. 测试连接成功后保存设置</li>
                  </ul>
                  <a
                    href="https://doc.fastgpt.cn/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-3"
                  >
                    查看 FastGPT 文档
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      )}
    </section>
  );
}
