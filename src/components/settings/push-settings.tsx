'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Edit3, Copy, Eye, EyeOff, Check, X } from 'lucide-react';
import type { PushTemplate } from '@/lib/types';
import { PUSH_EVENT_TYPES, CHANNEL_MAP } from './types';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface PushSettingsProps {
  pushTemplates: PushTemplate[];
  onPushTemplatesChange: React.Dispatch<React.SetStateAction<PushTemplate[]>>;
}

export function PushSettings({ pushTemplates, onPushTemplatesChange }: PushSettingsProps) {
  const [showPushTemplateModal, setShowPushTemplateModal] = useState(false);
  const [editingPushTemplate, setEditingPushTemplate] = useState<PushTemplate | null>(null);
  const [pushFormName, setPushFormName] = useState('');
  const [pushFormEvent, setPushFormEvent] = useState('order_shipped');
  const [pushFormContent, setPushFormContent] = useState('');
  const [pushFormChannels, setPushFormChannels] = useState<string[]>(['web']);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  // The full webhook secret is never sent to the client; we only store the
  // last-4-char preview fetched from /api/push/events (admin-only).
  const [webhookSecretPreview, setWebhookSecretPreview] = useState<{
    configured: boolean;
    last4: string | null;
    updated_at: string | null;
  }>({ configured: false, last4: null, updated_at: null });

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/push/webhook`
    : '/api/push/webhook';

  const loadWebhookSecretPreview = useCallback(async () => {
    try {
      const res = await fetch('/api/push/events', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.webhook_secret_preview) {
        setWebhookSecretPreview(data.webhook_secret_preview);
      }
    } catch (err) {
      logger.debug('加载 webhook secret preview 失败（非关键）', { error: err });
    }
  }, []);

  useEffect(() => {
    loadWebhookSecretPreview();
  }, [loadWebhookSecretPreview]);

  const loadPushTemplates = async () => {
    try {
      const res = await fetch('/api/push/templates');
      const data = await res.json();
      onPushTemplatesChange(data.templates || []);
    } catch (err) {
      logger.error('加载推送模板失败', { error: err });
    }
  };

  const resetPushForm = () => {
    setPushFormName('');
    setPushFormEvent('order_shipped');
    setPushFormContent('');
    setPushFormChannels(['web']);
  };

  const openEditPushTemplate = (template: PushTemplate) => {
    setEditingPushTemplate(template);
    setPushFormName(template.name);
    setPushFormEvent(template.trigger_event);
    setPushFormContent(template.content_template);
    setPushFormChannels(template.channels);
    setShowPushTemplateModal(true);
  };

  const openCreatePushTemplate = () => {
    setEditingPushTemplate(null);
    resetPushForm();
    setShowPushTemplateModal(true);
  };

  const handleSavePushTemplate = async () => {
    if (!pushFormName.trim() || !pushFormContent.trim() || pushFormChannels.length === 0) return;
    try {
      if (editingPushTemplate) {
        await fetch('/api/push/templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingPushTemplate.id, name: pushFormName, trigger_event: pushFormEvent, content_template: pushFormContent, channels: pushFormChannels }),
        });
      } else {
        await fetch('/api/push/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: pushFormName, trigger_event: pushFormEvent, content_template: pushFormContent, channels: pushFormChannels }),
        });
      }
      setShowPushTemplateModal(false);
      setEditingPushTemplate(null);
      resetPushForm();
      loadPushTemplates();
    } catch (err) {
      logger.error('保存推送模板失败', { error: err });
    }
  };

  const handleDeletePushTemplate = async (id: string) => {
    const confirmed = await confirm({
      title: '删除推送模板',
      description: '确定删除此模板？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await fetch(`/api/push/templates?id=${id}`, { method: 'DELETE' });
      loadPushTemplates();
    } catch (err) {
      logger.error('删除推送模板失败', { error: err });
    }
  };

  const handleTogglePushTemplate = async (template: PushTemplate) => {
    try {
      await fetch('/api/push/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: template.id, is_enabled: !template.is_enabled }),
      });
      loadPushTemplates();
    } catch (err) {
      logger.error('更新模板状态失败', { error: err });
    }
  };

  const copyToClipboard = async (text: string, type: 'url' | 'secret') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'url') { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); }
      else { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
    } catch { /* ignore */ }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">主动推送</h2>
          <p className="text-xs text-muted-foreground mt-0.5">基于订单状态变更的主动消息推送管理</p>
        </div>
        <button
          onClick={openCreatePushTemplate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新建模板
        </button>
      </div>

      {/* Push Templates Card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <h3 className="text-xs font-medium text-foreground mb-3">推送模板</h3>
        {pushTemplates.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">暂无推送模板</div>
        ) : (
          <div className="space-y-2">
            {pushTemplates.map((tpl) => {
              const eventInfo = PUSH_EVENT_TYPES[tpl.trigger_event];
              return (
                <div key={tpl.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                      {eventInfo && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium ${eventInfo.color}`}>
                          {eventInfo.icon}
                          {eventInfo.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground max-w-[300px] truncate">{tpl.content_template}</span>
                      <span className="text-xs text-muted-foreground/60">
                        {tpl.channels.map((ch) => CHANNEL_MAP[ch]?.icon).join(' ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTogglePushTemplate(tpl)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {tpl.is_enabled ? (
                        <ToggleRight className="w-5 h-5 text-primary" />
                      ) : (
                        <ToggleLeft className="w-5 h-5" />
                      )}
                    </button>
                    <button
                      onClick={() => openEditPushTemplate(tpl)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeletePushTemplate(tpl.id)}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Webhook Configuration Card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <h3 className="text-xs font-medium text-foreground mb-3">Webhook 配置</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Webhook URL</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={webhookUrl}
                readOnly
                className="flex-1 bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground font-mono"
              />
              <button
                onClick={() => copyToClipboard(webhookUrl, 'url')}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted text-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedUrl ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">签名密钥</label>
            <div className="flex items-center gap-2">
              <input
                type={showSecret ? 'text' : 'password'}
                value={webhookSecretPreview.configured
                  ? (showSecret && webhookSecretPreview.last4
                      ? `••••••••••••${webhookSecretPreview.last4}`
                      : '••••••••••••••••')
                  : '尚未配置'}
                readOnly
                className="flex-1 bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground font-mono"
              />
              <button
                onClick={() => setShowSecret(!showSecret)}
                className="p-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={showSecret ? '隐藏' : '显示末尾 4 位'}
                disabled={!webhookSecretPreview.configured}
              >
                {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() =>
                  webhookSecretPreview.last4 &&
                  copyToClipboard(`••••••••••••${webhookSecretPreview.last4}`, 'secret')
                }
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted text-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
                disabled={!webhookSecretPreview.configured}
              >
                {copiedSecret ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedSecret ? '已复制' : '复制末四位'}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              为安全考虑，签名密钥不会在界面回显。完整密钥请通过服务端运维流程获取。
              {webhookSecretPreview.updated_at && (
                <> · 上次更新：{new Date(webhookSecretPreview.updated_at).toLocaleString('zh-CN')}</>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Event Subscriptions Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-xs font-medium text-foreground mb-3">事件订阅</h3>
        <div className="space-y-1">
          {Object.entries(PUSH_EVENT_TYPES).map(([key, info]) => {
            const enabledTemplates = pushTemplates.filter((t) => t.trigger_event === key && t.is_enabled);
            return (
              <div key={key} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium ${info.color}`}>
                    {info.icon}
                    {info.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {enabledTemplates.length} 个关联模板
                  </span>
                </div>
                <span className={`w-2 h-2 rounded-full ${enabledTemplates.length > 0 ? 'bg-success' : 'bg-muted-foreground/30'}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Template Modal */}
      {showPushTemplateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-float w-[520px] max-h-[80vh] overflow-y-auto popup-enter">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-medium text-foreground">
                {editingPushTemplate ? '编辑推送模板' : '新建推送模板'}
              </h3>
              <button
                onClick={() => { setShowPushTemplateModal(false); setEditingPushTemplate(null); resetPushForm(); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">模板名称</label>
                <input
                  type="text"
                  value={pushFormName}
                  onChange={(e) => setPushFormName(e.target.value)}
                  placeholder="如：订单已发货通知"
                  className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">触发事件</label>
                <select
                  value={pushFormEvent}
                  onChange={(e) => setPushFormEvent(e.target.value)}
                  className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {Object.entries(PUSH_EVENT_TYPES).map(([key, info]) => (
                    <option key={key} value={key}>{info.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">推送内容模板</label>
                <textarea
                  value={pushFormContent}
                  onChange={(e) => setPushFormContent(e.target.value)}
                  placeholder="支持变量：{order_id}, {courier}, {tracking_no}, {amount}, {reason}, {delay_days}"
                  rows={4}
                  className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
                <div className="text-[10px] text-muted-foreground/60 mt-1">
                  可用变量: {'{order_id}'}, {'{courier}'}, {'{tracking_no}'}, {'{amount}'}, {'{reason}'}, {'{delay_days}'}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">推送渠道</label>
                <div className="flex items-center gap-3">
                  {Object.entries(CHANNEL_MAP).map(([key, info]) => (
                    <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pushFormChannels.includes(key)}
                        onChange={(e) => {
                          if (e.target.checked) setPushFormChannels([...pushFormChannels, key]);
                          else setPushFormChannels(pushFormChannels.filter((c) => c !== key));
                        }}
                        className="rounded border-border"
                      />
                      <span className="text-sm text-foreground">
                        {info.icon} {info.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                onClick={() => { setShowPushTemplateModal(false); setEditingPushTemplate(null); resetPushForm(); }}
                className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSavePushTemplate}
                disabled={!pushFormName.trim() || !pushFormContent.trim() || pushFormChannels.length === 0}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {editingPushTemplate ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
