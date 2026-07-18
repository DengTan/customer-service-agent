'use client';

import { LlmProviderManager } from './llm-provider-manager';
import { DEFAULT_SYSTEM_PROMPT } from './types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { NumberInput } from '@/components/common/number-input';
import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '@/lib/logger';
import { ImageIcon, Zap, Bot } from 'lucide-react';

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
  supports_streaming: boolean;
  default_temperature: number;
  use_case: string;
  is_enabled: boolean;
}

interface LlmProvider {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  api_type: string;
  base_url: string;
  models: string[];
  default_model?: string | null;
  supports_vision: boolean;
  supports_streaming: boolean;
  max_context_tokens?: number | null;
  is_enabled: boolean;
  is_default: boolean;
  priority: number;
}

interface AISettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /**
   * Called whenever a number-typed field's validation state changes.
   * Pass `false` when at least one field is invalid so the parent's
   * save button can be disabled and the user sees a precise hint next
   * to the offending field. The local state still allows typing partial
   * values ("-", "0.", etc.) — `isValid` reflects only fully-formed
   * values that would survive a roundtrip through the server validator.
   */
  onValidationChange?: (isValid: boolean, invalidKey: string | null) => void;
}

export function AISettings({ settings, onSettingsChange, onValidationChange }: AISettingsProps) {
  const { confirm } = useConfirmDialog();
  const [providerModels, setProviderModels] = useState<Record<string, LlmModel[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const initialLoadDone = useRef(false);
  const loadedProviderIds = useRef<Set<string>>(new Set());

  // Track the validity of every bounded numeric field. We aggregate here
  // (instead of inside each NumberInput) so the parent gets a single
  // signal it can use to disable the save button. Fields map → validity
  // — any single invalid field flips the global state to invalid.
  const fieldValidityRef = useRef<Record<string, boolean>>({});
  const reportValidity = useCallback(() => {
    if (!onValidationChange) return;
    const invalidKey =
      Object.entries(fieldValidityRef.current).find(([, v]) => !v)?.[0] ?? null;
    onValidationChange(invalidKey === null, invalidKey);
  }, [onValidationChange]);

  const trackField = useCallback(
    (key: string) => (isValid: boolean) => {
      if (fieldValidityRef.current[key] === isValid) return;
      fieldValidityRef.current[key] = isValid;
      reportValidity();
    },
    [reportValidity],
  );
  const trackMaxTokens = trackField('ai_max_tokens');
  const trackMaxConcurrent = trackField('ai_max_concurrent');
  const trackSearchLimit = trackField('knowledge_search_limit');
  const trackImageLimit = trackField('knowledge_image_search_limit');

  const loadProviderModels = async (providerId: string, forceRefresh = false) => {
    // Skip cache if force refresh is requested
    if (!forceRefresh && loadedProviderIds.current.has(providerId)) {
      return;
    }
    setModelsLoading(true);
    try {
      const res = await fetch(`/api/llm-providers?provider_id=${providerId}`);
      const data = await res.json();
      loadedProviderIds.current.add(providerId);
      setProviderModels(prev => ({ ...prev, [providerId]: data.models || [] }));
    } catch (error) {
      logger.error('Failed to load provider models', { error });
    } finally {
      setModelsLoading(false);
    }
  };

  // Handle models change callback from LlmProviderManager
  const handleModelsChange = (providerId: string) => {
    // Force refresh the models for this provider
    loadedProviderIds.current.delete(providerId);
    loadProviderModels(providerId, true);
  };

  // Load providers and models on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Fetch providers list
        const providersRes = await fetch('/api/llm-providers');
        const providersData = await providersRes.json();
        const providerList = providersData.providers || [];
        setProviders(providerList);

        // Determine which provider to use
        let providerId = settings.llm_provider_id;
        
        // If no provider set, use default provider or first available
        if (!providerId) {
          const defaultProvider = providerList.find((p: { is_default: boolean }) => p.is_default) || providerList[0];
          if (defaultProvider) {
            providerId = defaultProvider.id;
            onSettingsChange((prev) => ({ ...prev, llm_provider_id: providerId }));
          }
        }

        // Load models for the current provider
        if (providerId) {
          await loadProviderModels(providerId);
        }
      } catch (error) {
        logger.error('Failed to load initial provider data', { error });
      }
    };

    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      loadInitialData();
    }
  }, []);

  // Load models when provider changes
  useEffect(() => {
    if (settings.llm_provider_id) {
      loadProviderModels(settings.llm_provider_id);
    }
  }, [settings.llm_provider_id]);

  const getCurrentProviderModels = () => {
    return providerModels[settings.llm_provider_id || ''] || [];
  };

  const handleRestoreDefault = async () => {
    const confirmed = await confirm({
      title: '恢复默认',
      description: '确定要恢复系统提示词为默认内容吗？当前编辑的内容将被覆盖。',
      confirmText: '恢复',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    onSettingsChange((prev) => ({ ...prev, system_prompt: DEFAULT_SYSTEM_PROMPT }));
  };
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">AI 模型配置</h2>
      <p className="text-xs text-muted-foreground mb-4">选择模型和调整参数以优化回复质量</p>

      <div className="space-y-6">
        {/* LLM Provider Manager */}
        <div className="rounded-xl border border-border bg-card p-5">
          <LlmProviderManager 
            currentProviderId={settings.llm_provider_id}
            onProviderChange={(providerId) => {
              onSettingsChange((prev) => ({ ...prev, llm_provider_id: providerId }));
              loadProviderModels(providerId);
            }}
            onModelsChange={handleModelsChange}
          />
        </div>

        {/* Regular Model Selection */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-foreground block">普通模型</label>
            <button
              onClick={() => onSettingsChange((prev) => ({ ...prev, ai_model_enabled: prev.ai_model_enabled === 'false' ? 'true' : 'false' }))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                settings.ai_model_enabled !== 'false' ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                settings.ai_model_enabled !== 'false' ? 'translate-x-4.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {settings.ai_model_enabled !== 'false'
              ? '已启用，用于日常文本对话'
              : '已关闭，日常文本对话将使用多模态模型（如已启用）'}
          </p>
          
          {modelsLoading && settings.llm_provider_id ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const textModels = getCurrentProviderModels().filter(m => !m.supports_vision);
                if (textModels.length === 0) {
                  return <p className="text-xs text-muted-foreground py-2">该提供商暂无普通模型</p>;
                }
                return textModels.map((model) => (
                  <button
                    key={model.id || model.model_id}
                    onClick={() => onSettingsChange((prev) => ({ ...prev, ai_model: model.model_id }))}
                    disabled={settings.ai_model_enabled === 'false'}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      settings.ai_model_enabled === 'false' ? 'opacity-40 cursor-not-allowed' :
                      (settings.ai_model || '') === model.model_id
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/30 hover:bg-muted/30 border-border'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      (settings.ai_model || '') === model.model_id && settings.ai_model_enabled !== 'false'
                        ? 'border-primary'
                        : 'border-muted-foreground/30'
                    }`}>
                      {(settings.ai_model || '') === model.model_id && settings.ai_model_enabled !== 'false' && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{model.display_name}</p>
                      <p className="text-xs text-muted-foreground">{model.description || model.model_id}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {model.supports_streaming && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">
                          <Zap className="w-3 h-3" /> 流式
                        </span>
                      )}
                      {model.supports_function_calling && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded">
                          <Bot className="w-3 h-3" /> 函数
                        </span>
                      )}
                    </div>
                  </button>
                ));
              })()}
            </div>
          )}
        </div>

        {/* Multimodal Model Selection */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-foreground block">多模态模型</label>
            <button
              onClick={() => onSettingsChange((prev) => ({ ...prev, multimodal_enabled: prev.multimodal_enabled === 'false' ? 'true' : 'false' }))}
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

          {modelsLoading && settings.llm_provider_id ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const visionModels = getCurrentProviderModels().filter(m => m.supports_vision);
                if (visionModels.length === 0) {
                  return <p className="text-xs text-muted-foreground py-2">该提供商暂无多模态模型</p>;
                }
                return visionModels.map((model) => (
                  <button
                    key={model.id || model.model_id}
                    onClick={() => onSettingsChange((prev) => ({ ...prev, multimodal_model: model.model_id }))}
                    disabled={settings.multimodal_enabled === 'false'}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      settings.multimodal_enabled === 'false' ? 'opacity-40 cursor-not-allowed' :
                      (settings.multimodal_model || '') === model.model_id
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/30 hover:bg-muted/30 border-border'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      (settings.multimodal_model || '') === model.model_id && settings.multimodal_enabled !== 'false'
                        ? 'border-primary'
                        : 'border-muted-foreground/30'
                    }`}>
                      {(settings.multimodal_model || '') === model.model_id && settings.multimodal_enabled !== 'false' && (
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{model.display_name}</p>
                      <p className="text-xs text-muted-foreground">{model.description || model.model_id}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded">
                        <ImageIcon className="w-3 h-3" /> 多模态
                      </span>
                      {model.supports_streaming && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">
                          <Zap className="w-3 h-3" /> 流式
                        </span>
                      )}
                    </div>
                  </button>
                ));
              })()}
            </div>
          )}

          {/* Multimodal disabled action */}
          {settings.multimodal_enabled === 'false' && (
            <div className="mt-4 pt-4 border-t border-border">
              <label className="text-xs font-medium text-foreground mb-2 block">图片处理策略</label>
              <p className="text-xs text-muted-foreground mb-3">多模态关闭时，用户发送图片的处理方式</p>
              <div className="space-y-2">
                <button
                  onClick={() => onSettingsChange((prev) => ({ ...prev, multimodal_disabled_action: 'fixed_message' }))}
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
                {(settings.multimodal_disabled_action || 'fixed_message') === 'fixed_message' && (
                  <div className="ml-7">
                    <label className="text-xs font-medium text-foreground mb-1 block">话术内容</label>
                    <textarea
                      value={settings.multimodal_fixed_message || '抱歉，当前未开启图片识别功能，无法识别您发送的图片。如需帮助，请转接人工客服或以文字描述您的问题。'}
                      onChange={(e) => onSettingsChange((prev) => ({ ...prev, multimodal_fixed_message: e.target.value }))}
                      rows={3}
                      className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}
                <button
                  onClick={() => onSettingsChange((prev) => ({ ...prev, multimodal_disabled_action: 'handoff' }))}
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
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, ai_temperature: e.target.value }))}
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
          <p className="text-xs text-muted-foreground mb-3">控制单次回复的最大长度（推荐 256~8192）</p>
          <NumberInput
            id="ai-max-tokens"
            value={settings.ai_max_tokens || '2048'}
            onChange={(v) => onSettingsChange((prev) => ({ ...prev, ai_max_tokens: v }))}
            onValidationChange={trackMaxTokens}
            min={1}
            max={32_000}
            step={1}
            fallback="2048"
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
          <NumberInput
            id="ai-max-concurrent"
            value={settings.ai_max_concurrent || '0'}
            onChange={(v) => onSettingsChange((prev) => ({ ...prev, ai_max_concurrent: v }))}
            onValidationChange={trackMaxConcurrent}
            min={0}
            max={10_000}
            step={1}
            fallback="0"
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
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, knowledge_min_score: e.target.value }))}
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
          <NumberInput
            id="knowledge-search-limit"
            value={settings.knowledge_search_limit || '5'}
            onChange={(v) => onSettingsChange((prev) => ({ ...prev, knowledge_search_limit: v }))}
            onValidationChange={trackSearchLimit}
            min={1}
            max={50}
            step={1}
            fallback="5"
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
          <NumberInput
            id="knowledge-image-search-limit"
            value={settings.knowledge_image_search_limit || '3'}
            onChange={(v) =>
              onSettingsChange((prev) => ({ ...prev, knowledge_image_search_limit: v }))
            }
            onValidationChange={trackImageLimit}
            min={0}
            max={20}
            step={1}
            fallback="3"
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
              onClick={handleRestoreDefault}
              className="text-xs text-primary hover:underline"
            >
              恢复默认
            </button>
          </div>
          <textarea
            value={settings.system_prompt || DEFAULT_SYSTEM_PROMPT}
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, system_prompt: e.target.value }))}
            rows={12}
            className="w-full resize-none px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono text-xs leading-relaxed"
          />
        </div>
      </div>
    </section>
  );
}
