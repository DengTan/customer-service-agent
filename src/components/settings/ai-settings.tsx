'use client';

import { LlmProviderManager } from './llm-provider-manager';
import { AI_MODELS, MULTIMODAL_MODELS, DEFAULT_SYSTEM_PROMPT } from './types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface AISettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function AISettings({ settings, onSettingsChange }: AISettingsProps) {
  const { confirm } = useConfirmDialog();

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
            onProviderChange={(providerId) => onSettingsChange((prev) => ({ ...prev, llm_provider_id: providerId }))}
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
          <div className="space-y-2">
            {AI_MODELS.map((model) => (
              <button
                key={model.value}
                onClick={() => onSettingsChange((prev) => ({ ...prev, ai_model: model.value }))}
                disabled={settings.ai_model_enabled === 'false'}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border text-left transition-colors ${
                  settings.ai_model_enabled === 'false' ? 'opacity-40 cursor-not-allowed' :
                  (settings.ai_model || 'doubao-seed-2-0-lite-260215') === model.value
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/30 hover:bg-muted/30'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  (settings.ai_model || 'doubao-seed-2-0-lite-260215') === model.value && settings.ai_model_enabled !== 'false'
                    ? 'border-primary'
                    : 'border-muted-foreground/30'
                }`}>
                  {(settings.ai_model || 'doubao-seed-2-0-lite-260215') === model.value && settings.ai_model_enabled !== 'false' && (
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
          <div className="space-y-2">
            {MULTIMODAL_MODELS.map((model) => (
              <button
                key={model.value}
                onClick={() => onSettingsChange((prev) => ({ ...prev, multimodal_model: model.value }))}
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
          <p className="text-xs text-muted-foreground mb-3">控制单次回复的最大长度</p>
          <input
            type="number"
            value={settings.ai_max_tokens || '2048'}
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, ai_max_tokens: e.target.value }))}
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
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, ai_max_concurrent: e.target.value }))}
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
          <input
            type="number"
            value={settings.knowledge_search_limit || '5'}
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, knowledge_search_limit: e.target.value }))}
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
              onSettingsChange((prev) => ({ ...prev, knowledge_image_search_limit: e.target.value }))
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
