'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  Plus, Trash2, Edit3, Save, X, Check, ExternalLink,
  Bot, Globe, Key, TestTube, Star, ChevronDown, ChevronUp,
  Eye, EyeOff, Activity, ChevronRight, MoreVertical,
  Power, PowerOff,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface LlmProvider {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  base_url: string;
  api_key?: string | null;
  models: string[];
  default_model?: string | null;
  supports_vision: boolean;
  supports_streaming: boolean;
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
  priority?: number | null;
  supports_vision: boolean;
  supports_streaming: boolean;
  supports_function_calling: boolean;
  is_enabled: boolean;
}

interface ModelFormData {
  model_id: string;
  display_name: string;
  description: string;
  priority: string;
  supports_vision: boolean;
  supports_streaming: boolean;
  supports_function_calling: boolean;
  is_enabled: boolean;
}

interface Props {
  currentProviderId?: string;
  onProviderChange?: (providerId: string) => void;
  onModelsChange?: (providerId: string) => void;
  /** Called after a model is saved (created/updated) so parent can refresh model lists */
  onModelSaved?: (providerId: string) => void;
  onProviderListChange?: (providers: LlmProvider[]) => void;
}

export function LlmProviderManager({ currentProviderId, onProviderChange, onModelsChange, onModelSaved, onProviderListChange }: Props) {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [models, setModels] = useState<Record<string, LlmModel[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  // Model management state
  const [showModelModal, setShowModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<LlmModel | null>(null);
  const [modelProviderId, setModelProviderId] = useState<string>('');
  const [modelFormData, setModelFormData] = useState<ModelFormData>({
    model_id: '',
    display_name: '',
    description: '',
    priority: '0',
    supports_vision: false,
    supports_streaming: false,
    supports_function_calling: false,
    is_enabled: true,
  });

  // Pending models (for new provider creation)
  const [pendingModels, setPendingModels] = useState<(ModelFormData & { tempId: string })[]>([]);

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
    base_url: '',
    api_key: '',
    has_existing_api_key: false, // Track if provider already has an API key
    models: '',
    default_model: '',
    supports_vision: false,
    supports_streaming: false,
    is_enabled: true,
    priority: '0',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  // Track if we're in edit mode to switch model selection logic
  const isEditingMode = !!editingProvider;

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/llm-providers');
      const data = await res.json();
      const providerList = data.providers || [];
      setProviders(providerList);
      onProviderListChange?.(providerList);
      
      // Load models for each provider
      const modelsMap: Record<string, LlmModel[]> = {};
      for (const provider of providerList) {
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
      base_url: '',
      api_key: '',
      has_existing_api_key: false,
      models: '',
      default_model: '',
      supports_vision: false,
      supports_streaming: false,
      is_enabled: true,
      priority: '0',
    });
    setPendingModels([]); // Reset pending models when starting new provider
    setShowAddModal(true);
  };

  const handleEdit = (provider: LlmProvider) => {
    setFormData({
      name: provider.name,
      display_name: provider.display_name,
      description: provider.description || '',
      base_url: provider.base_url,
      api_key: '', // Don't show existing API key
      has_existing_api_key: !!provider.api_key, // Track if provider has existing key
      models: provider.models.join(', '),
      default_model: provider.default_model || '',
      supports_vision: provider.supports_vision,
      supports_streaming: provider.supports_streaming,
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
      base_url: formData.base_url,
      models: formData.models.split(',').map(m => m.trim()).filter(Boolean),
      default_model: formData.default_model || undefined,
      supports_vision: formData.supports_vision,
      supports_streaming: formData.supports_streaming,
      is_enabled: formData.is_enabled,
      priority: parseInt(formData.priority) || 0,
    };

    // Only include API key in payload if user entered a new one
    // Don't send api_key if editing with existing key and user left it empty
    if (formData.api_key && !formData.api_key.includes('***')) {
      // User entered a new API key
      payload.api_key = formData.api_key;
    }
    // If editing with existing key and user left api_key empty, don't include it in payload
    // This preserves the existing key on the backend

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

      const result = await res.json();

      // If creating new provider, also create pending models
      if (!editingProvider && pendingModels.length > 0) {
        const providerId = result.provider?.id;
        if (providerId) {
          for (const model of pendingModels) {
            try {
              await fetch(`/api/llm-providers/${providerId}/models`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model_id: model.model_id,
                  display_name: model.display_name,
                  description: model.description || undefined,
                  priority: parseInt(model.priority) || 0,
                  supports_vision: model.supports_vision,
                  supports_streaming: model.supports_streaming,
                  supports_function_calling: model.supports_function_calling,
                  is_enabled: model.is_enabled,
                }),
              });
            } catch (modelError) {
              logger.error('Failed to create pending model', { modelError });
            }
          }
        }
      }

      toast.success(editingProvider ? '更新成功' : '添加成功');
      setShowAddModal(false);
      setEditingProvider(null);
      setPendingModels([]);
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

  // Model management functions
  const handleAddModel = (providerId: string) => {
    setModelProviderId(providerId);
    setEditingModel(null);
    setModelFormData({
      model_id: '',
      display_name: '',
      description: '',
      priority: '0',
      supports_vision: false,
      supports_streaming: false,
      supports_function_calling: false,
      is_enabled: true,
    });
    setShowModelModal(true);
  };

  // Add model to pending list (for new provider creation)
  const handleAddPendingModel = () => {
    setModelProviderId('pending'); // Special ID for pending models
    setEditingModel(null);
    setModelFormData({
      model_id: '',
      display_name: '',
      description: '',
      priority: '0',
      supports_vision: false,
      supports_streaming: false,
      supports_function_calling: false,
      is_enabled: true,
    });
    setShowModelModal(true);
  };

  // Edit pending model (for new provider creation)
  const handleEditPendingModel = (index: number) => {
    const model = pendingModels[index];
    setModelProviderId('pending');
    setEditingModel({ ...model, id: model.tempId } as unknown as LlmModel);
    setModelFormData({
      model_id: model.model_id,
      display_name: model.display_name,
      description: model.description,
      priority: model.priority,
      supports_vision: model.supports_vision,
      supports_streaming: model.supports_streaming,
      supports_function_calling: model.supports_function_calling,
      is_enabled: model.is_enabled,
    });
    setShowModelModal(true);
  };

  // Delete pending model (for new provider creation)
  const handleDeletePendingModel = (index: number) => {
    setPendingModels(prev => prev.filter((_, i) => i !== index));
  };

  const handleEditModel = (model: LlmModel) => {
    setModelProviderId(model.provider_id);
    setEditingModel(model);
    setModelFormData({
      model_id: model.model_id,
      display_name: model.display_name,
      description: model.description || '',
      priority: model.priority?.toString() || '0',
      supports_vision: model.supports_vision,
      supports_streaming: model.supports_streaming,
      supports_function_calling: model.supports_function_calling,
      is_enabled: model.is_enabled,
    });
    setShowModelModal(true);
  };

  const handleModelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // If creating a new provider (pending mode), save to local state
    if (modelProviderId === 'pending') {
      const newModel: ModelFormData & { tempId: string } = {
        ...modelFormData,
        tempId: editingModel?.id || `temp-${Date.now()}`,
      };
      
      if (editingModel) {
        // Update existing pending model
        setPendingModels(prev => prev.map(m => 
          m.tempId === editingModel.id ? newModel : m
        ));
      } else {
        // Add new pending model
        setPendingModels(prev => [...prev, newModel]);
      }
      
      toast.success(editingModel ? '模型已更新' : '模型已添加');
      setShowModelModal(false);
      setEditingModel(null);
      return;
    }
    
    const payload = {
      model_id: modelFormData.model_id,
      display_name: modelFormData.display_name,
      description: modelFormData.description || undefined,
      priority: parseInt(modelFormData.priority) || 0,
      supports_vision: modelFormData.supports_vision,
      supports_streaming: modelFormData.supports_streaming,
      supports_function_calling: modelFormData.supports_function_calling,
      is_enabled: modelFormData.is_enabled,
    };

    try {
      const url = editingModel
        ? `/api/llm-providers/models/${editingModel.id}`
        : `/api/llm-providers/${modelProviderId}/models`;
      const method = editingModel ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || '保存失败');
      }

      toast.success(editingModel ? '模型已更新' : '模型已添加');
      setShowModelModal(false);
      setEditingModel(null);
      loadProviders();
      // Notify parent to refresh model lists (e.g., AI settings page)
      onModelSaved?.(modelProviderId);
      onModelsChange?.(modelProviderId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  };

  const handleDeleteModel = async (providerId: string, modelId: string) => {
    const confirmed = await confirm({
      title: '删除模型',
      description: '确定要删除这个模型吗？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/llm-providers/models/${modelId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || '删除失败');
      }
      toast.success('删除成功');
      loadProviders();
      // Notify parent to refresh model lists
      onModelSaved?.(providerId);
      onModelsChange?.(providerId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const getIconForProvider = (provider: LlmProvider) => {
    return <Globe className="w-4 h-4" />;
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
                      {getIconForProvider(provider)}
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
                        {provider.description || provider.base_url}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Activity className="w-3 h-3" />
                          {(models[provider.id]?.length ?? provider.models.length)} 个模型
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectActive(provider)}
                      className={`text-xs transition-colors ${
                        activeProviderId === provider.id 
                          ? 'text-primary font-medium' 
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {activeProviderId === provider.id ? '当前使用' : '设为当前'}
                    </button>
                    <button
                      onClick={() => setExpandedProvider(expandedProvider === provider.id ? null : provider.id)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {expandedProvider === provider.id ? '收起详情' : '查看详情'}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          更多
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleTestConnection(provider.id)}>
                          <TestTube className="w-4 h-4 mr-2" />
                          测试连接
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleEdit(provider)}>
                          <Edit3 className="w-4 h-4 mr-2" />
                          编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleEnabled(provider)}>
                          {provider.is_enabled ? (
                            <>
                              <PowerOff className="w-4 h-4 mr-2 text-destructive" />
                              <span className="text-destructive">禁用</span>
                            </>
                          ) : (
                            <>
                              <Power className="w-4 h-4 mr-2 text-emerald-600" />
                              启用
                            </>
                          )}
                        </DropdownMenuItem>
                        {!provider.is_default && (
                          <DropdownMenuItem onClick={() => handleSetDefault(provider.id)}>
                            <Star className="w-4 h-4 mr-2" />
                            设为默认
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          onClick={() => handleDelete(provider.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {expandedProvider === provider.id && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="grid grid-cols-2 gap-4 text-xs">
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
                    {models[provider.id]?.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">模型配置：</span>
                          <button
                            onClick={() => handleAddModel(provider.id)}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 rounded transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            添加模型
                          </button>
                        </div>
                        <div className="mt-1 space-y-1">
                          {models[provider.id].map((model) => (
                            <div key={model.id} className="flex items-center justify-between px-2 py-1.5 bg-muted/50 rounded text-[10px] group">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-foreground font-medium truncate">{model.display_name}</span>
                                  {model.model_id === provider.default_model && (
                                    <span className="px-1 py-0.5 text-[9px] bg-primary/10 text-primary rounded">默认</span>
                                  )}
                                  {!model.is_enabled && (
                                    <span className="px-1 py-0.5 text-[9px] bg-muted text-muted-foreground rounded">已禁用</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleEditModel(model)}
                                  className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                                  title="编辑"
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteModel(provider.id, model.id)}
                                  className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                                  title="删除"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
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

      {/* Add/Edit Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg bg-card rounded-xl shadow-lg">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                {editingProvider ? '编辑提供商' : '添加提供商'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingProvider(null);
                  setPendingModels([]);
                }}
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
                    pattern="[a-z0-9_\-]+"
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
                <label className="block text-xs font-medium text-foreground mb-1">
                  API Key <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.has_existing_api_key && !formData.api_key ? '••••••••' : formData.api_key}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder={editingProvider ? '（不修改请留空）' : 'sk-...'}
                    className="w-full px-3 py-2 pr-10 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    readOnly={formData.has_existing_api_key && !formData.api_key}
                    onFocus={(e) => {
                      if (formData.has_existing_api_key && !formData.api_key) {
                        e.target.removeAttribute('readonly');
                        e.target.select();
                      }
                    }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {formData.has_existing_api_key && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    已保存密钥。如需修改，请输入新密钥；留空则保留原密钥。
                  </p>
                )}
              </div>

              {/* 详细模型配置区域 */}
              <div className="border border-border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-medium text-foreground">
                    详细模型配置
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (editingProvider) {
                        // Editing existing provider
                        setModelProviderId(editingProvider.id);
                      } else {
                        // Creating new provider - use pending mode
                        setModelProviderId('pending');
                      }
                      setEditingModel(null);
                      setModelFormData({
                        model_id: '',
                        display_name: '',
                        description: '',
                        priority: '0',
                        supports_vision: false,
                        supports_streaming: false,
                        supports_function_calling: false,
                        is_enabled: true,
                      });
                      setShowModelModal(true);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    添加模型
                  </button>
                </div>
                
                {/* 已配置的模型列表 - 编辑模式显示已保存的模型 */}
                {editingProvider && models[editingProvider.id]?.length > 0 ? (
                  <div className="space-y-2">
                    {models[editingProvider.id].map((model) => (
                      <div key={model.id} className="flex items-center justify-between px-3 py-2 bg-card rounded text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{model.display_name}</span>
                            {model.model_id === editingProvider.default_model && (
                              <span className="px-1 py-0.5 text-[9px] bg-primary/10 text-primary rounded">默认</span>
                            )}
                            {!model.is_enabled && (
                              <span className="px-1 py-0.5 text-[9px] bg-muted text-muted-foreground rounded">已禁用</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingModel(model);
                              setModelFormData({
                                model_id: model.model_id,
                                display_name: model.display_name,
                                description: model.description || '',
                                priority: model.priority?.toString() || '0',
                                supports_vision: model.supports_vision,
                                supports_streaming: model.supports_streaming,
                                supports_function_calling: model.supports_function_calling,
                                is_enabled: model.is_enabled,
                              });
                              setShowModelModal(true);
                            }}
                            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteModel(editingProvider.id, model.id)}
                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : pendingModels.length > 0 ? (
                  // Show pending models for new provider creation
                  <div className="space-y-2">
                    {pendingModels.map((model, index) => (
                      <div key={model.tempId} className="flex items-center justify-between px-3 py-2 bg-card rounded text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{model.display_name || model.model_id}</span>
                            <span className="px-1 py-0.5 text-[9px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">待保存</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditPendingModel(index)}
                            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePendingModel(index)}
                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground text-center py-4">
                    暂无详细模型配置，点击「添加模型」配置详细参数
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  默认模型 <span className="text-destructive">*</span>
                </label>
                <Select
                  value={formData.default_model}
                  onValueChange={(value) => setFormData({ ...formData, default_model: value })}
                >
                  <SelectTrigger className="w-full h-10 bg-muted border-none rounded-lg focus:ring-2 focus:ring-primary/30 data-[placeholder]:text-muted-foreground">
                    <SelectValue placeholder="请选择默认模型" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 z-[60]" side="bottom" sideOffset={4}>
                    {/* 编辑模式：显示已保存的模型 */}
                    {isEditingMode && models[editingProvider.id]?.length > 0 ? (
                      models[editingProvider.id].map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.model_id}
                          disabled={!model.is_enabled}
                          className="flex flex-col items-start gap-0.5 py-2.5"
                        >
                          <span className="font-medium text-sm">{model.display_name}</span>
                          <span className="text-xs text-muted-foreground font-normal">
                            {model.model_id}{!model.is_enabled && ' [已禁用]'}
                          </span>
                        </SelectItem>
                      ))
                    ) : pendingModels.length > 0 ? (
                      // 新建模式：显示 pending 模型
                      pendingModels.map((model) => (
                        <SelectItem
                          key={model.tempId}
                          value={model.model_id}
                          disabled={!model.is_enabled}
                          className="flex flex-col items-start gap-0.5 py-2.5"
                        >
                          <span className="font-medium text-sm">{model.display_name || model.model_id}</span>
                          <span className="text-xs text-muted-foreground font-normal">
                            {model.model_id}{!model.is_enabled && ' [已禁用]'}
                          </span>
                        </SelectItem>
                      ))
                    ) : (
                      // Fallback: 显示简单的模型列表
                      formData.models.split(',').map(m => m.trim()).filter(Boolean).map((model) => (
                        <SelectItem key={model} value={model} className="py-2">
                          {model}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, is_enabled: !formData.is_enabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    formData.is_enabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    formData.is_enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`} />
                </button>
                <span className="text-xs text-foreground">启用</span>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingProvider(null);
                    setPendingModels([]);
                  }}
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

      {/* Add/Edit Model Modal */}
      {showModelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md bg-card rounded-xl shadow-lg">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                {editingModel ? '编辑模型' : '添加模型'}
              </h3>
              <button
                onClick={() => {
                  setShowModelModal(false);
                  setEditingModel(null);
                }}
                className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleModelSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  模型标识 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={modelFormData.model_id}
                  onChange={(e) => setModelFormData({ ...modelFormData, model_id: e.target.value })}
                  placeholder="如 gpt-4o, claude-3-5-sonnet"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">API 中使用的模型 ID</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  显示名称 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={modelFormData.display_name}
                  onChange={(e) => setModelFormData({ ...modelFormData, display_name: e.target.value })}
                  placeholder="如 GPT-4o"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">描述</label>
                <input
                  type="text"
                  value={modelFormData.description}
                  onChange={(e) => setModelFormData({ ...modelFormData, description: e.target.value })}
                  placeholder="简要描述这个模型"
                  className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">优先级</label>
                  <input
                    type="number"
                    value={modelFormData.priority}
                    onChange={(e) => setModelFormData({ ...modelFormData, priority: e.target.value })}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm bg-muted border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modelFormData.supports_vision}
                    onChange={(e) => setModelFormData({ ...modelFormData, supports_vision: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-foreground">支持视觉</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modelFormData.supports_streaming}
                    onChange={(e) => setModelFormData({ ...modelFormData, supports_streaming: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-foreground">支持流式</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modelFormData.supports_function_calling}
                    onChange={(e) => setModelFormData({ ...modelFormData, supports_function_calling: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-foreground">支持函数调用</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModelFormData({ ...modelFormData, is_enabled: !modelFormData.is_enabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    modelFormData.is_enabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    modelFormData.is_enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`} />
                </button>
                <span className="text-xs text-foreground">启用</span>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setShowModelModal(false);
                    setEditingModel(null);
                  }}
                  className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {editingModel ? '保存修改' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
