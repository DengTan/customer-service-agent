import { LlmProviderRepository } from '@/server/repositories/llm-provider-repository';
import { getLogger } from '@/lib/logger';
import { normalizeLlmBaseUrl, isBlockedHostname } from '@/lib/url-utils';

const logger = getLogger('LLMProvider');
import type { LlmProviderRow, LlmModelRow } from '@/server/repositories/types';

/**
 * LLM Provider Service
 * Business logic layer for LLM API provider management
 */
export class LlmProviderService {
  private repository: LlmProviderRepository;

  constructor() {
    this.repository = new LlmProviderRepository();
  }

  /**
   * Get all providers with their models
   */
  async listProviders(): Promise<LlmProviderRow[]> {
    try {
      return await this.repository.list();
    } catch (error) {
      logger.error('Failed to list LLM providers', { error });
      throw this.toServiceError(error, 'Failed to list providers');
    }
  }

  /**
   * Get provider by ID
   */
  async getProvider(id: string): Promise<LlmProviderRow | null> {
    try {
      return await this.repository.getById(id);
    } catch (error) {
      logger.error('Failed to get LLM provider', { id, error });
      throw this.toServiceError(error, 'Failed to get provider');
    }
  }

  /**
   * Get provider by ID with decrypted API key (for internal use only)
   */
  async getProviderWithDecryptedKey(id: string): Promise<LlmProviderRow | null> {
    try {
      return await this.repository.getByIdWithDecryptedKey(id);
    } catch (error) {
      logger.error('Failed to get LLM provider with decrypted key', { id, error });
      throw this.toServiceError(error, 'Failed to get provider');
    }
  }

  /**
   * Get provider by name
   */
  async getProviderByName(name: string): Promise<LlmProviderRow | null> {
    try {
      return await this.repository.getByName(name);
    } catch (error) {
      logger.error('Failed to get LLM provider by name', { name, error });
      throw this.toServiceError(error, 'Failed to get provider');
    }
  }

  /**
   * Get provider by name with decrypted API key (for internal use only)
   */
  async getProviderByNameWithDecryptedKey(name: string): Promise<LlmProviderRow | null> {
    try {
      return await this.repository.getByNameWithDecryptedKey(name);
    } catch (error) {
      logger.error('Failed to get LLM provider by name with decrypted key', { name, error });
      throw this.toServiceError(error, 'Failed to get provider');
    }
  }

  /**
   * 统一加载 LLM Provider 配置（用于发送消息时的 LLM 调用）
   * 同时处理 provider 查找和 API Key 解密，所有使用 LLM 的地方都应使用此方法
   * 
   * @param providerId - 可选，指定 Provider ID；为空则使用第一个可用 Provider
   * @returns Provider 配置对象，如果未配置或未启用则返回 null
   */
  async loadProviderConfig(providerId?: string): Promise<LLMProviderConfig | null> {
    try {
      let provider: LlmProviderRow | null = null;

      if (providerId) {
        // 优先按 ID 查找
        provider = await this.repository.getById(providerId);
      }

      if (!provider) {
        // 回退到第一个可用的 Provider
        const providers = await this.repository.listEnabled();
        provider = providers[0] ?? null;
      }

      if (!provider || !provider.is_enabled) {
        logger.warn('[LlmProviderService] No enabled provider found', { providerId });
        return null;
      }

      // 获取解密后的 API Key
      const providerWithKey = await this.repository.getByIdWithDecryptedKey(provider.id);

      if (!providerWithKey?.api_key) {
        logger.warn('[LlmProviderService] Provider has no API key', { 
          providerId: provider.id, 
          name: provider.name 
        });
        return null;
      }

      // 验证 API Key 是否解密成功
      // 如果返回的仍是加密格式（iv:authTag:ciphertext 三段 base64），说明解密失败
      // 使用 crypto.ts 中的 isEncrypted 函数检测
      const { isEncrypted } = await import('@/lib/crypto');
      if (isEncrypted(providerWithKey.api_key)) {
        logger.error('[LlmProviderService] API key appears still encrypted after decryption attempt', { 
          providerId: provider.id, 
          name: provider.name,
          apiKeyPreview: providerWithKey.api_key.substring(0, 20) + '...',
        });
        return null;
      }

      const config: LLMProviderConfig = {
        providerId: provider.id,
        providerName: provider.name,
        providerBaseUrl: provider.base_url,
        providerApiKey: providerWithKey.api_key,
        defaultModel: provider.models?.[0] || undefined,
      };

      logger.info('[LlmProviderService] Loaded provider config', {
        providerId: config.providerId,
        name: config.providerName,
        baseUrl: config.providerBaseUrl,
        apiKeyLength: config.providerApiKey.length,
      });

      return config;
    } catch (error) {
      logger.error('[LlmProviderService] Failed to load provider config', { 
        providerId, 
        error 
      });
      return null;
    }
  }

  /**
   * Get enabled providers sorted by priority
   */
  async listEnabledProviders(): Promise<LlmProviderRow[]> {
    try {
      return await this.repository.listEnabled();
    } catch (error) {
      logger.error('Failed to list enabled LLM providers', { error });
      throw this.toServiceError(error, 'Failed to list enabled providers');
    }
  }

  /**
   * Create a new provider
   */
  async createProvider(input: CreateProviderInput): Promise<LlmProviderRow> {
    try {
      // Validate input
      this.validateProviderInput(input);

      // Check for duplicate name
      const existing = await this.repository.getByName(input.name);
      if (existing) {
        throw new Error(`Provider with name '${input.name}' already exists`);
      }
      
      const provider = await this.repository.create({
        name: input.name,
        display_name: input.display_name,
        description: input.description ?? null,
        base_url: input.base_url,
        api_key: input.api_key ?? null,
        models: input.models ?? [],
        supports_vision: input.supports_vision ?? false,
        supports_streaming: input.supports_streaming ?? true,
        max_context_tokens: input.max_context_tokens ?? null,
        auth_config: input.auth_config ?? null,
        request_config: input.request_config ?? {},
        is_enabled: input.is_enabled ?? true,
      });

      logger.info('LLM provider created', { providerId: provider.id, name: provider.name });
      return provider;
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw error;
      }
      logger.error('Failed to create LLM provider', { error });
      throw this.toServiceError(error, 'Failed to create provider');
    }
  }

  /**
   * Update a provider
   */
  async updateProvider(id: string, input: UpdateProviderInput): Promise<LlmProviderRow> {
    try {
      // Check if provider exists
      const existing = await this.repository.getById(id);
      if (!existing) {
        throw new Error(`Provider with id '${id}' not found`);
      }

      // Check for duplicate name if changing
      if (input.name && input.name !== existing.name) {
        const nameConflict = await this.repository.getByName(input.name);
        if (nameConflict) {
          throw new Error(`Provider with name '${input.name}' already exists`);
        }
      }

      const updates: Partial<LlmProviderRow> = {};
      
      if (input.name !== undefined) updates.name = input.name;
      if (input.display_name !== undefined) updates.display_name = input.display_name;
      if (input.description !== undefined) updates.description = input.description ?? null;
      if (input.base_url !== undefined) updates.base_url = input.base_url;
      if (input.api_key !== undefined) updates.api_key = input.api_key ?? null;
      if (input.models !== undefined) updates.models = input.models;
      if (input.supports_vision !== undefined) updates.supports_vision = input.supports_vision;
      if (input.supports_streaming !== undefined) updates.supports_streaming = input.supports_streaming;
      if (input.max_context_tokens !== undefined) updates.max_context_tokens = input.max_context_tokens ?? null;
      if (input.auth_config !== undefined) updates.auth_config = input.auth_config ?? null;
      if (input.request_config !== undefined) updates.request_config = input.request_config;
      if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;

      const provider = await this.repository.update(id, updates);
      logger.info('LLM provider updated', { providerId: id });
      return provider;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('not found') || error.message.includes('already exists') || error.message.includes('Cannot remove'))) {
        throw error;
      }
      logger.error('Failed to update LLM provider', { id, error });
      throw this.toServiceError(error, 'Failed to update provider');
    }
  }

  /**
   * Delete a provider
   */
  async deleteProvider(id: string): Promise<void> {
    try {
      const provider = await this.repository.getById(id);
      if (!provider) {
        throw new Error(`Provider with id '${id}' not found`);
      }

      await this.repository.delete(id);
      logger.info('LLM provider deleted', { providerId: id, name: provider.name });
    } catch (error) {
      if (error instanceof Error && (error.message.includes('not found') || error.message.includes('Cannot delete'))) {
        throw error;
      }
      logger.error('Failed to delete LLM provider', { id, error });
      throw this.toServiceError(error, 'Failed to delete provider');
    }
  }

  /**
   * Get models for a provider
   */
  async listProviderModels(providerId: string): Promise<LlmModelRow[]> {
    try {
      return await this.repository.listModels(providerId);
    } catch (error) {
      logger.error('Failed to list provider models', { providerId, error });
      throw this.toServiceError(error, 'Failed to list models');
    }
  }

  /**
   * Create a model for a provider
   */
  async createModel(providerId: string, input: CreateModelInput): Promise<LlmModelRow> {
    try {
      const provider = await this.repository.getById(providerId);
      if (!provider) {
        throw new Error(`Provider with id '${providerId}' not found`);
      }

      const model = await this.repository.createModel({
        provider_id: providerId,
        model_id: input.model_id,
        display_name: input.display_name,
        description: input.description ?? null,
        supports_vision: input.supports_vision ?? false,
        supports_streaming: input.supports_streaming ?? true,
        supports_function_calling: input.supports_function_calling ?? false,
        default_max_tokens: input.default_max_tokens ?? null,
        cost_per_1k_input: input.cost_per_1k_input ?? null,
        cost_per_1k_output: input.cost_per_1k_output ?? null,
        is_enabled: input.is_enabled ?? true,
        type: input.type ?? 'chat',
      });

      logger.info('LLM model created', { modelId: model.id, providerId });
      return model;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }
      logger.error('Failed to create LLM model', { providerId, error });
      throw this.toServiceError(error, 'Failed to create model');
    }
  }

  /**
   * Update a model
   */
  async updateModel(modelId: string, input: Partial<CreateModelInput>): Promise<LlmModelRow> {
    try {
      const updates: Partial<LlmModelRow> = {};
      
      if (input.model_id !== undefined) updates.model_id = input.model_id;
      if (input.display_name !== undefined) updates.display_name = input.display_name;
      if (input.description !== undefined) updates.description = input.description ?? null;
      if (input.supports_vision !== undefined) updates.supports_vision = input.supports_vision;
      if (input.supports_streaming !== undefined) updates.supports_streaming = input.supports_streaming;
      if (input.supports_function_calling !== undefined) updates.supports_function_calling = input.supports_function_calling;
      if (input.default_max_tokens !== undefined) updates.default_max_tokens = input.default_max_tokens ?? null;
      if (input.cost_per_1k_input !== undefined) updates.cost_per_1k_input = input.cost_per_1k_input ?? null;
      if (input.cost_per_1k_output !== undefined) updates.cost_per_1k_output = input.cost_per_1k_output ?? null;
      if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
      if (input.type !== undefined) updates.type = input.type;

      const model = await this.repository.updateModel(modelId, updates);
      logger.info('LLM model updated', { modelId });
      return model;
    } catch (error) {
      logger.error('Failed to update LLM model', { modelId, error });
      throw this.toServiceError(error, 'Failed to update model');
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(modelId: string): Promise<void> {
    try {
      await this.repository.deleteModel(modelId);
      logger.info('LLM model deleted', { modelId });
    } catch (error) {
      logger.error('Failed to delete LLM model', { modelId, error });
      throw this.toServiceError(error, 'Failed to delete model');
    }
  }

  /**
   * Test provider connection
   */
  async testConnection(id: string): Promise<{ success: boolean; message: string }> {
    try {
      // Use decrypted API key for testing
      const provider = await this.repository.getByIdWithDecryptedKey(id);
      if (!provider) {
        return { success: false, message: 'Provider not found' };
      }

      if (!provider.api_key) {
        return { success: false, message: 'API key not configured' };
      }

      // Test connection by calling /v1/chat/completions with a minimal request
      // Use shared URL normalization utility
      const endpoint = normalizeLlmBaseUrl(provider.base_url);
      const testResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.models?.[0] || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false,
        }),
      });

      if (testResponse.ok) {
        return { success: true, message: 'Connection successful' };
      } else {
        const errorText = await testResponse.text();
        return { success: false, message: `Connection failed: ${testResponse.status} ${errorText}` };
      }
    } catch (error) {
      logger.error('Failed to test LLM provider connection', { id, error });
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Connection test failed' 
      };
    }
  }

  /**
   * Validate provider input
   */
  private validateProviderInput(input: CreateProviderInput): void {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Provider name is required');
    }
    if (!/^[a-z0-9_-]+$/.test(input.name)) {
      throw new Error('Provider name must contain only lowercase letters, numbers, hyphens, and underscores');
    }
    if (!input.display_name || input.display_name.trim().length === 0) {
      throw new Error('Provider display name is required');
    }
    if (!input.base_url || input.base_url.trim().length === 0) {
      throw new Error('Base URL is required');
    }
    let url: URL;
    try {
      url = new URL(input.base_url);
    } catch {
      throw new Error('Invalid base URL format');
    }
    // SSRF protection: block internal IP addresses
    if (isBlockedHostname(url.hostname)) {
      throw new Error('Base URL cannot point to internal addresses');
    }
  }

  /**
   * Select the best model based on requirements
   * Selection criteria: default provider first, then enabled models
   */
  async selectBestModel(params: {
    type: 'chat' | 'vision';
    providerId?: string;
    supportsVision?: boolean;
    supportsFunctionCalling?: boolean;
  }): Promise<{ provider: LlmProviderRow; model: LlmModelRow } | null> {
    try {
      let providers: LlmProviderRow[];

      if (params.providerId) {
        // Use specific provider
        const provider = await this.repository.getById(params.providerId);
        if (!provider || !provider.is_enabled) {
          return null;
        }
        providers = [provider];
      } else {
        // Use all enabled providers
        providers = await this.repository.listEnabled();
      }

      for (const provider of providers) {
        const models = await this.repository.listModels(provider.id);
        if (models.length === 0) continue;

        // Find the best matching model
        const matchingModels = models.filter(m => {
          if (!m.is_enabled) return false;

          // For vision type or when vision is required, prefer models that support vision
          if (params.type === 'vision' || params.supportsVision) {
            return m.supports_vision;
          }
          // For chat type, prefer models that don't support vision (non-vision models)
          // or allow vision models if no non-vision model is available
          return true;
        });

        if (matchingModels.length === 0) continue;

        // If function calling is required, filter further
        if (params.supportsFunctionCalling) {
          const fcModel = matchingModels.find(m => m.supports_function_calling);
          if (fcModel) {
            return { provider, model: fcModel };
          }
        }

        // Return the first matching model
        return { provider, model: matchingModels[0] };
      }

      logger.warn('No suitable model found', { type: params.type, providerId: params.providerId });
      return null;
    } catch (error) {
      logger.error('Failed to select best model', { params, error });
      throw this.toServiceError(error, 'Failed to select model');
    }
  }

  /**
   * Convert error to service error
   */
  private toServiceError(error: unknown, context: string): Error {
    if (error instanceof Error) {
      return new Error(`${context}: ${error.message}`);
    }
    return new Error(`${context}: Unknown error`);
  }
}

// ===== Type Definitions =====

/**
 * LLM Provider 配置项（用于 LLMStreamingService）
 * 统一加载 LLM Provider 配置时返回的类型
 */
export interface LLMProviderConfig {
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  providerApiKey: string;
  defaultModel: string | undefined;
}

export interface CreateProviderInput {
  name: string;
  display_name: string;
  description?: string;
  base_url: string;
  api_key?: string;
  models?: string[];
  supports_vision?: boolean;
  supports_streaming?: boolean;
  max_context_tokens?: number;
  auth_config?: unknown;
  request_config?: Record<string, unknown>;
  is_enabled?: boolean;
}

export interface UpdateProviderInput {
  name?: string;
  display_name?: string;
  description?: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
  supports_vision?: boolean;
  supports_streaming?: boolean;
  max_context_tokens?: number;
  auth_config?: unknown;
  request_config?: Record<string, unknown>;
  is_enabled?: boolean;
}

export interface CreateModelInput {
  model_id: string;
  display_name: string;
  description?: string;
  max_tokens?: number;
  supports_vision?: boolean;
  supports_streaming?: boolean;
  supports_function_calling?: boolean;
  default_max_tokens?: number;
  cost_per_1k_input?: number;
  cost_per_1k_output?: number;
  is_enabled?: boolean;
  type?: string;
}
