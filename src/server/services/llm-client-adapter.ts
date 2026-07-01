/**
 * LLM Client Adapter
 * A generic OpenAI-compatible API client for dynamic LLM Provider support
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger('LLMClient');

// ===== Type Definitions =====

export interface LLMClientAdapterOptions {
  baseUrl: string;
  apiKey: string;
  customHeaders?: Record<string, string>;
  timeout?: number;
}

export interface LLMStreamChunk {
  content?: string;
  role?: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

export interface LLMChatOptions {
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

export interface LLMChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ===== LLM Client Adapter Class =====

export class LLMClientAdapter {
  private baseUrl: string;
  private apiKey: string;
  private customHeaders: Record<string, string>;
  private timeout: number;

  constructor(options: LLMClientAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.customHeaders = options.customHeaders || {};
    this.timeout = options.timeout || 60000;
  }

  /**
   * Create a streaming response using AsyncGenerator pattern
   */
  async *stream(
    messages: LLMMessage[],
    options: LLMChatOptions
  ): AsyncGenerator<LLMStreamChunk> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.customHeaders,
    };

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.formatMessages(messages),
      stream: true,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options.top_p !== undefined) body.top_p = options.top_p;
    if (options.stop !== undefined) body.stop = options.stop;
    if (options.presence_penalty !== undefined) body.presence_penalty = options.presence_penalty;
    if (options.frequency_penalty !== undefined) body.frequency_penalty = options.frequency_penalty;
    if (options.user !== undefined) body.user = options.user;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('LLM stream request failed', {
          status: response.status,
          error: errorText,
          url,
        });
        throw new Error(`LLM request failed: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              yield { finishReason: 'stop' };
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const chunk = this.parseStreamChunk(parsed);
              if (chunk) {
                yield chunk;
              }
            } catch {
              logger.warn('Failed to parse SSE chunk', { data });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`LLM request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Non-streaming chat completion
   */
  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMStreamChunk> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.customHeaders,
    };

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.formatMessages(messages),
      stream: false,
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (options.top_p !== undefined) body.top_p = options.top_p;
    if (options.stop !== undefined) body.stop = options.stop;
    if (options.presence_penalty !== undefined) body.presence_penalty = options.presence_penalty;
    if (options.frequency_penalty !== undefined) body.frequency_penalty = options.frequency_penalty;
    if (options.user !== undefined) body.user = options.user;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('LLM chat request failed', {
          status: response.status,
          error: errorText,
          url,
        });
        throw new Error(`LLM request failed: ${response.status} ${errorText}`);
      }

      const data: LLMChatResponse = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No choices in LLM response');
      }

      const choice = data.choices[0];
      return {
        content: choice.message.content,
        role: choice.message.role,
        finishReason: choice.finish_reason,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`LLM request timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Format messages to OpenAI-compatible format
   */
  private formatMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      if (Array.isArray(msg.content)) {
        return {
          role: msg.role,
          content: msg.content.map((part) => {
            if (part.type === 'text') {
              return { type: 'text', text: part.text };
            } else if (part.type === 'image_url') {
              return { type: 'image_url', image_url: part.image_url };
            }
            return part;
          }),
        };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  /**
   * Parse SSE stream chunk to LLMStreamChunk
   */
  private parseStreamChunk(data: Record<string, unknown>): LLMStreamChunk | null {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    const chunk: LLMStreamChunk = {};

    if (typeof delta.content === 'string') {
      chunk.content = delta.content;
    }

    if (typeof delta.role === 'string') {
      chunk.role = delta.role;
    }

    if (typeof data.finish_reason === 'string') {
      chunk.finishReason = data.finish_reason;
    }

    if (data.usage) {
      const usage = data.usage as Record<string, number>;
      chunk.usage = {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    }

    return chunk;
  }
}
