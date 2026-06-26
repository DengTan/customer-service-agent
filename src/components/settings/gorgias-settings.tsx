'use client';

import { useState, useEffect, useCallback } from 'react';
import { Globe, Key, Check, X, Loader2, RefreshCw, ExternalLink, Webhook, Copy, CheckCircle2, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';

interface GorgiasSettings {
  enabled: boolean;
  domain: string;
  email: string;
  apiKey: string;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

interface ConnectionStatus {
  tickets: 'unknown' | 'connected' | 'error';
  messages: 'unknown' | 'connected' | 'error';
  customers: 'unknown' | 'connected' | 'error';
  users: 'unknown' | 'connected' | 'error';
  tags: 'unknown' | 'connected' | 'error';
}

interface WebhookDiagnostics {
  integrationFound?: boolean;
  integrationId?: number;
  integrationName?: string;
  triggers?: Record<string, boolean>;
  targetUrl?: string;
  hint?: string;
  integrationCheckError?: string;
  recentProcessedEvents?: number;
  lastEventAt?: string;
  lastEventType?: string;
  eventsTableError?: string;
  eventsCheckError?: string;
  secretConfigured?: boolean;
  publicUrlConfigured?: boolean;
  webhookEndpoint?: string;
}

export default function GorgiasSettings() {
  const [settings, setSettings] = useState<GorgiasSettings>({
    enabled: false,
    domain: '',
    email: '',
    apiKey: '',
    webhookEnabled: false,
    webhookUrl: null,
    webhookSecret: null,
  });
  const [publicUrl, setPublicUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    tickets: 'unknown',
    messages: 'unknown',
    customers: 'unknown',
    users: 'unknown',
    tags: 'unknown',
  });
  const [webhookDiagnostics, setWebhookDiagnostics] = useState<WebhookDiagnostics | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const fetchDiagnostics = useCallback(async () => {
    if (!settings.enabled || !settings.webhookEnabled) return;
    setDiagnosing(true);
    try {
      const res = await fetch('/api/gorgias');
      if (res.ok) {
        const data = await res.json();
        setWebhookDiagnostics((data.webhook as WebhookDiagnostics) || null);
      }
    } catch {
      // Silently fail
    } finally {
      setDiagnosing(false);
    }
  }, [settings.enabled, settings.webhookEnabled]);

  // Load settings
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/gorgias/settings');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      setSettings(data);
      // Extract public URL and secret from webhook URL if available
      if (data.webhookUrl) {
        try {
          const url = new URL(data.webhookUrl);
          setPublicUrl(url.origin);
          const secretParam = url.searchParams.get('secret');
          if (secretParam) {
            setWebhookSecret(secretParam);
          }
        } catch {
          // Invalid webhookUrl format, extract origin from domain if available
          if (data.domain) {
            setPublicUrl(`https://${data.domain}`);
          }
        }
      }
      // Test connection if enabled
      if (data.enabled && data.domain) {
        testConnection(data);
      }
      // Fetch webhook diagnostics
      if (data.enabled && data.webhookEnabled) {
        fetchDiagnostics();
      }
    } catch (err) {
      console.error('Failed to load Gorgias settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async (config?: GorgiasSettings) => {
    const testSettings = config || settings;
    if (!testSettings.enabled || !testSettings.domain) return;

    setTesting(true);
    setConnectionStatus({
      tickets: 'unknown',
      messages: 'unknown',
      customers: 'unknown',
      users: 'unknown',
      tags: 'unknown',
    });

    // Test multiple endpoints in parallel
    const endpoints = [
      { name: 'tickets' as const, path: '/api/gorgias/tickets?limit=1' },
      { name: 'messages' as const, path: '/api/gorgias/messages?limit=1' },
      { name: 'customers' as const, path: '/api/gorgias/customers?limit=1' },
      { name: 'users' as const, path: '/api/gorgias/users?limit=1' },
      { name: 'tags' as const, path: '/api/gorgias/tags?limit=1' },
    ];

    const results = await Promise.all(
      endpoints.map(async (ep) => {
        try {
          const res = await fetch(ep.path);
          return { name: ep.name, status: res.ok ? 'connected' as const : 'error' as const };
        } catch {
          return { name: ep.name, status: 'error' as const };
        }
      })
    );

    const newStatus: ConnectionStatus = {
      tickets: 'unknown',
      messages: 'unknown',
      customers: 'unknown',
      users: 'unknown',
      tags: 'unknown',
    };
    results.forEach((r) => {
      newStatus[r.name] = r.status;
    });
    setConnectionStatus(newStatus);
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/gorgias/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.enabled,
          domain: settings.domain,
          email: settings.email,
          apiKey: settings.apiKey,
          webhookEnabled: settings.webhookEnabled,
          publicUrl: publicUrl,
          webhookSecret: webhookSecret || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        
        // 检查 Webhook 注册结果
        if (data.webhook && !data.webhook.success) {
          toast.error(`Gorgias 配置已保存，但 Webhook 注册失败: ${data.webhook.error || '未知错误'}`);
        } else if (data.webhook && data.webhook.success) {
          toast.success('Gorgias 配置已保存，Webhook 注册成功');
        } else {
          toast.success('Gorgias 配置已保存');
        }
        
        if (settings.enabled && settings.domain) {
          testConnection();
        }
        // Reload to get updated webhook URL
        loadSettings();
        // Refresh diagnostics after save
        setTimeout(() => fetchDiagnostics(), 1000);
      } else {
        let errorMsg = '保存失败';
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          // Response is not JSON
        }
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error('Failed to save Gorgias settings:', err);
      toast.error('网络错误，请检查连接后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleTestNow = () => {
    testConnection();
  };

  const copyWebhookUrl = async () => {
    if (settings.webhookUrl) {
      await navigator.clipboard.writeText(settings.webhookUrl);
      setCopied(true);
      toast.success('Webhook URL 已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusIcon = (status: 'unknown' | 'connected' | 'error') => {
    switch (status) {
      case 'connected':
        return <Check className="w-4 h-4 text-green-500" />;
      case 'error':
        return <X className="w-4 h-4 text-red-500" />;
      default:
        return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Gorgias 集成</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            连接 Gorgias Helpdesk，导入会话、聊天记录等数据
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestNow}
            disabled={!settings.enabled || !settings.domain || testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            {testing ? '测试中...' : '测试连接'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      {/* Enable Toggle */}
      <div className="mb-6 p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">启用 Gorgias 集成</p>
            <p className="text-xs text-muted-foreground">连接后可导入 Gorgias 的会话、聊天记录、客户等数据</p>
          </div>
          <button
            onClick={() => setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{ backgroundColor: settings.enabled ? 'var(--primary)' : 'var(--muted)' }}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                settings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Configuration Form */}
      {settings.enabled && (
        <div className="space-y-4">
          {/* API Credentials */}
          <div className="p-4 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Key className="w-4 h-4" />
              API 凭证
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Gorgias 域名</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={settings.domain}
                    onChange={(e) => setSettings((prev) => ({ ...prev, domain: e.target.value }))}
                    placeholder="例如: hwwued-bt 或 hwwued-bt.gorgias.com"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  在 Gorgias Settings → REST API 中获取，或输入完整 URL
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">API 用户邮箱</label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => setSettings((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="your-email@domain.com"
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  用于创建 API Key 的账户邮箱
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">API Key</label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="38ba3cbfa3c87ff94d4ef66d1b6c4edebd27f03d..."
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Settings → REST API 中创建或查看 API Key
                </p>
              </div>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="p-4 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Webhook className="w-4 h-4" />
              实时消息推送 (Webhook)
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div>
                  <p className="text-sm font-medium text-foreground">启用 Webhook</p>
                  <p className="text-xs text-muted-foreground">
                    Gorgias 收到新消息时自动推送到 SmartAssist
                  </p>
                </div>
                <button
                  onClick={() => setSettings((prev) => ({ ...prev, webhookEnabled: !prev.webhookEnabled }))}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus:ring-primary"
                  style={{ backgroundColor: settings.webhookEnabled ? 'var(--primary)' : 'var(--muted)' }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      settings.webhookEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {settings.webhookEnabled && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Webhook Secret（可选）
                    </label>
                    <input
                      type="text"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      placeholder="留空则自动生成随机 Secret"
                      className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:-ring-primary/30 font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      自定义 Webhook 验证密钥，需与 Gorgias 后台配置的 URL 中的 secret 参数一致
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      SmartAssist 公网地址
                    </label>
                    <input
                      type="url"
                      value={publicUrl}
                      onChange={(e) => setPublicUrl(e.target.value)}
                      placeholder="https://your-smartassist-domain.com"
                      className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      SmartAssist 部署后的公网访问地址，用于接收 Gorgias 的 Webhook 推送
                    </p>
                  </div>

                  {settings.webhookUrl && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <p className="text-sm font-medium text-green-500">Webhook 已配置</p>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Webhook URL（复制到 Gorgias）：</p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs bg-muted px-2 py-1 rounded break-all">
                              {settings.webhookUrl}
                            </code>
                            <button
                              onClick={copyWebhookUrl}
                              className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
                              title="复制"
                            >
                              {copied ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p>在 Gorgias 后台 Settings → Integrations → HTTP Integration 中配置上述 URL</p>
                          <p className="mt-1 text-amber-500/80">注意：请完整复制 URL，包括 <code className="bg-muted px-1 rounded">&amp;ticket_id={"{{ticket.id}}"}</code> 部分，Gorgias 会自动替换为实际工单 ID</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-500 font-medium mb-2">配置步骤：</p>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>在 Gorgias 后台进入 Settings → Integrations</li>
                      <li>点击 &ldquo;Add Integration&rdquo; → 选择 &ldquo;HTTP Integration&rdquo;</li>
                      <li>设置 URL 为上方的 Webhook URL</li>
                      <li>开启触发器: ticket-created, ticket-message-created, ticket-updated, ticket-handed-over</li>
                      <li>保存后即可接收实时消息</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Connection Status */}
          <div className="p-4 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-medium text-foreground mb-3">接口连接状态</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: '工单 (Tickets)', status: connectionStatus.tickets, endpoint: '/api/gorgias/tickets' },
                { name: '消息 (Messages)', status: connectionStatus.messages, endpoint: '/api/gorgias/messages' },
                { name: '客户 (Customers)', status: connectionStatus.customers, endpoint: '/api/gorgias/customers' },
                { name: '坐席 (Users)', status: connectionStatus.users, endpoint: '/api/gorgias/users' },
                { name: '标签 (Tags)', status: connectionStatus.tags, endpoint: '/api/gorgias/tags' },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="text-sm text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{item.endpoint}</p>
                  </div>
                  {getStatusIcon(item.status)}
                </div>
              ))}
            </div>
          </div>

          {/* Webhook Diagnostics */}
          {settings.webhookEnabled && (
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Webhook 诊断
                </h3>
                <button
                  onClick={fetchDiagnostics}
                  disabled={diagnosing}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${diagnosing ? 'animate-spin' : ''}`} />
                  {diagnosing ? '检查中...' : '刷新诊断'}
                </button>
              </div>
              {webhookDiagnostics ? (
                <div className="space-y-2">
                  {/* Integration Status */}
                  <div className={`p-3 rounded-lg ${
                    webhookDiagnostics.integrationFound 
                      ? 'bg-green-500/10 border border-green-500/20' 
                      : 'bg-red-500/10 border border-red-500/20'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      {webhookDiagnostics.integrationFound ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                      )}
                      <p className={`text-sm font-medium ${
                        webhookDiagnostics.integrationFound ? 'text-green-500' : 'text-red-500'
                      }`}>
                        {webhookDiagnostics.integrationFound 
                          ? `Gorgias Integration 已注册 (ID: ${webhookDiagnostics.integrationId})`
                          : 'Gorgias 中未找到 SmartAssist Webhook Integration'}
                      </p>
                    </div>
                    {webhookDiagnostics.integrationFound && webhookDiagnostics.triggers && (
                      <div className="text-xs text-muted-foreground ml-6">
                        <p>触发器状态：</p>
                        <ul className="mt-1 space-y-0.5">
                          {Object.entries(webhookDiagnostics.triggers).map(([key, val]) => (
                            <li key={key} className="flex items-center gap-1.5">
                              {val ? <Check className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-500" />}
                              {key}: {val ? '已启用' : '未启用'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!webhookDiagnostics.integrationFound && webhookDiagnostics.hint && (
                      <p className="text-xs text-red-400 ml-6">{webhookDiagnostics.hint}</p>
                    )}
                    {webhookDiagnostics.integrationCheckError && (
                      <p className="text-xs text-amber-500 ml-6">检查失败: {webhookDiagnostics.integrationCheckError}</p>
                    )}
                  </div>

                  {/* Recent Events */}
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs font-medium text-muted-foreground mb-1">最近处理的 Webhook 事件</p>
                    {webhookDiagnostics.lastEventAt ? (
                      <div className="text-xs text-foreground space-y-0.5">
                        <p>最后事件时间: {webhookDiagnostics.lastEventAt}</p>
                        <p>最后事件类型: {webhookDiagnostics.lastEventType || 'unknown'}</p>
                        <p>已处理事件数: {webhookDiagnostics.recentProcessedEvents ?? 0}</p>
                      </div>
                    ) : webhookDiagnostics.eventsTableError ? (
                      <p className="text-xs text-amber-500">事件表查询失败: {webhookDiagnostics.eventsTableError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">暂无已处理的 Webhook 事件</p>
                    )}
                  </div>

                  {/* Config Check */}
                  <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">配置检查</p>
                    <div className="flex items-center gap-1.5 text-xs">
                      {webhookDiagnostics.secretConfigured ? <Check className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-500" />}
                      <span>Webhook Secret: {webhookDiagnostics.secretConfigured ? '已配置' : '未配置'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      {webhookDiagnostics.publicUrlConfigured ? <Check className="w-3 h-3 text-green-500" /> : <X className="w-3 h-3 text-red-500" />}
                      <span>公网地址: {webhookDiagnostics.publicUrlConfigured ? '已配置' : '未配置'}</span>
                    </div>
                    {webhookDiagnostics.webhookEndpoint && (
                      <p className="text-xs text-muted-foreground font-mono mt-1 break-all">
                        Webhook 端点: {webhookDiagnostics.webhookEndpoint}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">点击&quot;刷新诊断&quot;检查 Webhook 配置状态</p>
              )}
            </div>
          )}

          {/* Available Endpoints */}
          <div className="p-4 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-medium text-foreground mb-3">可用的 API 接口</h3>
            <div className="space-y-2">
              {[
                { method: 'GET', path: '/api/gorgias/tickets', desc: '获取工单列表（支持筛选状态、时间范围）' },
                { method: 'GET', path: '/api/gorgias/tickets/[id]', desc: '获取单个工单详情（含消息）' },
                { method: 'GET', path: '/api/gorgias/messages', desc: '获取消息列表（支持按工单筛选）' },
                { method: 'GET', path: '/api/gorgias/customers', desc: '获取客户列表（支持搜索邮箱/姓名）' },
                { method: 'GET', path: '/api/gorgias/users', desc: '获取坐席用户列表' },
                { method: 'GET', path: '/api/gorgias/tags', desc: '获取标签列表' },
                { method: 'POST', path: '/api/gorgias/webhook', desc: 'Gorgias Webhook 接收端点（自动配置）' },
              ].map((ep) => (
                <div key={ep.path} className="flex items-start gap-2 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono font-medium shrink-0 ${
                      ep.method === 'GET' ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <span className="font-mono text-muted-foreground">{ep.path}</span>
                  <span className="text-muted-foreground/70">- {ep.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Documentation Link */}
          <div className="p-4 rounded-xl border border-dashed border-border bg-card/50">
            <a
              href="https://developers.gorgias.com/reference"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              查看 Gorgias API 完整文档
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
