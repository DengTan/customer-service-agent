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
}

/**
 * Parse SSE stream from a ReadableStream reader
 * 
 * @param reader - The stream reader
 * @param onChunk - Optional callback for each chunk
 * @returns Promise with parsed content, confidence, and sources
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
  onChunk?: (chunk: ParsedSSEChunk) => void
): Promise<SSEParseResult> {
  if (!reader) {
    return { content: '', confidence: null, confidenceBreakdown: null, sources: [] };
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let lastConfidence: number | null = null;
  let lastConfidenceBreakdown: ConfidenceBreakdown | null = null;
  let lastSources: SourceItem[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6)) as ParsedSSEChunk;
          
          if (parsed.content) {
            fullContent += parsed.content;
          }
          
          if (parsed.done) {
            if (parsed.confidence !== undefined) {
              lastConfidence = parsed.confidence;
            }
            if (parsed.confidence_breakdown !== undefined) {
              lastConfidenceBreakdown = parsed.confidence_breakdown;
            }
            if (parsed.sources !== undefined) {
              lastSources = parsed.sources;
            }
          }
          
          if (onChunk) {
            onChunk(parsed);
          }
        } catch (err) {
          logger.warn('SSE chunk parse failed', { chunk: line.substring(0, 100) });
        }
      }
    }
  }

  return {
    content: fullContent,
    confidence: lastConfidence,
    confidenceBreakdown: lastConfidenceBreakdown,
    sources: lastSources,
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
    }
  }

  return {
    content: fullContent,
    confidence: lastConfidence,
    confidenceBreakdown: lastConfidenceBreakdown,
    sources: lastSources,
  };
}
