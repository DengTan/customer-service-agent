/**
 * Ollama Embedding Service
 * Generates text embeddings via local Ollama server.
 * 
 * 模型优先级:
 * 1. bge-m3:567m — 高精度嵌入模型（需 Ollama 单独拉取）
 * 2. mxbai-embed-large — 备用模型，通用场景表现良好
 * 
 * 当主模型不可用时，自动降级到备用模型。
 */

import { logger } from '@/lib/logger';

const PRIMARY_MODEL   = process.env.OLLAMA_EMBEDDING_MODEL_PRIMARY   || 'bge-m3:567m';
const FALLBACK_MODEL = process.env.OLLAMA_EMBEDDING_MODEL_FALLBACK || 'mxbai-embed-large';
const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const TIMEOUT_MS       = 30_000;

export class EmbeddingService {
  private readonly baseUrl: string;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;
  private usingFallback = false;

  constructor(baseUrl?: string, primaryModel?: string, fallbackModel?: string) {
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.primaryModel   = primaryModel   || PRIMARY_MODEL;
    this.fallbackModel  = fallbackModel  || FALLBACK_MODEL;
  }

  /**
   * 当前使用的模型名称
   */
  get currentModel(): string {
    return this.usingFallback ? this.fallbackModel : this.primaryModel;
  }

  /**
   * 是否正在使用备用模型
   */
  get isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Generate embedding for a single text via Ollama /api/embeddings.
   * 
   * 降级策略:
   * 1. 优先使用 PRIMARY_MODEL (bge-m3:567m)
   * 2. 若调用失败（如模型未安装、服务不可用），自动降级到 FALLBACK_MODEL (mxbai-embed-large)
   * 3. 若备用模型也失败，抛出错误
   * 
   * 注意: 每次调用都会尝试主模型，支持动态恢复。
   */
  async embed(text: string): Promise<number[]> {
    if (!text?.trim()) {
      return [];
    }

    // 每次调用都先尝试主模型，支持动态恢复
    const tryEmbed = async (model: string): Promise<number[]> => {
      try {
        return await this.embedWithModel(text, model);
      } catch (error) {
        return Promise.reject(error);
      }
    };

    // Step 1: 尝试主模型
    try {
      return await tryEmbed(this.primaryModel);
    } catch (primaryError) {
      const primaryMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
      logger.agent.warn('[Embedding] Primary model failed, falling back', {
        primaryModel: this.primaryModel,
        error: primaryMsg,
        textLength: text.length,
      });

      // Step 2: 降级到备用模型
      try {
        const embedding = await tryEmbed(this.fallbackModel);
        this.usingFallback = true;
        logger.agent.info('[Embedding] Using fallback model', {
          fallbackModel: this.fallbackModel,
          textLength: text.length,
        });
        return embedding;
      } catch (fallbackError) {
        const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger.agent.error('[Embedding] Both models failed', {
          primaryModel: this.primaryModel,
          fallbackModel: this.fallbackModel,
          primaryError: primaryMsg,
          fallbackError: fallbackMsg,
          textLength: text.length,
        });
        throw new Error(`Embedding failed (primary: ${primaryMsg}, fallback: ${fallbackMsg})`);
      }
    }
  }

  /**
   * 使用指定模型生成嵌入
   */
  private async embedWithModel(text: string, model: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model, prompt: text }),
        signal:  controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { embedding?: number[] };
      if (!data.embedding || data.embedding.length === 0) {
        throw new Error('Ollama returned empty embedding');
      }

      return data.embedding;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Embedding timeout after ${TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }

  /**
   * Lightweight health check — pings Ollama's /api/tags endpoint.
   * Returns true only if the server is reachable and responds 2xx.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if the primary model is available.
   * Returns { available: boolean, model: string }
   */
  async checkPrimaryModel(): Promise<{ available: boolean; model: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        return { available: false, model: this.primaryModel };
      }

      const data = (await response.json()) as { models?: { name: string }[] };
      const modelNames = (data.models || []).map(m => m.name);
      const available = modelNames.some(name => 
        name.startsWith(this.primaryModel) || name === this.primaryModel
      );

      return { available, model: this.primaryModel };
    } catch {
      return { available: false, model: this.primaryModel };
    }
  }

  /**
   * Batch embed multiple texts sequentially.
   * Ollama does not support true batching, so we call sequentially to avoid overload.
   * 
   * 每条文本独立尝试主模型，支持动态恢复。
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      try {
        const embedding = await this.embed(text);
        results.push(embedding);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.agent.error('[Embedding] embedBatch failure', {
          error: errMsg,
          textLength: text?.length || 0,
          currentModel: this.currentModel,
        });
        throw new Error(`Embedding failed: ${errMsg}`);
      }
    }

    return results;
  }

  /**
   * 重置降级状态，下次调用会重新尝试主模型
   */
  resetFallback(): void {
    this.usingFallback = false;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!_instance) {
    _instance = new EmbeddingService();
  }
  return _instance;
}

export function resetEmbeddingService(): void {
  _instance = null;
}
