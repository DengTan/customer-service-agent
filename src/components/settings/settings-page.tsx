'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, ToggleLeft, ToggleRight, Save, RotateCcw, Check,
  Link2, Unlink, ExternalLink, Bot, Palette, Cpu, MessageSquare,
  Bell, Edit3, Copy, Eye, EyeOff, RefreshCw, X, Network, ChevronRight, ChevronDown,
  Package, Truck, CreditCard, XCircle, Clock, AlertTriangle,
  Store, Globe, Users, UserCheck,
} from 'lucide-react';
import type { PushTemplate } from '@/lib/types';
import ShopCreateWizard from './shop-create-wizard';
import GorgiasSettings from './gorgias-settings';
import { AgentAssignmentSettings } from './agent-assignment-settings';
import SensitiveWordManager from './sensitive-word-manager';
import DomainWhitelistManager from './domain-whitelist-manager';

interface AutoReplyRule {
  id: string;
  keyword: string;
  match_mode: 'exact' | 'fuzzy';
  reply_content: string;
  is_enabled: boolean;
  priority: number;
}

/** Push event type definitions */
const PUSH_EVENT_TYPES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  order_shipped: { label: '订单已发货', color: 'bg-primary/10 text-primary', icon: <Truck className="w-3 h-3" /> },
  order_delivered: { label: '订单已签收', color: 'bg-success/10 text-success', icon: <Package className="w-3 h-3" /> },
  refund_completed: { label: '退款已到账', color: 'bg-emerald-500/10 text-emerald-600', icon: <CreditCard className="w-3 h-3" /> },
  refund_rejected: { label: '退款已拒绝', color: 'bg-destructive/10 text-destructive', icon: <XCircle className="w-3 h-3" /> },
  logistics_delayed: { label: '物流延迟', color: 'bg-amber-500/10 text-amber-600', icon: <Clock className="w-3 h-3" /> },
};

const CHANNEL_MAP: Record<string, { label: string; icon: string }> = {
  web: { label: 'Web', icon: '🌐' },
  doudian: { label: '抖店', icon: '🛒' },
  sms: { label: '短信', icon: '📱' },
};

const AI_MODELS = [
  { value: 'doubao-seed-2-0-lite-260215', label: 'Doubao Seed 2.0 Lite', desc: '轻量快速，适合日常对话' },
  { value: 'doubao-seed-1-6-250615', label: 'Doubao Seed 1.6', desc: '均衡性能，适合复杂问答' },
  { value: 'deepseek-v3-250324', label: 'DeepSeek V3', desc: '深度推理，适合专业场景' },
];

const MULTIMODAL_MODELS = [
  { value: 'doubao-seed-2-0-pro-260215', label: 'Doubao Seed 2.0 Pro', desc: '多模态旗舰，支持图片理解' },
];

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: '💻' },
  { value: 'light', label: '浅色模式', icon: '☀️' },
  { value: 'dark', label: '深色模式', icon: '🌙' },
];

const FACTORY_DEFAULTS: Record<string, string> = {
  welcome_message: '您好！欢迎使用 SmartAssist 智能客服，请问有什么可以帮助您的？',
  session_timeout: '30',
  max_turns: '20',
  rating_enabled: 'true',
  new_conversation_notify: 'true',
  unhandled_remind: 'true',
  alert_confidence_threshold: '0.4',
  alert_confidence_critical_threshold: '0.2',
  alert_high_rounds_threshold: '10',
  alert_high_rounds_critical_threshold: '15',
  alert_auto_handoff_rounds: '6',
  ai_model: 'doubao-seed-2-0-lite-260215',
  multimodal_enabled: 'true',
  multimodal_model: 'doubao-seed-2-0-pro-260215',
  multimodal_disabled_action: 'fixed_message',
  multimodal_fixed_message: '抱歉，当前未开启图片识别功能，无法识别您发送的图片。如需帮助，请转接人工客服或以文字描述您的问题。',
  ai_temperature: '0.7',
  ai_max_tokens: '2048',
  ai_max_concurrent: '0',
  knowledge_min_score: '0.75',
  knowledge_search_limit: '5',
  knowledge_image_search_limit: '3',
  content_filter_enabled: 'true',
  sensitive_word_filter_enabled: 'true',
  url_filter_enabled: 'true',
  url_filter_mode: 'whitelist',
  sensitive_word_default_action: 'block',
  url_block_message: '抱歉,发送的链接不在白名单范围内',
  system_prompt: `你是 SmartAssist 智能客服助手，专注于为用户提供专业、准确、友好的客户服务。

核心职责：
1. 回答用户关于产品、订单、退换货、支付等常见问题
2. 根据知识库内容提供准确信息，并在回复中标注引用来源
3. 引导用户完成相关操作流程
4. 遇到无法解决的问题时，建议转接人工客服

对话原则：
- 语气友好专业，简洁明了
- 优先使用知识库中的信息回答问题
- 如果知识库中没有相关内容，诚实告知并建议其他获取帮助的途径
- 多轮对话中记住上下文，保持连贯性
- 当用户表达不满时，先表示理解再提供解决方案

回复格式：
- 如果引用了知识库信息，在回复末尾用【引用来源：xxx】标注
- 分步骤说明时使用编号列表
- 关键信息使用加粗标记`,
  theme: 'system',
  font_size: '14',
  show_timestamps: 'true',
  compact_mode: 'false',
};

const DEFAULT_SYSTEM_PROMPT = `你是 SmartAssist 智能客服助手，专注于为用户提供专业、准确、友好的客户服务。

核心职责：
1. 回答用户关于产品、订单、退换货、支付等常见问题
2. 根据知识库内容提供准确信息，并在回复中标注引用来源
3. 引导用户完成相关操作流程
4. 遇到无法解决的问题时，建议转接人工客服

对话原则：
- 语气友好专业，简洁明了
- 优先使用知识库中的信息回答问题
- 如果知识库中没有相关内容，诚实告知并建议其他获取帮助的途径
- 多轮对话中记住上下文，保持连贯性
- 当用户表达不满时，先表示理解再提供解决方案

回复格式：
- 如果引用了知识库信息，在回复末尾用【引用来源：xxx】标注
- 分步骤说明时使用编号列表
- 关键信息使用加粗标记`;

export function SettingsPage() {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState<{ keyword: string; match_mode: 'exact' | 'fuzzy'; reply_content: string; priority: number }>({ keyword: '', match_mode: 'fuzzy', reply_content: '', priority: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activeSection, setActiveSection] = useState<'auto-reply' | 'chat' | 'ai' | 'alert' | 'appearance' | 'shop' | 'agent-assignment' | 'push' | 'bot' | 'gorgias'>('auto-reply');

  // Content filter state
  const [showSensitiveWordManager, setShowSensitiveWordManager] = useState(false);
  const [showDomainManager, setShowDomainManager] = useState(false);
  const [sensitiveWordCount, setSensitiveWordCount] = useState(0);
  const [domainCount, setDomainCount] = useState(0);

  // Push templates state
  const [pushTemplates, setPushTemplates] = useState<PushTemplate[]>([]);
  const [showPushTemplateModal, setShowPushTemplateModal] = useState(false);
  const [editingPushTemplate, setEditingPushTemplate] = useState<PushTemplate | null>(null);
  const [pushFormName, setPushFormName] = useState('');
  const [pushFormEvent, setPushFormEvent] = useState('order_shipped');
  const [pushFormContent, setPushFormContent] = useState('');
  const [pushFormChannels, setPushFormChannels] = useState<string[]>(['web']);
  // Webhook / events state
  const [webhookSecret, setWebhookSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Bot & Sub-Agent state
  const [mainBots, setMainBots] = useState<Array<{
    id: string; name: string; description: string; system_prompt: string;
    tools: string[]; knowledge_ids: string[]; is_default: boolean;
    parent_bot_id: string | null; is_sub_agent: boolean; status: string;
    sub_agent_count?: number; created_at: string;
  }>>([]);
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);
  const [subAgents, setSubAgents] = useState<Record<string, Array<{
    id: string; name: string; description: string; system_prompt: string;
    tools: string[]; knowledge_ids: string[]; parent_bot_id: string;
    delegation_prompt: string | null; collaboration_config: Record<string, unknown> | null;
    is_sub_agent: boolean; status: string; created_at: string;
  }>>>({});
  const [showBotModal, setShowBotModal] = useState(false);
  const [showSubAgentModal, setShowSubAgentModal] = useState(false);
  const [editingBot, setEditingBot] = useState<typeof mainBots[0] | null>(null);
  const [editingSubAgent, setEditingSubAgent] = useState<{ parentBotId: string; agent: typeof subAgents[string][0] | null }>({ parentBotId: '', agent: null });
  const [botForm, setBotForm] = useState({ name: '', description: '', system_prompt: '' });
  const [subAgentForm, setSubAgentForm] = useState({ name: '', description: '', system_prompt: '', tools: [] as string[], delegation_prompt: '', collaboration_config: '' });
  const [selectedParentBotId, setSelectedParentBotId] = useState('');

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/push/webhook`
    : '/api/push/webhook';

  // Shop management state
  const [shops, setShops] = useState<Array<{
    id: string;
    name: string;
    platform: string;
    shop_url: string | null;
    logo_url: string | null;
    total_accounts: number;
    used_accounts: number;
    status: string;
    contact_name: string | null;
    contact_phone: string | null;
    remark: string | null;
    created_at: string;
    config: Record<string, unknown> | null;
    knowledge_ids: string[] | null;
  }>>([]);
  const [shopStats, setShopStats] = useState({ total: 0, totalAccounts: 0, usedAccounts: 0, availableAccounts: 0 });
  const [showShopWizard, setShowShopWizard] = useState(false);
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [editShop, setEditShop] = useState<{
    name: string;
    platform: string;
    shop_url: string;
    total_accounts: number;
    contact_name: string;
    contact_phone: string;
    remark: string;
    config: Record<string, unknown>;
    knowledge_ids: string[];
  } | null>(null);


  // Format time remaining
  const formatTimeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return '已过期';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}天${h}小时`;
    if (h > 0) return `${h}小时${m}分钟`;
    return `${m}分钟`;
  };

  // Loading state
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rulesRes, settingsRes, pushTemplatesRes, pushEventsRes, shopsRes] = await Promise.all([
        fetch('/api/auto-reply'),
        fetch('/api/settings'),
        fetch('/api/push/templates'),
        fetch('/api/push/events'),
        fetch('/api/shops?stats=true').catch(() => null),
      ]);
      const rulesData = await rulesRes.json();
      const settingsData = await settingsRes.json();
      const pushTemplatesData = await pushTemplatesRes.json();
      const pushEventsData = await pushEventsRes.json();
      setRules(rulesData.rules || []);
      setSettings(settingsData.settings || {});
      setPushTemplates(pushTemplatesData.templates || []);
      if (pushEventsData.webhook_secret) {
        setWebhookSecret(pushEventsData.webhook_secret);
      }
      // Load shops data
      if (shopsRes?.ok) {
        const shopsData = await shopsRes.json();
        setShops(shopsData.shops || []);
        setShopStats(shopsData.stats || { total: 0, totalAccounts: 0, usedAccounts: 0, availableAccounts: 0 });
      }
      // Load main bots
      loadMainBots();
    } catch (err) {
      console.error('加载设置失败:', err);
      toast.error('加载设置失败，请刷新重试');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleRule = async (id: string, enabled: boolean) => {
    // Optimistic update
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: enabled } : r)));
    try {
      const res = await fetch('/api/auto-reply', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: enabled }),
      });
      if (!res.ok) {
        // Revert on failure
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: !enabled } : r)));
      }
    } catch {
      // Revert on error
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_enabled: !enabled } : r)));
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/auto-reply?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id));
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
        setRules((prev) => [...prev, data.rule]);
        setShowAddRule(false);
        setNewRule({ keyword: '', match_mode: 'fuzzy', reply_content: '', priority: 0 });
      }
    } catch {
      // ignore
    }
  };

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
    if (!confirm('确定恢复出厂默认设置？所有自定义配置将被覆盖，此操作不可撤销。')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: FACTORY_DEFAULTS }),
      });
      if (res.ok) {
        setSettings({ ...FACTORY_DEFAULTS });
        toast.success('已恢复出厂默认设置');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '恢复默认设置失败');
      }
    } catch {
      toast.error('恢复默认设置失败，请检查网络连接');
    } finally {
      setResetting(false);
    }
  };


  const handleDeleteShop = async (id: string) => {
    if (!confirm('确定删除此店铺？删除后，与该店铺关联的客服账号也将被删除，此操作不可撤销。')) return;
    try {
      const res = await fetch(`/api/shops/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const deleted = shops.find((s) => s.id === id);
        setShops((prev) => prev.filter((s) => s.id !== id));
        if (deleted) {
          setShopStats((prev) => ({
            total: prev.total - 1,
            totalAccounts: prev.totalAccounts - deleted.total_accounts,
            usedAccounts: prev.usedAccounts - deleted.used_accounts,
            availableAccounts: prev.availableAccounts - (deleted.total_accounts - deleted.used_accounts),
          }));
        }
        toast.success('店铺已删除');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '删除店铺失败');
      }
    } catch {
      toast.error('删除店铺失败，请检查网络连接');
    }
  };

  const handleToggleShopStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch(`/api/shops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.shop) {
        setShops((prev) => prev.map((s) => (s.id === id ? { ...s, status: newStatus } : s)));
        toast.success(newStatus === 'active' ? '店铺已启用' : '店铺已禁用');
      }
    } catch {
      toast.error('操作失败');
    }
  };

  const handleUpdateShop = async () => {
    if (!editingShopId || !editShop) return;
    try {
      const res = await fetch(`/api/shops/${editingShopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editShop.name,
          platform: editShop.platform,
          shop_url: editShop.shop_url || null,
          total_accounts: editShop.total_accounts,
          contact_name: editShop.contact_name || null,
          contact_phone: editShop.contact_phone || null,
          remark: editShop.remark || null,
          config: editShop.config || {},
          knowledge_ids: editShop.knowledge_ids || [],
        }),
      });
      const data = await res.json();
      if (data.shop) {
        // Recalculate stats
        const oldShop = shops.find((s) => s.id === editingShopId);
        setShops((prev) => prev.map((s) => (s.id === editingShopId ? { ...s, ...data.shop } : s)));
        if (oldShop) {
          const accountsDiff = (editShop.total_accounts || 0) - oldShop.total_accounts;
          if (accountsDiff !== 0) {
            setShopStats((prev) => ({
              ...prev,
              totalAccounts: prev.totalAccounts + accountsDiff,
              availableAccounts: prev.availableAccounts + accountsDiff,
            }));
          }
        }
        setEditingShopId(null);
        setEditShop(null);
        toast.success('店铺更新成功');
      }
    } catch {
      toast.error('更新店铺失败');
    }
  };

  const startEditShop = (shop: typeof shops[0]) => {
    setEditingShopId(shop.id);
    setEditShop({
      name: shop.name,
      platform: shop.platform,
      shop_url: shop.shop_url || '',
      total_accounts: shop.total_accounts,
      contact_name: shop.contact_name || '',
      contact_phone: shop.contact_phone || '',
      remark: shop.remark || '',
      config: (shop.config as Record<string, unknown>) || {},
      knowledge_ids: (shop.knowledge_ids as string[]) || [],
    });
  };

  // Push template handlers
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
      console.error('保存推送模板失败:', err);
      toast.error('保存推送模板失败，请重试');
    }
  };

  const handleDeletePushTemplate = async (id: string) => {
    if (!confirm('确定删除此模板？')) return;
    try {
      await fetch(`/api/push/templates?id=${id}`, { method: 'DELETE' });
      loadPushTemplates();
    } catch (err) {
      console.error('删除推送模板失败:', err);
      toast.error('删除推送模板失败，请重试');
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
      console.error('更新模板状态失败:', err);
      toast.error('更新模板状态失败，请重试');
    }
  };

  const loadPushTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/push/templates');
      const data = await res.json();
      setPushTemplates(data.templates || []);
    } catch (err) {
      console.error('加载推送模板失败:', err);
    }
  }, []);

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

  const copyToClipboard = async (text: string, type: 'url' | 'secret') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'url') { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); }
      else { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }
    } catch { /* ignore */ }
  };

  // Bot & Sub-Agent handlers
  const loadMainBots = useCallback(async () => {
    try {
      const res = await fetch('/api/sub-agents?main_bots=true');
      const data = await res.json();
      setMainBots(data.bots || []);
    } catch (err) {
      console.error('加载Bot列表失败:', err);
    }
  }, []);

  const loadSubAgents = useCallback(async (parentBotId: string) => {
    try {
      const res = await fetch(`/api/sub-agents?parent_bot_id=${parentBotId}`);
      const data = await res.json();
      setSubAgents((prev) => ({ ...prev, [parentBotId]: data.subAgents || [] }));
    } catch (err) {
      console.error('加载子Agent失败:', err);
    }
  }, []);

  const handleToggleBotExpand = (botId: string) => {
    if (expandedBotId === botId) {
      setExpandedBotId(null);
    } else {
      setExpandedBotId(botId);
      if (!subAgents[botId]) loadSubAgents(botId);
    }
  };

  const handleCreateBot = async () => {
    if (!botForm.name.trim()) return;
    try {
      const res = await fetch('/api/bot-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...botForm, tools: [], knowledge_ids: [], skill_group_id: '' }),
      });
      const data = await res.json();
      if (data.config) {
        loadMainBots();
        setShowBotModal(false);
        setBotForm({ name: '', description: '', system_prompt: '' });
        toast.success('主Bot创建成功');
      }
    } catch (err) {
      console.error('创建Bot失败:', err);
      toast.error('创建Bot失败');
    }
  };

  const handleCreateSubAgent = async () => {
    if (!subAgentForm.name.trim() || !selectedParentBotId) return;
    try {
      const collaborationConfig = subAgentForm.collaboration_config
        ? JSON.parse(subAgentForm.collaboration_config)
        : null;
      const res = await fetch('/api/sub-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_bot_id: selectedParentBotId,
          name: subAgentForm.name,
          description: subAgentForm.description,
          system_prompt: subAgentForm.system_prompt,
          tools: subAgentForm.tools,
          delegation_prompt: subAgentForm.delegation_prompt || null,
          collaboration_config: collaborationConfig,
        }),
      });
      const data = await res.json();
      if (data.subAgent) {
        loadSubAgents(selectedParentBotId);
        loadMainBots();
        setShowSubAgentModal(false);
        setSubAgentForm({ name: '', description: '', system_prompt: '', tools: [], delegation_prompt: '', collaboration_config: '' });
        toast.success('子Agent创建成功');
      }
    } catch (err) {
      console.error('创建子Agent失败:', err);
      toast.error('创建子Agent失败');
    }
  };

  const handleUpdateSubAgent = async () => {
    if (!editingSubAgent.agent || !editingSubAgent.parentBotId) return;
    try {
      const collaborationConfig = subAgentForm.collaboration_config
        ? JSON.parse(subAgentForm.collaboration_config)
        : null;
      const res = await fetch('/api/sub-agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSubAgent.agent.id,
          name: subAgentForm.name,
          description: subAgentForm.description,
          system_prompt: subAgentForm.system_prompt,
          tools: subAgentForm.tools,
          delegation_prompt: subAgentForm.delegation_prompt || null,
          collaboration_config: collaborationConfig,
        }),
      });
      const data = await res.json();
      if (data.success) {
        loadSubAgents(editingSubAgent.parentBotId);
        setShowSubAgentModal(false);
        setSubAgentForm({ name: '', description: '', system_prompt: '', tools: [], delegation_prompt: '', collaboration_config: '' });
        toast.success('子Agent更新成功');
      }
    } catch (err) {
      console.error('更新子Agent失败:', err);
      toast.error('更新子Agent失败');
    }
  };

  const handleDeleteSubAgent = async (id: string, parentBotId: string) => {
    if (!confirm('确定删除此子Agent？')) return;
    try {
      const res = await fetch(`/api/sub-agents?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadSubAgents(parentBotId);
        loadMainBots();
        toast.success('子Agent已删除');
      }
    } catch (err) {
      console.error('删除子Agent失败:', err);
      toast.error('删除子Agent失败');
    }
  };

  const handleToggleSubAgentStatus = async (agent: typeof subAgents[string][0], parentBotId: string) => {
    try {
      const newStatus = agent.status === 'active' ? 'inactive' : 'active';
      await fetch('/api/sub-agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, status: newStatus }),
      });
      loadSubAgents(parentBotId);
    } catch (err) {
      console.error('更新子Agent状态失败:', err);
      toast.error('更新子Agent状态失败');
    }
  };

  const handleDeleteBot = async (id: string) => {
    if (!confirm('确定删除此Bot？其下所有子Agent也将被删除。')) return;
    try {
      const res = await fetch(`/api/bot-configs?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadMainBots();
        setExpandedBotId(null);
        toast.success('Bot已删除');
      }
    } catch (err) {
      console.error('删除Bot失败:', err);
      toast.error('删除Bot失败');
    }
  };

  const openCreateSubAgent = (parentBotId: string) => {
    setSelectedParentBotId(parentBotId);
    setEditingSubAgent({ parentBotId: '', agent: null });
    setSubAgentForm({ name: '', description: '', system_prompt: '', tools: [], delegation_prompt: '', collaboration_config: '' });
    setShowSubAgentModal(true);
  };

  const openEditSubAgent = (parentBotId: string, agent: typeof subAgents[string][0]) => {
    setSelectedParentBotId(parentBotId);
    setEditingSubAgent({ parentBotId, agent });
    setSubAgentForm({
      name: agent.name,
      description: agent.description || '',
      system_prompt: agent.system_prompt || '',
      tools: agent.tools || [],
      delegation_prompt: agent.delegation_prompt || '',
      collaboration_config: agent.collaboration_config ? JSON.stringify(agent.collaboration_config, null, 2) : '',
    });
    setShowSubAgentModal(true);
  };

  const AVAILABLE_TOOLS = [
    { value: 'order_query', label: '查询订单' },
    { value: 'logistics_query', label: '查询物流' },
    { value: 'refund_action', label: '退款操作' },
  ];

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      connected: 'bg-success/10 text-success',
      pending: 'bg-warning/10 text-warning',
      expired: 'bg-destructive/10 text-destructive',
      disconnected: 'bg-muted text-muted-foreground',
    };
    const labels: Record<string, string> = {
      connected: '已连接',
      pending: '待授权',
      expired: '已过期',
      disconnected: '未连接',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || styles.disconnected}`}>
        {labels[status] || status}
      </span>
    );
  };

  const sections = [
    { key: 'auto-reply' as const, label: '自动回复规则', icon: MessageSquare },
    { key: 'chat' as const, label: '对话设置', icon: MessageSquare },
    { key: 'ai' as const, label: 'AI 模型', icon: Cpu },
    { key: 'alert' as const, label: '异常告警', icon: AlertTriangle },
    { key: 'appearance' as const, label: '外观', icon: Palette },
    { key: 'shop' as const, label: '店铺管理', icon: Store },
    { key: 'agent-assignment' as const, label: '坐席分配', icon: Users },
    { key: 'push' as const, label: '主动推送', icon: Bell },
    { key: 'bot' as const, label: 'Bot与子Agent', icon: Network },
    { key: 'gorgias' as const, label: 'Gorgias 集成', icon: Globe },
  ];

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
            disabled={saving}
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
        <div className="w-48 border-r border-border bg-card/50 py-4 px-3 shrink-0">
          <nav className="space-y-0.5">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 text-left ${
                    activeSection === s.key
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {s.label}
                </button>
              );
            })}
          </nav>
        </div>

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
            {/* Auto Reply Rules */}
            {activeSection === 'auto-reply' && (
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
            )}

            {/* Chat Settings */}
            {activeSection === 'chat' && (
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-1">对话设置</h2>
                <p className="text-xs text-muted-foreground mb-4">配置对话行为和交互方式</p>
                <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                  <div>
                    <label className="text-xs font-medium text-foreground mb-1 block">欢迎语</label>
                    <textarea
                      value={settings.welcome_message || ''}
                      onChange={(e) => setSettings((prev) => ({ ...prev, welcome_message: e.target.value }))}
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
                        onChange={(e) => setSettings((prev) => ({ ...prev, session_timeout: e.target.value }))}
                        min="1"
                        className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-foreground mb-1 block">最大对话轮次</label>
                      <input
                        type="number"
                        value={settings.max_turns || '20'}
                        onChange={(e) => setSettings((prev) => ({ ...prev, max_turns: e.target.value }))}
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
                      onClick={() => setSettings((prev) => ({ ...prev, rating_enabled: prev.rating_enabled === 'true' ? 'false' : 'true' }))}
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
                      onClick={() => setSettings((prev) => ({ ...prev, new_conversation_notify: prev.new_conversation_notify === 'true' ? 'false' : 'true' }))}
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
                      onClick={() => setSettings((prev) => ({ ...prev, unhandled_remind: prev.unhandled_remind === 'true' ? 'false' : 'true' }))}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {settings.unhandled_remind === 'true' ? (
                        <ToggleRight className="w-6 h-6 text-primary" />
                      ) : (
                        <ToggleLeft className="w-6 h-6" />
                      )}
                    </button>
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
                          onClick={() => setSettings((prev) => ({ ...prev, content_filter_enabled: prev.content_filter_enabled === 'true' ? 'false' : 'true' }))}
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
                          onClick={() => setSettings((prev) => ({ ...prev, sensitive_word_filter_enabled: prev.sensitive_word_filter_enabled === 'true' ? 'false' : 'true' }))}
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
                          onClick={() => setSettings((prev) => ({ ...prev, url_filter_enabled: prev.url_filter_enabled === 'true' ? 'false' : 'true' }))}
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
                          onChange={(e) => setSettings((prev) => ({ ...prev, url_block_message: e.target.value }))}
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
              </section>
            )}

            {/* AI Model Settings */}
            {activeSection === 'ai' && (
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-1">AI 模型配置</h2>
                <p className="text-xs text-muted-foreground mb-4">选择模型和调整参数以优化回复质量</p>

                <div className="space-y-6">
                  {/* Regular Model Selection */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <label className="text-xs font-medium text-foreground mb-1 block">普通模型</label>
                    <p className="text-xs text-muted-foreground mb-3">用于日常文本对话，不具备图片识别能力</p>
                    <div className="space-y-2">
                      {AI_MODELS.map((model) => (
                        <button
                          key={model.value}
                          onClick={() => setSettings((prev) => ({ ...prev, ai_model: model.value }))}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors ${
                            (settings.ai_model || 'doubao-seed-2-0-lite-260215') === model.value
                              ? 'border-primary bg-primary/5'
                              : 'hover:border-primary/30 hover:bg-muted/30'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            (settings.ai_model || 'doubao-seed-2-0-lite-260215') === model.value
                              ? 'border-primary'
                              : 'border-muted-foreground/30'
                          }`}>
                            {(settings.ai_model || 'doubao-seed-2-0-lite-260215') === model.value && (
                              <div className="w-2 h-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{model.label}</p>
                            <p className="text-xs text-muted-foreground">{model.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Multimodal Model Selection */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-foreground block">多模态模型</label>
                      <button
                        onClick={() => setSettings((prev) => ({ ...prev, multimodal_enabled: prev.multimodal_enabled === 'false' ? 'true' : 'false' }))}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          settings.multimodal_enabled !== 'false' ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          settings.multimodal_enabled !== 'false' ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      {settings.multimodal_enabled !== 'false'
                        ? '已启用，用户发送图片时自动调用多模态模型进行识别'
                        : '已关闭，用户发送图片时按下方策略处理'}
                    </p>
                    <div className="space-y-2">
                      {MULTIMODAL_MODELS.map((model) => (
                        <button
                          key={model.value}
                          onClick={() => setSettings((prev) => ({ ...prev, multimodal_model: model.value }))}
                          disabled={settings.multimodal_enabled === 'false'}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors ${
                            settings.multimodal_enabled === 'false' ? 'opacity-40 cursor-not-allowed' :
                            (settings.multimodal_model || 'doubao-seed-2-0-pro-260215') === model.value
                              ? 'border-primary bg-primary/5'
                              : 'hover:border-primary/30 hover:bg-muted/30'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            (settings.multimodal_model || 'doubao-seed-2-0-pro-260215') === model.value && settings.multimodal_enabled !== 'false'
                              ? 'border-primary'
                              : 'border-muted-foreground/30'
                          }`}>
                            {(settings.multimodal_model || 'doubao-seed-2-0-pro-260215') === model.value && settings.multimodal_enabled !== 'false' && (
                              <div className="w-2 h-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{model.label}</p>
                            <p className="text-xs text-muted-foreground">{model.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Multimodal disabled action — only visible when multimodal is off */}
                    {settings.multimodal_enabled === 'false' && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <label className="text-xs font-medium text-foreground mb-2 block">图片处理策略</label>
                        <p className="text-xs text-muted-foreground mb-3">多模态关闭时，用户发送图片的处理方式</p>
                        <div className="space-y-2">
                          <button
                            onClick={() => setSettings((prev) => ({ ...prev, multimodal_disabled_action: 'fixed_message' }))}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors ${
                              (settings.multimodal_disabled_action || 'fixed_message') === 'fixed_message'
                                ? 'border-primary bg-primary/5'
                                : 'hover:border-primary/30 hover:bg-muted/30'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              (settings.multimodal_disabled_action || 'fixed_message') === 'fixed_message'
                                ? 'border-primary'
                                : 'border-muted-foreground/30'
                            }`}>
                              {(settings.multimodal_disabled_action || 'fixed_message') === 'fixed_message' && (
                                <div className="w-2 h-2 rounded-full bg-primary" />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">发送固定话术</p>
                              <p className="text-xs text-muted-foreground">提示用户图片识别功能未开启，建议文字描述或转人工</p>
                            </div>
                          </button>
                          {/* Editable fixed message — only visible when fixed_message is selected */}
                          {(settings.multimodal_disabled_action || 'fixed_message') === 'fixed_message' && (
                            <div className="ml-7">
                              <label className="text-xs font-medium text-foreground mb-1 block">话术内容</label>
                              <textarea
                                value={settings.multimodal_fixed_message || '抱歉，当前未开启图片识别功能，无法识别您发送的图片。如需帮助，请转接人工客服或以文字描述您的问题。'}
                                onChange={(e) => setSettings((prev) => ({ ...prev, multimodal_fixed_message: e.target.value }))}
                                rows={3}
                                className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                            </div>
                          )}
                          <button
                            onClick={() => setSettings((prev) => ({ ...prev, multimodal_disabled_action: 'handoff' }))}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors ${
                              settings.multimodal_disabled_action === 'handoff'
                                ? 'border-primary bg-primary/5'
                                : 'hover:border-primary/30 hover:bg-muted/30'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              settings.multimodal_disabled_action === 'handoff'
                                ? 'border-primary'
                                : 'border-muted-foreground/30'
                            }`}>
                              {settings.multimodal_disabled_action === 'handoff' && (
                                <div className="w-2 h-2 rounded-full bg-primary" />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">自动转人工</p>
                              <p className="text-xs text-muted-foreground">自动将对话转交人工客服，由人工处理图片问题</p>
                            </div>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Temperature */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <label className="text-xs font-medium text-foreground block">创造性（Temperature）</label>
                        <p className="text-xs text-muted-foreground mt-0.5">值越高回复越有创造性，值越低回复越精确</p>
                      </div>
                      <span className="text-sm font-semibold text-foreground w-10 text-right">
                        {parseFloat(settings.ai_temperature || '0.7').toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.ai_temperature || '0.7'}
                      onChange={(e) => setSettings((prev) => ({ ...prev, ai_temperature: e.target.value }))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                      <span>精确</span>
                      <span>均衡</span>
                      <span>创造性</span>
                    </div>
                  </div>

                  {/* Max tokens */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <label className="text-xs font-medium text-foreground mb-1 block">最大回复长度（tokens）</label>
                    <p className="text-xs text-muted-foreground mb-3">控制单次回复的最大长度</p>
                    <input
                      type="number"
                      value={settings.ai_max_tokens || '2048'}
                      onChange={(e) => setSettings((prev) => ({ ...prev, ai_max_tokens: e.target.value }))}
                      min="256"
                      max="8192"
                      className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* AI Max Concurrent Conversations */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-foreground block">AI 最大并发对话数</label>
                      <span className="text-sm font-semibold text-foreground">
                        {settings.ai_max_concurrent === '0' || !settings.ai_max_concurrent ? '不限' : settings.ai_max_concurrent}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">AI 同时处理的最大对话数量，设为 0 表示不限制</p>
                    <input
                      type="number"
                      value={settings.ai_max_concurrent || '0'}
                      onChange={(e) => setSettings((prev) => ({ ...prev, ai_max_concurrent: e.target.value }))}
                      min="0"
                      max="1000"
                      className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Knowledge Retrieval: Min Score */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-foreground block">知识库相似度阈值</label>
                      <span className="text-sm font-semibold text-foreground">
                        {(parseFloat(settings.knowledge_min_score || '0.75') * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      调低可提高召回率（但会引入噪声），调高则回答更精准（但可能无答案）
                    </p>
                    <input
                      type="range"
                      value={settings.knowledge_min_score || '0.75'}
                      onChange={(e) => setSettings((prev) => ({ ...prev, knowledge_min_score: e.target.value }))}
                      min="0.5"
                      max="0.95"
                      step="0.05"
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>50% 高召回</span>
                      <span>75% 默认</span>
                      <span>95% 高精准</span>
                    </div>
                  </div>

                  {/* Knowledge Retrieval: Search Limit */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-foreground block">知识库检索 chunk 数</label>
                      <span className="text-sm font-semibold text-foreground">
                        {settings.knowledge_search_limit || '5'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">每次对话最多召回的知识片段数</p>
                    <input
                      type="number"
                      value={settings.knowledge_search_limit || '5'}
                      onChange={(e) => setSettings((prev) => ({ ...prev, knowledge_search_limit: e.target.value }))}
                      min="1"
                      max="20"
                      className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Knowledge Retrieval: Image Search Limit */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-foreground block">知识库图片召回数</label>
                      <span className="text-sm font-semibold text-foreground">
                        {settings.knowledge_image_search_limit || '3'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      AI 回复时附带的相关图片上限（0 = 不附带图片）
                    </p>
                    <input
                      type="number"
                      value={settings.knowledge_image_search_limit || '3'}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, knowledge_image_search_limit: e.target.value }))
                      }
                      min="0"
                      max="10"
                      className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* System Prompt */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <label className="text-xs font-medium text-foreground block">系统提示词</label>
                        <p className="text-xs text-muted-foreground mt-0.5">定义 AI 客服的角色和行为准则</p>
                      </div>
                      <button
                        onClick={() => setSettings((prev) => ({ ...prev, system_prompt: DEFAULT_SYSTEM_PROMPT }))}
                        className="text-xs text-primary hover:underline"
                      >
                        恢复默认
                      </button>
                    </div>
                    <textarea
                      value={settings.system_prompt || DEFAULT_SYSTEM_PROMPT}
                      onChange={(e) => setSettings((prev) => ({ ...prev, system_prompt: e.target.value }))}
                      rows={12}
                      className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono text-xs leading-relaxed"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Alert Conditions */}
            {activeSection === 'alert' && (
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-1">异常告警条件</h2>
                <p className="text-xs text-muted-foreground mb-4">配置异常检测阈值，触发告警和自动转人工的条件</p>
                <div className="space-y-6">
                  {/* Confidence Thresholds */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <label className="text-xs font-medium text-foreground mb-1 block">低置信度告警阈值</label>
                    <p className="text-xs text-muted-foreground mb-3">AI 回复置信度低于此值时产生告警</p>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">告警阈值（Warning）</span>
                          <span className="text-xs font-medium text-foreground">{(parseFloat(settings.alert_confidence_threshold || '0.4') * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="0.9"
                          step="0.05"
                          value={settings.alert_confidence_threshold || '0.4'}
                          onChange={(e) => setSettings((prev) => ({ ...prev, alert_confidence_threshold: e.target.value }))}
                          className="w-full accent-primary"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                          <span>10%</span>
                          <span>50%</span>
                          <span>90%</span>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">严重告警阈值（Critical）</span>
                          <span className="text-xs font-medium text-foreground">{(parseFloat(settings.alert_confidence_critical_threshold || '0.2') * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.5"
                          step="0.05"
                          value={settings.alert_confidence_critical_threshold || '0.2'}
                          onChange={(e) => setSettings((prev) => ({ ...prev, alert_confidence_critical_threshold: e.target.value }))}
                          className="w-full accent-destructive"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                          <span>5%</span>
                          <span>25%</span>
                          <span>50%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* High Rounds Thresholds */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <label className="text-xs font-medium text-foreground mb-1 block">高轮次告警阈值</label>
                    <p className="text-xs text-muted-foreground mb-3">对话消息数超过阈值时产生告警</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Warning（轮次）</label>
                        <input
                          type="number"
                          value={settings.alert_high_rounds_threshold || '10'}
                          onChange={(e) => setSettings((prev) => ({ ...prev, alert_high_rounds_threshold: e.target.value }))}
                          min="3"
                          max="50"
                          className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Critical（轮次）</label>
                        <input
                          type="number"
                          value={settings.alert_high_rounds_critical_threshold || '15'}
                          onChange={(e) => setSettings((prev) => ({ ...prev, alert_high_rounds_critical_threshold: e.target.value }))}
                          min="5"
                          max="100"
                          className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Auto Handoff */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <label className="text-xs font-medium text-foreground mb-1 block">自动转人工条件</label>
                    <p className="text-xs text-muted-foreground mb-3">当置信度低于告警阈值且对话轮次超过以下值时，自动转接人工客服</p>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">最小轮次</label>
                      <input
                        type="number"
                        value={settings.alert_auto_handoff_rounds || '6'}
                        onChange={(e) => setSettings((prev) => ({ ...prev, alert_auto_handoff_rounds: e.target.value }))}
                        min="1"
                        max="30"
                        className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>

                  {/* Current Rules Summary */}
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">当前生效规则摘要</span>
                    </div>
                    <ul className="text-xs text-amber-700/80 dark:text-amber-400/80 space-y-1">
                      <li>置信度 &lt; {(parseFloat(settings.alert_confidence_threshold || '0.4') * 100).toFixed(0)}% → Warning 告警</li>
                      <li>置信度 &lt; {(parseFloat(settings.alert_confidence_critical_threshold || '0.2') * 100).toFixed(0)}% → Critical 告警</li>
                      <li>消息数 &gt; {settings.alert_high_rounds_threshold || '10'} → Warning 告警</li>
                      <li>消息数 &gt; {settings.alert_high_rounds_critical_threshold || '15'} → Critical 告警</li>
                      <li>置信度低于阈值 且 消息数 &gt; {settings.alert_auto_handoff_rounds || '6'} → 自动转人工</li>
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* Appearance */}
            {activeSection === 'appearance' && (
              <section>
                <h2 className="text-sm font-semibold text-foreground mb-1">外观设置</h2>
                <p className="text-xs text-muted-foreground mb-4">自定义界面主题和显示偏好</p>

                <div className="space-y-6">
                  {/* Theme */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <label className="text-xs font-medium text-foreground mb-3 block">主题模式</label>
                    <div className="grid grid-cols-3 gap-3">
                      {THEME_OPTIONS.map((theme) => (
                        <button
                          key={theme.value}
                          onClick={() => setSettings((prev) => ({ ...prev, theme: theme.value }))}
                          className={`flex flex-col items-center gap-2 p-4 rounded-lg border border-border text-center transition-colors ${
                            (settings.theme || 'system') === theme.value
                              ? 'border-primary bg-primary/5'
                              : 'hover:border-primary/30'
                          }`}
                        >
                          <span className="text-2xl">{theme.icon}</span>
                          <span className="text-xs font-medium text-foreground">{theme.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs font-medium text-foreground block">对话字体大小</label>
                      <span className="text-xs text-muted-foreground">{settings.font_size || '14'}px</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="18"
                      step="1"
                      value={settings.font_size || '14'}
                      onChange={(e) => setSettings((prev) => ({ ...prev, font_size: e.target.value }))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                      <span>小</span>
                      <span>标准</span>
                      <span>大</span>
                    </div>
                  </div>

                  {/* Message Bubbles */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground">显示消息时间戳</p>
                        <p className="text-xs text-muted-foreground">在消息旁显示发送时间</p>
                      </div>
                      <button
                        onClick={() => setSettings((prev) => ({ ...prev, show_timestamps: prev.show_timestamps === 'true' ? 'false' : 'true' }))}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {(settings.show_timestamps || 'true') === 'true' ? (
                          <ToggleRight className="w-6 h-6 text-primary" />
                        ) : (
                          <ToggleLeft className="w-6 h-6" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Compact mode */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground">紧凑模式</p>
                        <p className="text-xs text-muted-foreground">减少消息间距，显示更多内容</p>
                      </div>
                      <button
                        onClick={() => setSettings((prev) => ({ ...prev, compact_mode: prev.compact_mode === 'true' ? 'false' : 'true' }))}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {settings.compact_mode === 'true' ? (
                          <ToggleRight className="w-6 h-6 text-primary" />
                        ) : (
                          <ToggleLeft className="w-6 h-6" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Shop Management */}
            {activeSection === 'shop' && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">店铺管理</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">管理您的店铺和客服账号使用情况</p>
                  </div>
                  <button
                    onClick={() => setShowShopWizard(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加店铺
                  </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">店铺总数</div>
                        <div className="text-2xl font-bold text-foreground mt-1">{shopStats.total}</div>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Store className="w-5 h-5 text-primary" />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">总账号数</div>
                        <div className="text-2xl font-bold text-foreground mt-1">{shopStats.totalAccounts}</div>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <Users className="w-5 h-5 text-amber-500" />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">可用账号</div>
                        <div className="text-2xl font-bold text-foreground mt-1">{shopStats.availableAccounts}</div>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <UserCheck className="w-5 h-5 text-emerald-500" />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">已用账号</div>
                        <div className="text-2xl font-bold text-foreground mt-1">{shopStats.usedAccounts}</div>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 text-blue-500" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Shop List */}
                {shops.length > 0 ? (
                  <div className="space-y-3">
                    {shops.map((shop) => (
                      <div key={shop.id} className="rounded-xl border border-border bg-card p-4">
                        {editingShopId === shop.id && editShop ? (
                          /* Edit Mode */
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">店铺名称</label>
                                <input
                                  type="text"
                                  value={editShop.name}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, name: e.target.value } : p)}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">平台</label>
                                <div className="flex gap-2">
                                  {['qianniu', 'doudian'].map((p) => (
                                    <button
                                      key={p}
                                      onClick={() => setEditShop((prev) => prev ? { ...prev, platform: p } : prev)}
                                      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border transition-colors flex-1 ${
                                        editShop.platform === p
                                          ? 'border-primary bg-primary/10 text-primary font-medium'
                                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                      }`}
                                    >
                                      <span className="text-base">{p === 'qianniu' ? '💬' : '🛒'}</span>
                                      {p === 'qianniu' ? '千牛' : '抖店'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">店铺链接</label>
                                <input
                                  type="text"
                                  value={editShop.shop_url}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, shop_url: e.target.value } : p)}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                                  placeholder="https://..."
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">账号配额</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={editShop.total_accounts}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, total_accounts: parseInt(e.target.value) || 0 } : p)}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">联系人</label>
                                <input
                                  type="text"
                                  value={editShop.contact_name}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, contact_name: e.target.value } : p)}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                                  placeholder="联系人姓名"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">联系电话</label>
                                <input
                                  type="text"
                                  value={editShop.contact_phone}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, contact_phone: e.target.value } : p)}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                                  placeholder="联系电话"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">备注</label>
                              <textarea
                                value={editShop.remark}
                                onChange={(e) => setEditShop((p) => p ? { ...p, remark: e.target.value } : p)}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                                rows={2}
                                placeholder="备注信息"
                              />
                            </div>
                            {/* Config editing section */}
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium mb-1.5">发货地</label>
                                <input
                                  type="text"
                                  value={String((editShop.config as Record<string, unknown> | undefined)?.shipping_origin || '')}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, config: { ...p.config as Record<string, unknown>, shipping_origin: e.target.value } } : p)}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
                                  placeholder="如: 杭州"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1.5">包邮策略</label>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    { value: 'all_free', label: '全店包邮' },
                                    { value: 'threshold_free', label: '满额包邮' },
                                    { value: 'no_free', label: '不包邮' },
                                    { value: 'remote_no_free', label: '偏远不包邮' },
                                    { value: 'by_product', label: '按商品' },
                                  ].map((opt) => (
                                    <label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                      <input
                                        type="radio"
                                        name={`shipping_policy_${editingShopId}`}
                                        value={opt.value}
                                        checked={(editShop.config as Record<string, unknown> | undefined)?.shipping_policy === opt.value}
                                        onChange={() => setEditShop((p) => p ? { ...p, config: { ...p.config as Record<string, unknown>, shipping_policy: opt.value } } : p)}
                                        className="accent-primary"
                                      />
                                      {opt.label}
                                    </label>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  id={`7days_${editingShopId}`}
                                  checked={Boolean((editShop.config as Record<string, unknown> | undefined)?.return_policy_7days)}
                                  onChange={(e) => setEditShop((p) => p ? { ...p, config: { ...p.config as Record<string, unknown>, return_policy_7days: e.target.checked } } : p)}
                                  className="accent-primary"
                                />
                                <label htmlFor={`7days_${editingShopId}`} className="text-xs">7天无理由退换</label>
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => { setEditingShopId(null); setEditShop(null); }}
                                className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                              >
                                取消
                              </button>
                              <button
                                onClick={handleUpdateShop}
                                disabled={!editShop.name.trim()}
                                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Display Mode */
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-base">
                                {shop.platform === 'qianniu' ? '💬' : shop.platform === 'doudian' ? '🛒' : '🏪'}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">{shop.name}</span>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                    shop.status === 'active'
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-muted text-muted-foreground'
                                  }`}>
                                    {shop.status === 'active' ? '启用' : '禁用'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                  <span>{shop.platform === 'qianniu' ? '千牛' : shop.platform === 'doudian' ? '抖店' : shop.platform}</span>
                                  {shop.contact_name && <span>联系人: {shop.contact_name}</span>}
                                  <span>账号: {shop.used_accounts}/{shop.total_accounts}</span>
                                  {shop.created_at && <span>添加于 {new Date(shop.created_at).toLocaleDateString()}</span>}
                                  {/* Config key info badges */}
                                  {(() => {
                                        const _v = (shop.config as Record<string, unknown>)?.shipping_origin;
                                        return _v ? (
                                          <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">
                                            📍 {(shop.config as Record<string, unknown>).shipping_origin as string}
                                          </span>
                                        ) : null;
                                      })()}
                                  {(() => {
                                        const _v = (shop.config as Record<string, unknown>)?.shipping_policy as string | undefined;
                                        return _v ? (
                                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]">
                                            包邮: {(() => {
                                              const sp = ((shop.config as Record<string, unknown>)?.shipping_policy as string) || '';
                                              const map: Record<string, string> = {
                                                all_free: '全店包邮', threshold_free: '满额包邮', no_free: '不包邮',
                                                remote_no_free: '偏远不包邮', by_product: '按商品',
                                              };
                                              return map[sp] || sp;
                                            })()}
                                          </span>
                                        ) : null;
                                      })()}
                                  {(() => {
                                        const _v = (shop.config as Record<string, unknown>)?.return_policy_7days;
                                        return _v ? (
                                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                                            7天退换 ✓
                                          </span>
                                        ) : null;
                                      })()}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Account usage bar */}
                              <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden" title={`已用 ${shop.used_accounts}/${shop.total_accounts} 个账号`}>
                                <div
                                  className="h-full rounded-full bg-primary transition-all"
                                  style={{ width: shop.total_accounts > 0 ? `${Math.min((shop.used_accounts / shop.total_accounts) * 100, 100)}%` : '0%' }}
                                />
                              </div>
                              <button
                                onClick={() => handleToggleShopStatus(shop.id, shop.status)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title={shop.status === 'active' ? '禁用' : '启用'}
                              >
                                {shop.status === 'active' ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => startEditShop(shop)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title="编辑"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteShop(shop.id)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                title="删除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Empty State */
                  <div className="flex flex-col items-center justify-center py-16">
                    <div
                      className="w-48 h-40 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      onClick={() => setShowShopWizard(true)}
                    >
                      <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                        <Plus className="w-5 h-5 text-primary-foreground" />
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-foreground">添加店铺</div>
                        <div className="text-xs text-muted-foreground mt-0.5">点击创建新店铺</div>
                      </div>
                    </div>
                  </div>
                )}

                <ShopCreateWizard
                  open={showShopWizard}
                  onClose={() => setShowShopWizard(false)}
                  onSuccess={() => { loadData(); }}
                />
              </section>
            )}

            {/* Agent Assignment */}
            {activeSection === 'agent-assignment' && (
              <AgentAssignmentSettings />
            )}

            {/* Push Templates & Events */}
            {activeSection === 'push' && (
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
                          value={webhookSecret || '••••••••••••••••'}
                          readOnly
                          className="flex-1 bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground font-mono"
                        />
                        <button
                          onClick={() => setShowSecret(!showSecret)}
                          className="p-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title={showSecret ? '隐藏' : '显示'}
                        >
                          {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => webhookSecret && copyToClipboard(webhookSecret, 'secret')}
                          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted text-sm text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                        >
                          {copiedSecret ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedSecret ? '已复制' : '复制'}
                        </button>
                      </div>
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
              </section>
            )}

            {activeSection === 'gorgias' && (
              <GorgiasSettings />
            )}

            {activeSection === 'bot' && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-medium text-foreground">Bot与子Agent管理</h2>
                  <button
                    onClick={() => { setEditingBot(null); setBotForm({ name: '', description: '', system_prompt: '' }); setShowBotModal(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新建主Bot
                  </button>
                </div>

                <p className="text-xs text-muted-foreground mb-4">
                  创建主Bot作为协调者，在其下添加专项子Agent（如订单处理、退款处理），主Bot会根据意图自动委派任务给子Agent。
                </p>

                {/* Bot Tree */}
                {mainBots.length === 0 ? (
                  <div className="text-center py-12">
                    <Network className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">暂无Bot配置</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">创建一个主Bot开始配置子Agent</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mainBots.map((bot) => (
                      <div key={bot.id} className="rounded-xl border border-border bg-card overflow-hidden">
                        {/* Main Bot Header */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleToggleBotExpand(bot.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleBotExpand(bot.id); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                        >
                          {expandedBotId === bot.id ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{bot.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">主Bot</span>
                              {bot.sub_agent_count != null && bot.sub_agent_count > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{bot.sub_agent_count} 个子Agent</span>
                              )}
                            </div>
                            {bot.description && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{bot.description}</p>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteBot(bot.id); }}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Sub-Agents */}
                        {expandedBotId === bot.id && (
                          <div className="border-t border-border">
                            {subAgents[bot.id] && subAgents[bot.id].length > 0 ? (
                              <div className="divide-y divide-border">
                                {subAgents[bot.id].map((agent) => (
                                  <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5 pl-12">
                                    <div className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                                      <Network className="w-3 h-3 text-emerald-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-foreground">{agent.name}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${agent.status === 'active' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                                          {agent.status === 'active' ? '启用' : '停用'}
                                        </span>
                                      </div>
                                      <p className="text-xs text-muted-foreground truncate">{agent.description || '无描述'}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => handleToggleSubAgentStatus(agent, bot.id)}
                                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                        title={agent.status === 'active' ? '停用' : '启用'}
                                      >
                                        {agent.status === 'active' ? <ToggleRight className="w-4 h-4 text-success" /> : <ToggleLeft className="w-4 h-4" />}
                                      </button>
                                      <button
                                        onClick={() => openEditSubAgent(bot.id, agent)}
                                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteSubAgent(agent.id, bot.id)}
                                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="px-4 py-6 text-center">
                                <p className="text-xs text-muted-foreground">暂无子Agent</p>
                              </div>
                            )}
                            <div className="px-4 py-2.5 border-t border-border bg-muted/30">
                              <button
                                onClick={() => openCreateSubAgent(bot.id)}
                                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                              >
                                <Plus className="w-3 h-3" />
                                添加子Agent
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Bot Create Modal */}
            {showBotModal && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-card rounded-lg shadow-float w-[520px] max-h-[80vh] overflow-y-auto popup-enter">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <h3 className="text-sm font-medium text-foreground">新建主Bot</h3>
                    <button onClick={() => setShowBotModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Bot名称</label>
                      <input type="text" value={botForm.name} onChange={(e) => setBotForm({ ...botForm, name: e.target.value })} placeholder="如：电商主客服" className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">描述</label>
                      <input type="text" value={botForm.description} onChange={(e) => setBotForm({ ...botForm, description: e.target.value })} placeholder="如：处理所有电商客服场景" className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">系统提示词</label>
                      <textarea value={botForm.system_prompt} onChange={(e) => setBotForm({ ...botForm, system_prompt: e.target.value })} placeholder="定义Bot的角色和行为..." rows={4} className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
                    <button onClick={() => setShowBotModal(false)} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">取消</button>
                    <button onClick={handleCreateBot} disabled={!botForm.name.trim()} className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">创建</button>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Agent Create/Edit Modal */}
            {showSubAgentModal && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-card rounded-lg shadow-float w-[520px] max-h-[85vh] overflow-hidden flex flex-col popup-enter">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h3 className="text-sm font-medium text-foreground">
                        {editingSubAgent.agent ? '编辑子Agent' : '新建子Agent'}
                      </h3>
                    </div>
                    <button onClick={() => setShowSubAgentModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto flex-1 space-y-5">
                    {/* Basic Info Section */}
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">1</span>
                        基础信息
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                          子Agent名称 <span className="text-destructive">*</span>
                        </label>
                        <input type="text" value={subAgentForm.name} onChange={(e) => setSubAgentForm({ ...subAgentForm, name: e.target.value })} placeholder="如：订单处理专家" className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1.5 block">描述</label>
                        <input type="text" value={subAgentForm.description} onChange={(e) => setSubAgentForm({ ...subAgentForm, description: e.target.value })} placeholder="如：专注订单查询、修改地址、取消订单" className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors" />
                      </div>
                    </div>

                    {/* Config Section */}
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">2</span>
                        配置信息
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1.5 block">系统提示词</label>
                        <textarea value={subAgentForm.system_prompt} onChange={(e) => setSubAgentForm({ ...subAgentForm, system_prompt: e.target.value })} placeholder="定义子Agent的角色和专业领域..." rows={3} className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-colors" />
                      </div>
                    </div>

                    {/* Tools Section */}
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">3</span>
                        可用工具
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {AVAILABLE_TOOLS.map((tool) => (
                          <button
                            key={tool.value}
                            type="button"
                            onClick={() => {
                              if (subAgentForm.tools.includes(tool.value)) {
                                setSubAgentForm({ ...subAgentForm, tools: subAgentForm.tools.filter((t) => t !== tool.value) });
                              } else {
                                setSubAgentForm({ ...subAgentForm, tools: [...subAgentForm.tools, tool.value] });
                              }
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-left transition-all ${
                              subAgentForm.tools.includes(tool.value)
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'bg-muted/50 hover:bg-muted text-foreground'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border border-border flex items-center justify-center shrink-0 ${
                              subAgentForm.tools.includes(tool.value) ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                            }`}>
                              {subAgentForm.tools.includes(tool.value) && (
                                <Check className="w-2.5 h-2.5 text-primary-foreground" />
                              )}
                            </div>
                            <span className="text-sm">{tool.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Advanced Config Section */}
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">4</span>
                        高级配置
                        <span className="text-[10px] text-muted-foreground/50 font-normal normal-case ml-1">(可选)</span>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1.5 block">委派提示词</label>
                        <textarea value={subAgentForm.delegation_prompt} onChange={(e) => setSubAgentForm({ ...subAgentForm, delegation_prompt: e.target.value })} placeholder="描述什么情况下应该委派给此Agent..." rows={2} className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-colors" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-muted-foreground">协作配置</label>
                          <button
                            type="button"
                            onClick={() => setSubAgentForm({ ...subAgentForm, collaboration_config: '{"auto_delegate_intents":["order_query"],"allow_collaborate_with":[]}' })}
                            className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                          >
                            恢复默认
                          </button>
                        </div>
                        <textarea value={subAgentForm.collaboration_config} onChange={(e) => setSubAgentForm({ ...subAgentForm, collaboration_config: e.target.value })} placeholder='{"auto_delegate_intents":[],"allow_collaborate_with":[]}' rows={2} className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono transition-colors" />
                        <div className="text-[10px] text-muted-foreground/50 mt-1.5 space-y-0.5">
                          <p>• auto_delegate_intents: 自动识别并委派的意图关键词</p>
                          <p>• allow_collaborate_with: 允许协作的子Agent标识列表</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0 bg-muted/30">
                    <button onClick={() => setShowSubAgentModal(false)} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">取消</button>
                    <button onClick={editingSubAgent.agent ? handleUpdateSubAgent : handleCreateSubAgent} disabled={!subAgentForm.name.trim()} className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                      {editingSubAgent.agent ? '保存' : '创建'}
                    </button>
                  </div>
                </div>
              </div>
            )}

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

            {/* Sensitive Word Manager Modal */}
            <SensitiveWordManager
              open={showSensitiveWordManager}
              onClose={() => setShowSensitiveWordManager(false)}
              onCountChange={setSensitiveWordCount}
            />

            {/* Domain Whitelist Manager Modal */}
            <DomainWhitelistManager
              open={showDomainManager}
              onClose={() => setShowDomainManager(false)}
              onCountChange={setDomainCount}
            />
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
