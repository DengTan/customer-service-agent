'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, Edit3, Save, X, Check, ExternalLink,
  Bot, Globe, Key, TestTube, Star, ChevronDown, ChevronUp,
  Eye, EyeOff, Zap, Shield, Activity,
} from 'lucide-react';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface LlmProvider {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  api_type: string;
  base_url: string;
  api_key?: string | null;
  models: string[];
  default_model?: string | null;
  supports_vision: boolean;
  supports_streaming: boolean;
  max_context_tokens?: number | null;
  is_enabled: boolean;
  is_default: boolean;
  priority: number;
}

interface LlmModel {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  description?: string | null;
  type: string;
  max_tokens?: number | null;
  supports_vision: boolean;
  supports_function_calling: boolean;
  default_temperature: number;
  use_case: string;
  is_enabled: boolean;
}

interface Props {
  currentProviderId?: string;
  onProviderChange?: (providerId: string) => void;
}

const API_TYPES = [
  { value: 'openai_compatible', label: 'OpenAI 兼容', icon: <Globe className="w-4 h-4" /> },
  { value: 'coze', label: 'Coze (豆包)', icon: <Bot className="w-4 h-4" /> },
  { value: 'anthropic', label: 'Anthropic (Claude)', icon: <Zap className="w-4 h-4" /> },
  { value: 'custom', label: '自定义', icon: <Shield className="w-4 h-4" /> },
];

export function LlmProviderManager({ currentProviderId, onProviderChange }: Props) {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [models, setModels] = useState<Record<string, LlmModel[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Get active provider (from props or default)
  const activeProvider = providers.find(p => p.id === currentProviderId) 
    || providers.find(p => p.is_default)
    || providers[0];
  const activeProviderId = activeProvider?.id;

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    api_type: 'openai_compatible',
    base_url: '',
    api_key: '',
    models: '',
    default_model: '',
    supports_vision: false,
    supports_streaming: true,
    max_context_tokens: '',
    is_enabled: true,
    priority: '0',
  });
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/llm-providers');
      const data = await res.json();
      setProviders(data.providers || []);
      
      // Load models for each provider
      const modelsMap: Record<string, LlmModel[]> = {};
      for (const provider of data.providers || []) {
        const modelsRes = await fetch(`/api/llm-providers?provider_id=${provider.id}`);
        const modelsData = await modelsRes.json();
        modelsMap[provider.id] = modelsData.models || [];
      }
      setModels(modelsMap);
    } catch (error) {
      logger.error('Failed to load providers', { error });
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setFormData({
      name: '',
      display_name: '',
      description: '',
      api_type: 'openai_compatible',
      base_url: '',
      api_key: '',
      models: '',
      default_model: '',
      supports_vision: false,
      supports_streaming: true,
      max_context_tokens: '',
      is_enabled: true,
      priority: '0',
    });
    setShowAddModal(true);
  };

  const handleEdit = (provider: LlmProvider) => {
    setFormData({
      name: provider.name,
      display_name: provider.display_name,
      description: provider.description || '',
      api_type: provider.api_type,
      base_url: provider.base_url,
      api_key: '', // Don't show existing API key
      models: provider.models.join(', '),
      default_model: provider.default_model || '',
      supports_vision: provider.supports_vision,
      supports_streaming: provider.supports_streaming,
      max_context_tokens: provider.max_context_tokens?.toString() || '',
      is_enabled: provider.is_enabled,
      priority: provider.priority.toString(),
    });
    setEditingProvider(provider);
    setShowAddModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Build payload - only include API key if it's a new value (not masked)
    const payload: Record<string, unknown> = {
      name: formData.name.toLowerCase().replace(/\s+/g, '-'),
      display_name: formData.display_name,
      description: formData.description || undefined,
      api_type: formData.api_type,
      base_url: formData.base_url,
      models: formData.models.split(',').map(m => m.trim()).filter(Boolean),
      default_model: formData.default_model || undefined,
      supports_vision: formData.supports_vision,
      supports_streaming: formData.supports_streaming,
      max_context_tokens: formData.max_context_tokens ? parseInt(formData.max_context_tokens) : undefined,
      is_enabled: formData.is_enabled,
      priority: parseInt(formData.priority) || 0,
    };

    // Only include API key if it's not empty and not a masked value
    if (formData.api_key && !formData.api_key.includes('***')) {
      payload.api_key = formData.api_key;
    }
    // If editing and API key is empty, don't update the existing key

    try {
      const url = editingProvider 
        ? `/api/llm-providers/${editingProvider.id}` 
        : '/api/llm-providers';
      const method = editingProvider ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || '保存失败');
      }

      toast.success(editingProvider ? '更新成功' : '添加成功');
      setShowAddModal(false);
      setEditingProvider(null);
      loadProviders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: '删除提供商',
      description: '确定要删除这个提供商吗？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/llm-providers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || '删除失败');
      }
      toast.success('删除成功');
      loadProviders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/llm-providers/${id}/set-default`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || '设置失败');
      }
      toast.success('已设为默认');
      loadProviders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '设置失败');
    }
  };

  const handleSelectActive = async (provider: LlmProvider) => {
    if (onProviderChange) {
      onProviderChange(provider.id);
      toast.success(`已选择 ${provider.display_name}`);
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/llm-providers/${id}/test`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('连接成功');
      } else {
        toast.error(`连接失败: ${data.message}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '测试失败');
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (provider: LlmProvider) => {
    try {
      const res = await fetch(`/api/llm-providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !provider.is_enabled }),
      });
      if (!res.ok) throw new Error('更新失败');
      loadProviders();
    } catch (error) {
      toast.error('更新失败');
    }
  };

  const getApiTypeIcon = (type: string) => {
    return API_TYPES.find(t => t.value === type)?.icon || <Globe className="w-4 h-4" />;
  };

  const getApiTypeLabel = (type: string) => {
    return API_TYPES.find(t => t.value === type)?.label || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">模型提供商</h3>
          <p className="text-xs text-muted-foreground">管理额外的大模型 API 提供商</p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加提供商
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">暂无模型提供商</p>
          <p className="text-xs mt-1">点击上方按钮添加</p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`rounded-lg border transition-colors ${
                provider.is_default 
                  ? 'border-primary bg-primary/5' 
                  : 'border-border bg-card hover:border-primary/30'
              }`}
            >
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      provider.is_default ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {getApiTypeIcon(provider.api_type)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-foreground">{provider.display_name}</h4>
                        {provider.is_default && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
                            <Star className="w-2.5 h-2.5" />
                            默认
                          </span>
                        )}
                        <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded ${
                          provider.is_enabled 
                            ? 'bg-emerald-200 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' 
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {provider.is_enabled ? '启用' : '禁用'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {provider.description || `${getApiTypeLabel(provider.api_type)} · ${provider.base_url}`}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Activity className="w-3 h-3" />
                          {provider.models.length} 个模型
                        </span>
                        {provider.max_context_tokens && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Zap className="w-3 h-3" />
                            {provider.max_context_tokens.toLocaleString()} tokens
                          </span>
                        )}
                        {provider.supports_vision && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Eye className="w-3 h-3" />
                            多模态
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTestConnection(provider.id)}
                      disabled={testingId === provider.id}
                      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
                      title="测试连接"
                    >
                      <TestTube className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleSelectActive(provider)}
                      className={`p-1.5 rounded transition-colors ${
                        activeProviderId === provider.id
                          ? 'text-primary hover:bg-primary/10'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                      title={activeProviderId === provider.id ? '当前使用中' : '使用此提供商'}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedProvider(expandedProvider === provider.id ? null : provider.id)}
                      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    >
                      {expandedProvider === provider.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {!provider.is_default && (
                      <button
                        onClick={() => handleSetDefault(provider.id)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                        title="设为默认"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleToggleEnabled(provider)}
                      className={`p-1.5 rounded transition-colors ${
                        provider.is_enabled 
                          ? 'text-muted-foreground hover:text-foreground hover:bg-muted' 
                          : 'text-amber-600 hover:bg-amber-500/10'
                      }`}
                      title={provider.is_enabled ? '禁用' : '启用'}
                    >
                      {provider.is_enabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleEdit(provider)}
                      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(provider.id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {expandedProvider === provider.id && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-muted-foreground">API 类型：</span>
                        <span className="text-foreground">{getApiTypeLabel(provider.api_type)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Base URL：</span>
                        <a 
                          href={provider.base_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          {provider.base_url.replace(/^https?:\/\//, '').slice(0, 40)}...
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div>
                        <span className="text-muted-foreground">支持流式：</span>
                        <span className={provider.supports_streaming ? 'text-emerald-700' : 'text-muted-foreground'}>
                          {provider.supports_streaming ? '是' : '否'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">优先级：</span>
                        <span className="text-foreground">{provider.priority}</span>
                      </div>
                    </div>
                    {provider.models.length > 0 && (
                      <div className="mt-3">
                        <span className="text-xs text-muted-foreground">可用模型：</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {provider.models.map((model) => (
                            <span
                              key={model}
                              className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded ${
                                model === provider.default_model
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {model}
                              {model === provider.default_model && ' (默认)'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {models[provider.id]?.length > 0 && (
                      <div className="mt-3">
                        <span className="text-xs text-muted-foreground">详细模型配置：</span>
                        <div className="mt-1 space-y-1">
                          {models[provider.id].map((model) => (
                            <div key={model.id} className="flex items-center justify-between px-2 py-1 bg-muted/50 rounded text-[10px]">
                              <span className="text-foreground">{model.display_name}</span>
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <span>{model.type}</span>
                                <span>{model.default_temperature}</span>
                                {model.supports_vision && <span>视觉</span>}
                                {model.supports_function_calling && <span>函数调用</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg bg-card rounded-xl shadow-lg">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                {editingProvider ? '编辑提供商' : '添加提供商'}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    标识名称 <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="如 openai, deepseek"
                    className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    pattern="[a-z0-9_-]+"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">小写字母、数字、连字符、下划线</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    显示名称 <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.display_name}
                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                    placeholder="如 OpenAI GPT-4"
                    className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">描述</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="简要描述这个提供商"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  API 类型 <span className="text-destructive">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {API_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, api_type: type.value })}
                      className={`flex items-center gap-2 p-2 text-xs rounded-lg border transition-colors ${
                        formData.api_type === type.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      {type.icon}
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Base URL <span className="text-destructive">*</span>
                </label>
                <input
                  type="url"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.api_key}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder={editingProvider ? '（不修改请留空）' : 'sk-...'}
                    className="w-full px-3 py-2 pr-10 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">可用模型</label>
                <input
                  type="text"
                  value={formData.models}
                  onChange={(e) => setFormData({ ...formData, models: e.target.value })}
                  placeholder="gpt-4o, gpt-4o-mini (逗号分隔)"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">多个模型用逗号分隔</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">默认模型</label>
                <input
                  type="text"
                  value={formData.default_model}
                  onChange={(e) => setFormData({ ...formData, default_model: e.target.value })}
                  placeholder="gpt-4o"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">最大上下文</label>
                  <input
                    type="number"
                    value={formData.max_context_tokens}
                    onChange={(e) => setFormData({ ...formData, max_context_tokens: e.target.value })}
                    placeholder="128000"
                    className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">优先级</label>
                  <input
                    type="number"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.supports_vision}
                    onChange={(e) => setFormData({ ...formData, supports_vision: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-foreground">支持多模态</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.supports_streaming}
                    onChange={(e) => setFormData({ ...formData, supports_streaming: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-foreground">支持流式输出</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_enabled}
                    onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-foreground">启用</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {editingProvider ? '保存修改' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
