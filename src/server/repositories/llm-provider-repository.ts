import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { LlmProviderRow, LlmModelRow } from './types';
import { encrypt, safeDecrypt } from '@/lib/crypto';

/**
 * Mask API key for display (show first 3 chars + ***)
 */
function maskApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey) return null;
  if (apiKey.length <= 6) return apiKey.slice(0, 3) + '***';
  return apiKey.slice(0, 6) + '***';
}

/**
 * Process provider row for safe API response (mask API keys)
 */
function processProviderForResponse(provider: LlmProviderRow): LlmProviderRow {
  return {
    ...provider,
    api_key: provider.api_key ? maskApiKey(provider.api_key) : null,
  };
}

/**
 * Process providers list for safe API response (mask API keys)
 */
function processProvidersForResponse(providers: LlmProviderRow[]): LlmProviderRow[] {
  return providers.map(processProviderForResponse);
}

/**
 * LLM Provider Repository
 * Manages LLM API provider configurations (OpenAI, DeepSeek, Claude, etc.)
 */
export class LlmProviderRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * List all LLM providers
   */
  async list(): Promise<LlmProviderRow[]> {
    if (isDemoMode()) {
      return this.getDemoProviders();
    }

    const { data, error } = await this.client
      .from('llm_providers')
      .select('*')
      .order('priority', { ascending: false });

    if (error) throw new RepositoryError('list llm_providers', error.message, error.code);
    return processProvidersForResponse((data ?? []) as LlmProviderRow[]);
  }

  /**
   * Get provider by ID
   */
  async getById(id: string): Promise<LlmProviderRow | null> {
    if (isDemoMode()) {
      const providers = this.getDemoProviders();
      return providers.find(p => p.id === id) ?? null;
    }

    const { data, error } = await this.client
      .from('llm_providers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError(`get llm_provider ${id}`, error.message, error.code);
    return data ? processProviderForResponse(data as LlmProviderRow) : null;
  }

  /**
   * Get provider by name
   */
  async getByName(name: string): Promise<LlmProviderRow | null> {
    if (isDemoMode()) {
      const providers = this.getDemoProviders();
      return providers.find(p => p.name === name) ?? null;
    }

    const { data, error } = await this.client
      .from('llm_providers')
      .select('*')
      .eq('name', name)
      .maybeSingle();

    if (error) throw new RepositoryError(`get llm_provider by name ${name}`, error.message, error.code);
    return data ? processProviderForResponse(data as LlmProviderRow) : null;
  }

  /**
   * Get the default provider (is_default = true)
   */
  async getDefault(): Promise<LlmProviderRow | null> {
    if (isDemoMode()) {
      const providers = this.getDemoProviders();
      return providers.find(p => p.is_default) ?? providers[0] ?? null;
    }

    const { data, error } = await this.client
      .from('llm_providers')
      .select('*')
      .eq('is_default', true)
      .maybeSingle();

    if (error) throw new RepositoryError('get default llm_provider', error.message, error.code);
    return data ? processProviderForResponse(data as LlmProviderRow) : null;
  }

  /**
   * Get enabled providers sorted by priority
   */
  async listEnabled(): Promise<LlmProviderRow[]> {
    if (isDemoMode()) {
      return this.getDemoProviders().filter(p => p.is_enabled);
    }

    const { data, error } = await this.client
      .from('llm_providers')
      .select('*')
      .eq('is_enabled', true)
      .order('priority', { ascending: false });

    if (error) throw new RepositoryError('list enabled llm_providers', error.message, error.code);
    return processProvidersForResponse((data ?? []) as LlmProviderRow[]);
  }

  /**
   * Create a new LLM provider
   */
  async create(provider: Omit<LlmProviderRow, 'id' | 'created_at' | 'updated_at'>): Promise<LlmProviderRow> {
    if (isDemoMode()) {
      throw new Error('Demo mode: create not supported');
    }

    // Encrypt API key before storage
    const encryptedApiKey = provider.api_key ? encrypt(provider.api_key) : null;

    const { data, error } = await this.client
      .from('llm_providers')
      .insert({
        id: crypto.randomUUID(),
        name: provider.name,
        display_name: provider.display_name,
        description: provider.description ?? null,
        api_type: provider.api_type,
        base_url: provider.base_url,
        api_key: encryptedApiKey,
        models: provider.models ?? [],
        default_model: provider.default_model ?? null,
        supports_vision: provider.supports_vision,
        supports_streaming: provider.supports_streaming,
        max_context_tokens: provider.max_context_tokens ?? null,
        auth_config: provider.auth_config ?? null,
        request_config: provider.request_config ?? {},
        is_enabled: provider.is_enabled,
        is_default: provider.is_default,
        priority: provider.priority,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create llm_provider', error.message, error.code);
    // Return with masked API key
    return data ? processProviderForResponse(data as LlmProviderRow) : data as LlmProviderRow;
  }

  /**
   * Update an existing LLM provider
   */
  async update(id: string, updates: Partial<Omit<LlmProviderRow, 'id' | 'created_at'>>): Promise<LlmProviderRow> {
    if (isDemoMode()) {
      throw new Error('Demo mode: update not supported');
    }

    const updateData: Record<string, unknown> = {};
    
    // Only encrypt API key if it's being updated (not a masked value)
    if (updates.api_key !== undefined) {
      if (updates.api_key === null || updates.api_key === '') {
        updateData.api_key = null;
      } else if (!updates.api_key.includes('***')) {
        // It's a new real key, encrypt it
        updateData.api_key = encrypt(updates.api_key);
      }
      // If it contains '***', it's a masked value, don't update
    }
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.display_name !== undefined) updateData.display_name = updates.display_name;
    if (updates.description !== undefined) updateData.description = updates.description ?? null;
    if (updates.api_type !== undefined) updateData.api_type = updates.api_type;
    if (updates.base_url !== undefined) updateData.base_url = updates.base_url;
    if (updates.models !== undefined) updateData.models = updates.models;
    if (updates.default_model !== undefined) updateData.default_model = updates.default_model ?? null;
    if (updates.supports_vision !== undefined) updateData.supports_vision = updates.supports_vision;
    if (updates.supports_streaming !== undefined) updateData.supports_streaming = updates.supports_streaming;
    if (updates.max_context_tokens !== undefined) updateData.max_context_tokens = updates.max_context_tokens ?? null;
    if (updates.auth_config !== undefined) updateData.auth_config = updates.auth_config ?? null;
    if (updates.request_config !== undefined) updateData.request_config = updates.request_config;
    if (updates.is_enabled !== undefined) updateData.is_enabled = updates.is_enabled;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await this.client
      .from('llm_providers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError(`update llm_provider ${id}`, error.message, error.code);
    return data ? processProviderForResponse(data as LlmProviderRow) : data as LlmProviderRow;
  }

  /**
   * Delete an LLM provider
   */
  async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      throw new Error('Demo mode: delete not supported');
    }

    const { error } = await this.client
      .from('llm_providers')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError(`delete llm_provider ${id}`, error.message, error.code);
  }

  /**
   * Set a provider as default (unset others)
   */
  async setDefault(id: string): Promise<void> {
    if (isDemoMode()) {
      throw new Error('Demo mode: set default not supported');
    }

    const now = new Date().toISOString();
    
    // First, unset all defaults
    await this.client
      .from('llm_providers')
      .update({ is_default: false, updated_at: now })
      .eq('is_default', true);

    // Then set the new default
    const { error } = await this.client
      .from('llm_providers')
      .update({ is_default: true, updated_at: now })
      .eq('id', id);

    if (error) throw new RepositoryError(`set default llm_provider ${id}`, error.message, error.code);
  }

  /**
   * Get provider with decrypted API key (for internal use only)
   * Never return decrypted API key to the client
   */
  async getByIdWithDecryptedKey(id: string): Promise<LlmProviderRow | null> {
    if (isDemoMode()) {
      const providers = this.getDemoProviders();
      return providers.find(p => p.id === id) ?? null;
    }

    const { data, error } = await this.client
      .from('llm_providers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new RepositoryError(`get llm_provider ${id}`, error.message, error.code);
    if (!data) return null;

    const provider = data as LlmProviderRow;
    // Decrypt API key for internal use
    if (provider.api_key && !provider.api_key.startsWith('http')) {
      try {
        return {
          ...provider,
          api_key: safeDecrypt(provider.api_key),
        };
      } catch {
        // If decryption fails, return with original value (might be plain text)
        return provider;
      }
    }
    return provider;
  }

  /**
   * List models for a provider
   */
  async listModels(providerId: string): Promise<LlmModelRow[]> {
    if (isDemoMode()) {
      return this.getDemoModels().filter(m => m.provider_id === providerId);
    }

    const { data, error } = await this.client
      .from('llm_models')
      .select('*')
      .eq('provider_id', providerId)
      .eq('is_enabled', true)
      .order('display_name');

    if (error) throw new RepositoryError(`list models for provider ${providerId}`, error.message, error.code);
    return (data ?? []) as LlmModelRow[];
  }

  /**
   * Create a new model for a provider
   */
  async createModel(model: Omit<LlmModelRow, 'id' | 'created_at' | 'updated_at'>): Promise<LlmModelRow> {
    if (isDemoMode()) {
      throw new Error('Demo mode: create model not supported');
    }

    const { data, error } = await this.client
      .from('llm_models')
      .insert({
        id: crypto.randomUUID(),
        provider_id: model.provider_id,
        model_id: model.model_id,
        display_name: model.display_name,
        description: model.description ?? null,
        type: model.type,
        max_tokens: model.max_tokens ?? null,
        supports_vision: model.supports_vision,
        supports_streaming: model.supports_streaming,
        supports_function_calling: model.supports_function_calling,
        default_temperature: model.default_temperature,
        default_max_tokens: model.default_max_tokens ?? null,
        use_case: model.use_case,
        cost_per_1k_input: model.cost_per_1k_input ?? null,
        cost_per_1k_output: model.cost_per_1k_output ?? null,
        is_enabled: model.is_enabled,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create llm_model', error.message, error.code);
    return data as LlmModelRow;
  }

  /**
   * Delete a model
   */
  async deleteModel(id: string): Promise<void> {
    if (isDemoMode()) {
      throw new Error('Demo mode: delete model not supported');
    }

    const { error } = await this.client
      .from('llm_models')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError(`delete llm_model ${id}`, error.message, error.code);
  }

  /**
   * Demo data for development
   */
  private getDemoProviders(): LlmProviderRow[] {
    return [
      {
        id: 'demo-provider-coze',
        name: 'coze',
        display_name: 'Coze (豆包)',
        description: '火山引擎 Coze 平台，默认提供商',
        api_type: 'coze',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: null,
        models: ['doubao-seed-2-0-lite-260215', 'doubao-seed-1-6-250615', 'deepseek-v3-250324'],
        default_model: 'doubao-seed-2-0-lite-260215',
        supports_vision: true,
        supports_streaming: true,
        max_context_tokens: 128000,
        auth_config: null,
        request_config: {},
        is_enabled: true,
        is_default: true,
        priority: 100,
        created_at: new Date().toISOString(),
        updated_at: null,
      },
      {
        id: 'demo-provider-openai',
        name: 'openai',
        display_name: 'OpenAI',
        description: 'OpenAI GPT 系列模型',
        api_type: 'openai_compatible',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-***demo***',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        default_model: 'gpt-4o-mini',
        supports_vision: true,
        supports_streaming: true,
        max_context_tokens: 128000,
        auth_config: null,
        request_config: {},
        is_enabled: true,
        is_default: false,
        priority: 50,
        created_at: new Date().toISOString(),
        updated_at: null,
      },
      {
        id: 'demo-provider-deepseek',
        name: 'deepseek',
        display_name: 'DeepSeek',
        description: 'DeepSeek 系列模型，高性价比',
        api_type: 'openai_compatible',
        base_url: 'https://api.deepseek.com/v1',
        api_key: 'sk-***demo***',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        default_model: 'deepseek-chat',
        supports_vision: false,
        supports_streaming: true,
        max_context_tokens: 64000,
        auth_config: null,
        request_config: {},
        is_enabled: true,
        is_default: false,
        priority: 40,
        created_at: new Date().toISOString(),
        updated_at: null,
      },
    ];
  }

  private getDemoModels(): LlmModelRow[] {
    return [
      {
        id: 'demo-model-1',
        provider_id: 'demo-provider-coze',
        model_id: 'doubao-seed-2-0-lite-260215',
        display_name: 'Doubao Seed 2.0 Lite',
        description: '轻量快速，适合日常对话',
        type: 'chat',
        max_tokens: 4096,
        supports_vision: false,
        supports_streaming: true,
        supports_function_calling: true,
        default_temperature: 0.7,
        default_max_tokens: 2048,
        use_case: 'fast',
        cost_per_1k_input: 0,
        cost_per_1k_output: 0,
        is_enabled: true,
        created_at: new Date().toISOString(),
        updated_at: null,
      },
      {
        id: 'demo-model-2',
        provider_id: 'demo-provider-coze',
        model_id: 'doubao-seed-2-0-pro-260215',
        display_name: 'Doubao Seed 2.0 Pro',
        description: '多模态旗舰，支持图片理解',
        type: 'vision',
        max_tokens: 8192,
        supports_vision: true,
        supports_streaming: true,
        supports_function_calling: true,
        default_temperature: 0.7,
        default_max_tokens: 4096,
        use_case: 'quality',
        cost_per_1k_input: 0,
        cost_per_1k_output: 0,
        is_enabled: true,
        created_at: new Date().toISOString(),
        updated_at: null,
      },
    ];
  }
}
