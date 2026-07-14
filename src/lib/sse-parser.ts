/**
 * SSE (Server-Sent Events) Parser Utility
 *
 * Common utilities for parsing SSE streams in browser environments.
 */

import { logger } from '@/lib/logger';

export interface ParsedSSEChunk {
  content?: string;
  confidence?: number;
  confidence_breakdown?: ConfidenceBreakdown | Record<string, number | boolean>;
  sources?: SourceItem[];
  done?: boolean;
  error?: string;
  source?: string;
  reason?: string;
  /** Persisted message count — only present on done chunks from simulation messages route */
  message_count?: number;
  /** True when the LLM stream timed out server-side */
  timed_out?: boolean;
  [key: string]: unknown;
}

export interface ConfidenceBreakdown {
  knowledge_score?: number;
  tool_score?: number;
  llm_self_score?: number;
  sub_agent_score?: number;
  handoff_intent?: boolean;
  no_support?: boolean;
  final?: number;
  [key: string]: number | boolean | undefined;
}

export interface SourceItem {
  type?: string;
  content?: string;
  score?: number;
  keyword?: string;
  name?: string;
  category?: string;
  knowledge_item_id?: string;
  item_id?: string;
}

export interface SSEParseResult {
  content: string;
  confidence: number | null;
  confidenceBreakdown: ConfidenceBreakdown | null;
  sources: SourceItem[];
  source?: string;
  reason?: string;
  /** Persisted message count from the final done chunk, if present */
  message_count?: number;
  /** True if the server signalled a timeout */
  timed_out?: boolean;
  /** True if the server emitted an error chunk (without a corresponding done) */
  hadError: boolean;
  /** Last error message from any error chunk, if present */
  error?: string;
}

/**
 * Throw a proper `AbortError` for an aborted signal.
 *
 * `signal.throwIfAborted()` throws `signal.reason` verbatim, which may be a
 * plain string (e.g. `controller.abort('user-canceled')`). Callers expect an
 * `Error` whose `name === 'AbortError'` and whose `message` carries the reason,
 * so we normalize here:
 *  - If `reason` is already an `Error` (the default DOMException from a bare
 *    `abort()`), rethrow it unchanged.
 *  - Otherwise build a DOMException `AbortError`, using a string reason as the
 *    message when present.
 */
function throwAbort(signal: AbortSignal): never {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const message =
    typeof reason === 'string' && reason.length > 0
      ? reason
      : 'The operation was aborted';
  if (typeof DOMException === 'function') {
    throw new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  throw err;
}

/**
 * Parse SSE stream from a ReadableStream reader.
 *
 * Important invariants:
 *  - Data lines that span multiple `Uint8Array` chunks are buffered until the
 *    next `\n`. This prevents losing half a JSON payload when the upstream
 *    stream chunks at arbitrary byte boundaries.
 *  - `TextDecoder` is used with `stream: true` while the stream is open, and a
 *    final non-streaming decode after `done` to flush trailing bytes (e.g. a
 *    multibyte UTF-8 char whose last byte arrived in the last chunk).
 *  - `onChunk` is only invoked for fully-delimited lines; partial lines that
 *    span the next chunk are buffered.
 *  - When `signal` is provided, `parseSSEStream` throws an `Error` with
 *    `name === 'AbortError'` if the signal aborts. The thrown error preserves
 *    `signal.reason` as its `message` when the reason is a string, so callers
 *    can inspect the abort cause.
 */

export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
  onChunk?: (chunk: ParsedSSEChunk) => void,
  signal?: AbortSignal
): Promise<SSEParseResult> {
  if (!reader) {
    return {
      content: '',
      confidence: null,
      confidenceBreakdown: null,
      sources: [],
      source: undefined,
      reason: undefined,
      hadError: false,
    };
  }

  // Honor an already-aborted signal before doing any work.
  if (signal?.aborted) {
    throwAbort(signal);
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let lastConfidence: number | null = null;
  let lastConfidenceBreakdown: ConfidenceBreakdown | null = null;
  let lastSources: SourceItem[] = [];
  let lastSource: string | undefined;
  let lastReason: string | undefined;
  let lastMessageCount: number | undefined;
  let lastTimedOut: boolean | undefined;
  let hadError = false;
  let lastError: string | undefined;
  // Carry-over text from the previous `value` chunk so data lines that span
  // multiple reads are reassembled correctly. Only complete lines (ending in
  // \n) are processed inside the loop; the residual stays for the next read.
  let textBuffer = '';

  // Wire up a listener that cancels the reader when the signal aborts. This
  // is required to interrupt an in-flight reader.read() — `throwIfAborted`
  // alone cannot preempt a pending read because that promise only resolves
  // when the underlying stream produces data or closes.
  let onAbort: (() => void) | undefined;
  if (signal) {
    onAbort = () => {
      // Best-effort: cancel the reader so the next .read() resolves with
      // { done: true }. The cancel() promise is intentionally not awaited;
      // it can resolve later, after we've already thrown.
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Reader may already be released or cancelled; ignore.
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const processLine = (rawLine: string): void => {
    const trimmed = rawLine.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) return;
    if (trimmed === 'data: [DONE]') return;

    let parsed: ParsedSSEChunk;
    try {
      parsed = JSON.parse(trimmed.slice(6)) as ParsedSSEChunk;
    } catch {
      // Skip malformed JSON — surface nothing to the caller but keep going.
      return;
    }

    if (parsed.content) {
      fullContent += parsed.content;
    }

    if (onChunk) {
      try {
        onChunk(parsed);
      } catch (callbackErr) {
        logger.warn('SSE onChunk callback threw', { error: callbackErr });
      }
    }

    if (parsed.done) {
      if (parsed.confidence !== undefined) lastConfidence = parsed.confidence;
      if (parsed.confidence_breakdown !== undefined) {
        lastConfidenceBreakdown = parsed.confidence_breakdown as ConfidenceBreakdown;
      }
      if (parsed.sources !== undefined) lastSources = parsed.sources;
      if (parsed.source !== undefined) lastSource = parsed.source;
      if (parsed.reason !== undefined) lastReason = parsed.reason;
      if (parsed.message_count !== undefined) lastMessageCount = parsed.message_count;
      if (parsed.timed_out !== undefined) lastTimedOut = parsed.timed_out;
    }
    if (parsed.error) {
      hadError = true;
      lastError = parsed.error;
    }
  };

  const processText = (text: string, finalize: boolean): void => {
    // Append to the carry-over buffer, then split off all complete lines.
    textBuffer += text;
    let newlineIdx = textBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = textBuffer.slice(0, newlineIdx);
      textBuffer = textBuffer.slice(newlineIdx + 1);
      processLine(line);
      newlineIdx = textBuffer.indexOf('\n');
    }
    if (finalize) {
      // Stream is closed: any remaining bytes form a final, possibly
      // incomplete line. Attempt to process it; if it's not a valid SSE line,
      // processLine silently skips it.
      if (textBuffer.length > 0) {
        processLine(textBuffer);
        textBuffer = '';
      }
    }
  };

  try {
    while (true) {
      // Respect abort signal before the next read.
      if (signal?.aborted) {
        throwAbort(signal);
      }

      const { done, value } = await reader.read();

      // Honor signal that aborted while the read was in flight.
      if (signal?.aborted) {
        throwAbort(signal);
      }

      if (done) {
        // Flush any trailing bytes (handles the case where the last chunk
        // ended mid-UTF-8-sequence or without a trailing newline).
        const trailing = decoder.decode();
        processText(trailing, /* finalize */ true);
        break;
      }

      // stream: true so multibyte UTF-8 sequences split across reads decode
      // correctly. The residual decoder state is preserved for the next read.
      const text = decoder.decode(value, { stream: true });
      processText(text, /* finalize */ false);
    }
  } finally {
    if (onAbort && signal) {
      signal.removeEventListener('abort', onAbort);
    }
    // We intentionally do NOT release the reader here; the caller owns the
    // stream lifecycle and is expected to call reader.releaseLock().
  }

  return {
    content: fullContent,
    confidence: lastConfidence,
    confidenceBreakdown: lastConfidenceBreakdown,
    sources: lastSources,
    source: lastSource,
    reason: lastReason,
    message_count: lastMessageCount,
    timed_out: lastTimedOut,
    hadError,
    error: lastError,
  };
}

/**
 * Parse SSE text directly (synchronous)
 *
 * @param text - Raw SSE text
 * @returns Array of parsed chunks
 */
export function parseSSEText(text: string): ParsedSSEChunk[] {
  const chunks: ParsedSSEChunk[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const parsed = JSON.parse(line.slice(6)) as ParsedSSEChunk;
        chunks.push(parsed);
      } catch {
        // Skip malformed chunks
      }
    }
  }

  return chunks;
}

/**
 * Extract the final result from SSE text
 *
 * @param text - Raw SSE text
 * @returns Final parsed result
 */
export function extractFinalFromSSEText(text: string): SSEParseResult {
  const chunks = parseSSEText(text);
  let fullContent = '';
  let lastConfidence: number | null = null;
  let lastConfidenceBreakdown: ConfidenceBreakdown | null = null;
  let lastSources: SourceItem[] = [];
  let lastSource: string | undefined;
  let lastReason: string | undefined;
  let lastMessageCount: number | undefined;
  let lastTimedOut: boolean | undefined;
  let hadError = false;
  let lastError: string | undefined;

  for (const chunk of chunks) {
    if (chunk.content) {
      fullContent += chunk.content;
    }

    if (chunk.done) {
      if (chunk.confidence !== undefined) {
        lastConfidence = chunk.confidence;
      }
      if (chunk.confidence_breakdown !== undefined) {
        lastConfidenceBreakdown = chunk.confidence_breakdown;
      }
      if (chunk.sources !== undefined) {
        lastSources = chunk.sources;
      }
      if (chunk.source !== undefined) {
        lastSource = chunk.source;
      }
      if (chunk.reason !== undefined) {
        lastReason = chunk.reason;
      }
      if (chunk.message_count !== undefined) {
        lastMessageCount = chunk.message_count;
      }
      if (chunk.timed_out !== undefined) {
        lastTimedOut = chunk.timed_out;
      }
    }
    if (chunk.error) {
      hadError = true;
      lastError = chunk.error;
    }
  }

  return {
    content: fullContent,
    confidence: lastConfidence,
    confidenceBreakdown: lastConfidenceBreakdown,
    sources: lastSources,
    source: lastSource,
    reason: lastReason,
    message_count: lastMessageCount,
    timed_out: lastTimedOut,
    hadError,
    error: lastError,
  };
}