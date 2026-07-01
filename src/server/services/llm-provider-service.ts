import { LlmProviderRepository } from '@/server/repositories/llm-provider-repository';
import { getLogger } from '@/lib/logger';

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
   * Get the default provider
   */
  async getDefaultProvider(): Promise<LlmProviderRow | null> {
    try {
      return await this.repository.getDefault();
    } catch (error) {
      logger.error('Failed to get default LLM provider', { error });
      throw this.toServiceError(error, 'Failed to get default provider');
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

      // If this is the first provider or marked as default, handle defaults
      const providers = await this.repository.list();
      const isFirstProvider = providers.length === 0;
      
      const provider = await this.repository.create({
        name: input.name,
        display_name: input.display_name,
        description: input.description ?? null,
        api_type: input.api_type || 'openai_compatible',
        base_url: input.base_url,
        api_key: input.api_key ?? null,
        models: input.models ?? [],
        default_model: input.default_model ?? null,
        supports_vision: input.supports_vision ?? false,
        supports_streaming: input.supports_streaming ?? true,
        max_context_tokens: input.max_context_tokens ?? null,
        auth_config: input.auth_config ?? null,
        request_config: input.request_config ?? {},
        is_enabled: input.is_enabled ?? true,
        is_default: input.is_default ?? isFirstProvider,
        priority: input.priority ?? 0,
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
      if (input.api_type !== undefined) updates.api_type = input.api_type;
      if (input.base_url !== undefined) updates.base_url = input.base_url;
      if (input.api_key !== undefined) updates.api_key = input.api_key ?? null;
      if (input.models !== undefined) updates.models = input.models;
      if (input.default_model !== undefined) updates.default_model = input.default_model ?? null;
      if (input.supports_vision !== undefined) updates.supports_vision = input.supports_vision;
      if (input.supports_streaming !== undefined) updates.supports_streaming = input.supports_streaming;
      if (input.max_context_tokens !== undefined) updates.max_context_tokens = input.max_context_tokens ?? null;
      if (input.auth_config !== undefined) updates.auth_config = input.auth_config ?? null;
      if (input.request_config !== undefined) updates.request_config = input.request_config;
      if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
      if (input.priority !== undefined) updates.priority = input.priority;

      if (input.is_default === true) {
        await this.repository.setDefault(id);
        updates.is_default = true;
      } else if (input.is_default === false && existing.is_default) {
        // Don't allow un-defaulting the only default provider
        const providers = await this.repository.listEnabled();
        if (providers.length <= 1) {
          throw new Error('Cannot remove default status from the only provider');
        }
        updates.is_default = false;
      }

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

      if (provider.is_default) {
        const providers = await this.repository.list();
        if (providers.length <= 1) {
          throw new Error('Cannot delete the only provider');
        }
        // Set another provider as default
        const otherProvider = providers.find(p => p.id !== id);
        if (otherProvider) {
          await this.repository.setDefault(otherProvider.id);
        }
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
   * Set a provider as default
   */
  async setDefaultProvider(id: string): Promise<LlmProviderRow> {
    try {
      const provider = await this.repository.getById(id);
      if (!provider) {
        throw new Error(`Provider with id '${id}' not found`);
      }

      if (!provider.is_enabled) {
        throw new Error('Cannot set a disabled provider as default');
      }

      await this.repository.setDefault(id);
      logger.info('Default LLM provider changed', { providerId: id, name: provider.name });
      
      return await this.repository.getById(id) as LlmProviderRow;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('not found') || error.message.includes('Cannot set'))) {
        throw error;
      }
      logger.error('Failed to set default LLM provider', { id, error });
      throw this.toServiceError(error, 'Failed to set default provider');
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
        type: input.type || 'chat',
        max_tokens: input.max_tokens ?? null,
        supports_vision: input.supports_vision ?? false,
        supports_streaming: input.supports_streaming ?? true,
        supports_function_calling: input.supports_function_calling ?? false,
        default_temperature: input.default_temperature ?? 0.7,
        default_max_tokens: input.default_max_tokens ?? null,
        use_case: input.use_case || 'general',
        cost_per_1k_input: input.cost_per_1k_input ?? null,
        cost_per_1k_output: input.cost_per_1k_output ?? null,
        is_enabled: input.is_enabled ?? true,
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

      // Simple test: try to call the provider's models endpoint
      const response = await fetch(`${provider.base_url}/models`, {
        headers: {
          'Authorization': `Bearer ${provider.api_key}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        return { success: true, message: 'Connection successful' };
      } else {
        const errorText = await response.text();
        return { success: false, message: `Connection failed: ${response.status} ${errorText}` };
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
    try {
      new URL(input.base_url);
    } catch {
      throw new Error('Invalid base URL format');
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

export interface CreateProviderInput {
  name: string;
  display_name: string;
  description?: string;
  api_type?: string;
  base_url: string;
  api_key?: string;
  models?: string[];
  default_model?: string;
  supports_vision?: boolean;
  supports_streaming?: boolean;
  max_context_tokens?: number;
  auth_config?: unknown;
  request_config?: Record<string, unknown>;
  is_enabled?: boolean;
  is_default?: boolean;
  priority?: number;
}

export interface UpdateProviderInput {
  name?: string;
  display_name?: string;
  description?: string;
  api_type?: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
  default_model?: string;
  supports_vision?: boolean;
  supports_streaming?: boolean;
  max_context_tokens?: number;
  auth_config?: unknown;
  request_config?: Record<string, unknown>;
  is_enabled?: boolean;
  is_default?: boolean;
  priority?: number;
}

export interface CreateModelInput {
  model_id: string;
  display_name: string;
  description?: string;
  type?: string;
  max_tokens?: number;
  supports_vision?: boolean;
  supports_streaming?: boolean;
  supports_function_calling?: boolean;
  default_temperature?: number;
  default_max_tokens?: number;
  use_case?: string;
  cost_per_1k_input?: number;
  cost_per_1k_output?: number;
  is_enabled?: boolean;
}
