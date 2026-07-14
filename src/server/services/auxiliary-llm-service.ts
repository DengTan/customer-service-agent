/**
 * AuxiliaryLLMService — P2 Bounded Rewrite & Claim Verifier
 *
 * A thin, safe wrapper around LLMClientAdapter for auxiliary (non-streaming) LLM calls
 * used during retrieval rewrite and claim verification.
 *
 * Design guarantees:
 * - Hard timeout on every call (caller cannot override)
 * - At most one compatibility retry (JSON mode unsupported → text JSON mode)
 * - Strict fenced-code JSON extraction + JSON.parse + caller validator
 * - No regex "repair" of truncated JSON
 * - Logs only: task name, elapsed ms, error type, content length (never secrets, full text, or full evidence)
 */

import { LLMClientAdapter, LLMChatOptions, LLMMessage } from './llm-client-adapter';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Constants (hard upper bounds — caller cannot override)
// ---------------------------------------------------------------------------
export const AUX_LLM = {
  /** Hard timeout for query rewrite calls (ms) */
  REWRITE_TIMEOUT_MS: 4000,
  /** Hard timeout for claim verification calls (ms) */
  VERIFY_TIMEOUT_MS: 6000,
  /** Conservative confidence threshold for claim support verdicts */
  VERIFY_MIN_CONFIDENCE: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Outcome of a JSON-mode auxiliary LLM call. */
export type AuxiliaryLlmResult<T> =
  | { ok: true; data: T; elapsedMs: number; attempts: 1 | 2 }
  | { ok: false; code: AuxiliaryLlmErrorCode; elapsedMs: number; attempts: 1 | 2 };

export type AuxiliaryLlmErrorCode =
  | 'timeout'
  | 'no_choices'
  | 'empty_content'
  | 'invalid_json'
  | 'validator_rejected'
  | 'unsupported'
  | 'network_error';

/** Extra metadata attached to every result for observability. */
export interface AuxiliaryLlmMetadata {
  task: string;
  model: string;
  elapsedMs: number;
  attempts: 1 | 2;
  errorCode?: AuxiliaryLlmErrorCode;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuxiliaryLLMService {
  /**
   * Call an OpenAI-compatible endpoint with JSON mode.
   *
   * Retry semantics:
   * 1. Request with `response_format: { type: 'json_object' }`.
   * 2. If the provider returns 400 + "unsupported" (or any non-JSON response),
   *    retry ONCE with plain text mode and extract JSON from fenced code blocks.
   * 3. Any subsequent failure (timeout, malformed JSON, validator rejection)
   *    returns a typed failure without further retries.
   *
   * @param baseUrl   Provider API base URL (e.g. "https://api.openai.com/v1")
   * @param apiKey    Bearer token
   * @param model     Model name
   * @param messages  Conversation messages
   * @param options   Call options
   * @returns         Typed result or typed failure
   */
  async completeJson<T>(
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: LLMMessage[],
    options: {
      task: string;
      /** Hard timeout in ms — must be ≤ the per-task constant above */
      timeoutMs: number;
      /** Validator run after JSON.parse succeeds. Return false to reject → code='validator_rejected' */
      validate?: (data: unknown) => data is T;
      /** Optional temperature override */
      temperature?: number;
      /** Extra OpenAI-compatible options */
      extraOptions?: Partial<Pick<LLMChatOptions, 'max_tokens' | 'top_p' | 'stop'>>;
    }
  ): Promise<AuxiliaryLlmResult<T>> {
    const startTime = Date.now();
    const { task, timeoutMs, validate, temperature = 0.1, extraOptions } = options;

    // Clamp timeout to hard maximum
    const effectiveTimeout = Math.min(timeoutMs, AUX_LLM.VERIFY_TIMEOUT_MS);

    const adapter = new LLMClientAdapter({
      baseUrl,
      apiKey,
      timeout: effectiveTimeout,
    });

    const attempt = async (jsonMode: boolean): Promise<{ content: string; attempts: 1 | 2 }> => {
      const opts: LLMChatOptions = {
        model,
        temperature,
        max_tokens: extraOptions?.max_tokens ?? 512,
        top_p: extraOptions?.top_p,
        stop: extraOptions?.stop,
        ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      };

      const result = await adapter.chat(messages, opts);

      // Guard: empty or missing content always fails with empty_content, never retries
      if (!result.content || result.content.trim() === '') {
        throw Object.assign(new Error('empty_content'), { _emptyContent: true });
      }

      return { content: result.content, attempts: jsonMode ? 1 : 2 };
    };

    // ---- Attempt 1: JSON mode ----
    try {
      const { content } = await attempt(true);
      const parsed = this.tryParseJson(content);
      if (parsed === null) {
        const elapsed = Date.now() - startTime;
        logger.agent.warn('[AuxiliaryLLM] JSON mode returned non-JSON', {
          task,
          elapsedMs: elapsed,
          contentLength: content.length,
        });
        // Fall through to retry below
      } else {
        const validated = validate ? validate(parsed) : true;
        if (!validated) {
          const elapsed = Date.now() - startTime;
          logger.agent.warn('[AuxiliaryLLM] JSON validator rejected output', {
            task,
            elapsedMs: elapsed,
            contentLength: content.length,
          });
          return { ok: false, code: 'validator_rejected', elapsedMs: elapsed, attempts: 1 };
        }
        return { ok: true, data: parsed as T, elapsedMs: Date.now() - startTime, attempts: 1 };
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const code = this.classifyError(err, elapsed, effectiveTimeout);
      if (code === 'unsupported') {
        logger.agent.warn('[AuxiliaryLLM] JSON mode unsupported, retrying as text', {
          task,
          elapsedMs: elapsed,
        });
      } else if (code === 'empty_content') {
        // Explicit empty_content → no retry
        return { ok: false, code: 'empty_content', elapsedMs: elapsed, attempts: 1 };
      } else {
        // Non-unsupported, non-empty error: do NOT retry — return typed failure immediately
        return { ok: false, code, elapsedMs: elapsed, attempts: 1 };
      }
    }

    // ---- Attempt 2: Text mode with fenced-code extraction ----
    try {
      const { content } = await attempt(false);
      const elapsed = Date.now() - startTime;
      const parsed = this.tryParseJsonFromFencedCode(content);
      if (parsed === null) {
        logger.agent.warn('[AuxiliaryLLM] Text-mode retry returned non-JSON', {
          task,
          elapsedMs: elapsed,
          contentLength: content.length,
        });
        return { ok: false, code: 'invalid_json', elapsedMs: elapsed, attempts: 2 };
      }
      const validated = validate ? validate(parsed) : true;
      if (!validated) {
        logger.agent.warn('[AuxiliaryLLM] Text-mode validator rejected output', {
          task,
          elapsedMs: elapsed,
          contentLength: content.length,
        });
        return { ok: false, code: 'validator_rejected', elapsedMs: elapsed, attempts: 2 };
      }
      return { ok: true, data: parsed as T, elapsedMs: elapsed, attempts: 2 };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const code = this.classifyError(err, elapsed, effectiveTimeout);
      // empty_content on retry is still invalid_json (should not reach here since attempt throws early)
      return { ok: false, code, elapsedMs: elapsed, attempts: 2 };
    }
  }

  // ---------------------------------------------------------------------------
  // Private: JSON parsing helpers
  // ---------------------------------------------------------------------------

  /**
   * Attempt direct JSON.parse on the content.
   * Returns null if the content is not valid JSON (no regex repair).
   */
  private tryParseJson(content: string): unknown | null {
    if (!content || typeof content !== 'string') return null;
    try {
      return JSON.parse(content.trim());
    } catch {
      return null;
    }
  }

  /**
   * Extract JSON from fenced code blocks (```json ... ```) and parse.
   * Falls back to raw parse. Returns null on failure (no regex repair).
   */
  private tryParseJsonFromFencedCode(content: string): unknown | null {
    if (!content || typeof content !== 'string') return null;
    // Try fenced code blocks first
    const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonText = fenceMatch ? fenceMatch[1] : content;
    return this.tryParseJson(jsonText.trim());
  }

  // ---------------------------------------------------------------------------
  // Private: Error classification
  // ---------------------------------------------------------------------------

  private classifyError(
    err: unknown,
    elapsedMs: number,
    timeoutMs: number
  ): AuxiliaryLlmErrorCode {
    // Re-throw sentinel for empty content (caught at outer level)
    if (err instanceof Error && '_emptyContent' in err) {
      return 'empty_content';
    }
    if (err instanceof Error) {
      if (
        err.name === 'TimeoutError' ||
        err.message.toLowerCase().includes('timeout') ||
        elapsedMs >= timeoutMs - 50
      ) {
        return 'timeout';
      }
      if (err.message.includes('400')) return 'unsupported';
      if (err.message.includes('No choices')) return 'no_choices';
      if (
        err.message.toLowerCase().includes('network') ||
        err.message.includes('fetch') ||
        err.message.includes('ECONNREFUSED')
      ) {
        return 'network_error';
      }
    }
    return 'network_error';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: AuxiliaryLLMService | null = null;

export function getAuxiliaryLLMService(): AuxiliaryLLMService {
  if (!_instance) _instance = new AuxiliaryLLMService();
  return _instance;
}

export function resetAuxiliaryLLMService(): void {
  _instance = null;
}
