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
      reasoning?: string;
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
    console.log('[LLMClient] stream() called with url:', url, 'model:', options.model);
    console.log('[LLMClient] messages count:', messages.length);
    console.log('[LLMClient] messages[0]:', JSON.stringify(messages[0]).substring(0, 200));
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.customHeaders,
    };
    console.log('[LLMClient] headers:', JSON.stringify(headers).replace(/Bearer [^"]+/, 'Bearer ***'));

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

      console.log('[LLMClient] response status:', response.status);
      console.log('[LLMClient] response ok:', response.ok);
      console.log('[LLMClient] response body type:', typeof response.body, response.body ? 'exists' : 'null');

      if (!response.ok) {
        const errorText = await response.text();
        console.log('[LLMClient] error response:', errorText);
        logger.error('LLM stream request failed', {
          status: response.status,
          error: errorText,
          url,
        });
        throw new Error(`LLM request failed: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        console.log('[LLMClient] response body is null!');
        throw new Error('Response body is null');
      }

      console.log('[LLMClient] starting to read stream...');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        const readCount = 0;
        while (true) {
          const result = await reader.read();
          console.log('[LLMClient] read() result:', JSON.stringify({ done: result.done, valueLen: result.value?.length, valueFirstBytes: result.value ? Array.from(result.value.slice(0, 20)) : null }));
          const { done, value } = result;
          if (done) {
            console.log('[LLMClient] stream done, buffer remaining:', buffer.length, 'chars');
            break;
          }

          const decoded = decoder.decode(value, { stream: true });
          console.log('[LLMClient] decoded chunk length:', decoded.length, 'preview:', decoded.substring(0, 100));
          buffer += decoded;
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
      // Only use the standard content field; reasoning/thinking content is intentionally
      // not exposed to prevent internal thought processes from appearing in user-facing responses
      const messageContent = choice.message.content ?? '';
      if (!messageContent && choice.message.reasoning) {
        logger.warn('[LLMClient] Model returned only reasoning content with no content field; response may be incomplete');
      }
      return {
        content: messageContent,
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
    // Extract delta from choices[0] (standard OpenAI streaming format)
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const delta = choice?.delta as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;

    // DEBUG
    console.log('[LLMClient DEBUG] parsed:', JSON.stringify(data).substring(0, 300));

    if (!delta && !message) return null;

    const chunk: LLMStreamChunk = {};

    // Handle delta.content (standard OpenAI format) — this is the visible response
    if (delta && typeof delta.content === 'string') {
      chunk.content = delta.content;
    }

    // NOTE: delta.reasoning is intentionally NOT forwarded to the client.
    // Reasoning/thinking content from models like Sensenova contains internal thought
    // processes that should never be shown to end users. This is handled separately
    // in the streaming service for internal logging purposes only.
    // if (delta && typeof delta.reasoning === 'string') { ... }

    // Handle message.content (non-streaming response shape — fallback for some providers)
    if (message && typeof message.content === 'string') {
      chunk.content = (chunk.content || '') + message.content;
    }

    // Handle message.reasoning only when there is no message.content (non-streaming fallback)
    // Never expose reasoning content to users even in non-streaming path
    if (message && typeof message.reasoning === 'string') {
      // Only use reasoning as fallback if content is empty — but do NOT expose reasoning
      if (!chunk.content) {
        logger.warn('[LLMClient] Model returned only reasoning content with no content field; response may be incomplete');
      }
      // Deliberately NOT appending reasoning to chunk.content to prevent exposing it
    }

    // Only yield if there's actual content to return
    if (chunk.content !== undefined && chunk.content !== '') {
      console.log('[LLMClient DEBUG] parsed chunk content:', chunk.content.substring(0, 50));
      return chunk;
    }

    if (delta && typeof delta.role === 'string') {
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

    console.log('[LLMClient DEBUG] parsed chunk:', JSON.stringify(chunk));
    return chunk;
  }
}
