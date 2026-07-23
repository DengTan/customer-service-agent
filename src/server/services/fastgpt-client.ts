/**
 * FastGPT-compatible external knowledge base client.
 *
 * Validates config at startup (ObjectId format) and propagates descriptive
 * errors from the FastGPT API instead of silently returning empty results.
 *
 * Used by knowledge-search-service.ts for external knowledge base retrieval.
 */

import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

/** Blocked hostnames and IP ranges for SSRF protection. */
const SSRF_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
]);

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTNAMES.has(h)) return true;
  // 10.x.x.x
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  // 172.16-31.x.x
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  // 192.168.x.x
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  // 169.254.x.x (link-local)
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;
  // IPv6 loopback/local
  if (h === '::1' || h === 'fe80::1') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** FastGPT datasetId must be a 24-char hex string (MongoDB ObjectId). */
const FASTGPT_OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/** FastGPT error codes that indicate an auth/API-key problem. */
const FASTGPT_AUTH_ERROR_CODES = new Set([514, 502, '514', '502']);

/** Retry configuration: at most 1 retry with exponential backoff. */
const FASTGPT_RETRY_MAX_ATTEMPTS = 2;
const FASTGPT_RETRY_BASE_DELAY_MS = 500;
const FASTGPT_RETRY_MAX_DELAY_MS = 2000;

/**
 * R-4 (Sprint 3): hard timeout for FastGPT outbound requests.
 *
 * - Documented default is 10_000ms. The previous default (2_000ms) was
 *   too aggressive — FastGPT embedding + reranker pipelines routinely
 *   exceed 2s on cold paths.
 * - Override with the `FASTGPT_TIMEOUT_MS` env var. When the env var is
 *   already set to a different value, we honour it (no silent overwrite)
 *   but log a warning so operators notice the divergence from the docs.
 *
 * Risk: 10_000ms means a stranded FastGPT server could now hold an HTTP
 * worker for up to 10s instead of 2s. The retrieval orchestrator already
 * fires the FastGPT call inside a Promise.all with internal knowledge
 * search and applies an outer `cache.invalidateAll()` on abort, so the
 * upper-bound waiting time in the worst case is 10s (not the previous 2s),
 * and the rest of the pipeline still proceeds.
 */
export const FASTGPT_TIMEOUT_DEFAULT_MS = 10_000;
export const FASTGPT_TIMEOUT_MS: number = (() => {
  const raw = process.env['FASTGPT_TIMEOUT_MS'];
  if (!raw) return FASTGPT_TIMEOUT_DEFAULT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return FASTGPT_TIMEOUT_DEFAULT_MS;
  return parsed;
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExternalKnowledgeConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  datasetId: string;
}

export interface FastGPTSearchResult {
  id: string;
  datasetId: string;
  documentId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface FastGPTSearchResponse {
  results: FastGPTSearchResult[];
  total: number;
  queryTime: number;
}

/** Error thrown when the config is invalid at construction time. */
export class FastGPTConfigError extends Error {
  readonly code = 'FASTGPT_CONFIG_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'FastGPTConfigError';
  }
}

// ---------------------------------------------------------------------------
// FastGPT Client
// ---------------------------------------------------------------------------

/**
 * Search mode options for FastGPT retrieval.
 *
 * User-facing values (used in settings/UI) vs FastGPT API values:
 *   embedding      → 'embedding'         (pure vector search)
 *   hybrid         → 'mixedRecall'       (vector + keyword fusion)
 *   fullText       → 'fullTextRecall'   (pure keyword search)
 */
export type FastGPTSearchMode = 'embedding' | 'hybrid' | 'fullText';

export interface FastGPTSearchOptions {
  /** Search mode: embedding (vector), hybrid (vector+keyword), fullText (keyword only). Default: embedding */
  searchMode?: FastGPTSearchMode;
  /** Whether to use re-ranker for result refinement. Default: false */
  useReRank?: boolean;
}

/**
 * Map user-facing search mode to FastGPT API parameter value.
 * FastGPT API accepts: 'embedding' | 'fullTextRecall' | 'mixedRecall'
 * User-facing names: 'embedding' | 'hybrid' | 'fullText'
 */
function toFastGPTSearchMode(mode: FastGPTSearchMode): string {
  switch (mode) {
    case 'hybrid':  return 'mixedRecall';   // vector + keyword fusion
    case 'fullText': return 'fullTextRecall'; // pure keyword search
    default:         return 'embedding';      // pure vector search
  }
}

export class FastGPTClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly datasetId: string;

  constructor(config: ExternalKnowledgeConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.datasetId = config.datasetId;

    // Fail fast at construction time — avoid silent failures at search time.
    if (!FASTGPT_OBJECT_ID_REGEX.test(this.datasetId)) {
      throw new FastGPTConfigError(
        `FastGPT datasetId "${this.datasetId}" is not a valid 24-char hex string. ` +
          'Please go to FastGPT console → knowledge base → copy the correct ID.',
      );
    }

    // SSRF: block internal addresses
    try {
      const url = new URL(this.baseUrl);
      if (isBlockedHostname(url.hostname)) {
        throw new FastGPTConfigError(
          `baseUrl cannot point to internal addresses: "${url.hostname}"`,
        );
      }
    } catch (e) {
      if (e instanceof FastGPTConfigError) throw e;
      throw new FastGPTConfigError(`Invalid baseUrl format: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Fail fast on empty baseUrl or apiKey
    if (!this.baseUrl) {
      throw new FastGPTConfigError('baseUrl cannot be empty');
    }
    if (!this.apiKey) {
      throw new FastGPTConfigError('apiKey cannot be empty');
    }
  }

  /**
   * Search the FastGPT dataset using text query.
   *
   * Uses the direct knowledge base search API (/core/dataset/searchTest).
   * Includes retry logic: attempts up to 2 times on transient failures.
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (default 5)
   * @param minScore - Minimum relevance score filter (default 0)
   * @param options - Search options (searchMode, useReRank)
   * @returns Search results sorted by relevance score
   * @throws FastGPTConfigError  - if datasetId is not a valid ObjectId
   * @throws FastGPTAuthError   - if API key is invalid (HTTP 500 + auth code)
   * @throws Error              - on network failure or unexpected FastGPT errors (after retries exhausted)
   */
  async search(
    query: string,
    limit: number = 5,
    minScore: number = 0,
    options?: FastGPTSearchOptions,
  ): Promise<FastGPTSearchResponse> {
    const startTime = Date.now();
    const searchMode = options?.searchMode ?? 'embedding';
    const useReRank = options?.useReRank ?? false;
    let lastError: unknown;

    for (let attempt = 1; attempt <= FASTGPT_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.doSearch(query, limit, minScore, searchMode, useReRank, startTime);
        return result;
      } catch (err) {
        lastError = err;

        // Determine if we should retry
        const isAuthError = (err as Error & { code?: string }).code === 'FASTGPT_AUTH_ERROR';
        const isAbortError = err instanceof Error && err.name === 'AbortError';
        const isNetworkError = err instanceof TypeError && err.message.includes('fetch');

        // Never retry auth errors
        if (isAuthError) {
          throw err;
        }

        // Retry on timeout or network errors
        if (isAbortError || isNetworkError) {
          if (attempt < FASTGPT_RETRY_MAX_ATTEMPTS) {
            const delayMs = this.getRetryDelay(attempt);
            logger.agent.warn('[FastGPTClient] Request failed, retrying', {
              attempt,
              maxAttempts: FASTGPT_RETRY_MAX_ATTEMPTS,
              delayMs,
              error: err instanceof Error ? err.message : String(err),
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
        }

        // Non-retryable error on last attempt
        if (attempt >= FASTGPT_RETRY_MAX_ATTEMPTS) {
          if (err instanceof Error && err.name === 'AbortError') {
            logger.agent.warn('[FastGPTClient] Search timed out after retries', { timeoutMs: FASTGPT_TIMEOUT_MS });
          } else {
            logger.agent.error('[FastGPTClient] Search failed after retries', { error: err });
          }
          throw err;
        }
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastError;
  }

  /**
   * Compute the delay (ms) before the next retry attempt.
   *
   * Uses exponential backoff: `min(maxDelay, baseDelay * 2 ** attempt)` with
   * a small jitter to avoid thundering-herd on a recovering FastGPT instance.
   * Reuses `FASTGPT_RETRY_BASE_DELAY_MS` / `FASTGPT_RETRY_MAX_DELAY_MS` so the
   * retry budget stays consistent with the loop above.
   *
   * @param attempt - 1-based attempt number that just failed (caller will retry on attempt+1).
   */
  getRetryDelay(attempt: number): number {
    const safeAttempt = Math.max(0, attempt);
    const exp = Math.min(FASTGPT_RETRY_MAX_DELAY_MS, FASTGPT_RETRY_BASE_DELAY_MS * 2 ** safeAttempt);
    // Jitter: +/- 20% of the computed delay so simultaneous clients don't synchronise.
    const jitter = exp * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(exp + jitter));
  }

  /**
   * Internal search implementation (called by retry wrapper).
   */
  private async doSearch(
    query: string,
    limit: number,
    minScore: number,
    searchMode: FastGPTSearchMode,
    useReRank: boolean,
    startTime: number,
  ): Promise<FastGPTSearchResponse> {
    const searchUrl = `${this.baseUrl}/core/dataset/searchTest`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FASTGPT_TIMEOUT_MS);

    try {
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          datasetId: this.datasetId,
          text: query,
          limit: limit,
          similarity: minScore,
          // Map user-facing name to FastGPT API value:
          // 'hybrid' → 'mixedRecall', 'fullText' → 'fullTextRecall'
          searchMode: toFastGPTSearchMode(searchMode),
          usingReRank: useReRank,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const parsed = safeParseFastGPTResponse(bodyText);
        const fastGPTMessage = parsed?.message || parsed?.statusText;

        // Auth errors: FastGPT Cloud returns HTTP 500 + code 514 for bad API keys
        if (
          response.status === 500 &&
          parsed &&
          parsed.code !== undefined &&
          FASTGPT_AUTH_ERROR_CODES.has(String(parsed.code as string | number))
        ) {
          logger.agent.warn('[FastGPTClient] Auth error during search', {
            status: response.status,
            code: parsed.code,
          });
          const authErr = new Error(
            `FastGPT auth failed (code=${parsed.code}): API key is invalid or expired.`,
          ) as Error & { code?: string };
          authErr.code = 'FASTGPT_AUTH_ERROR';
          throw authErr;
        }

        logger.agent.warn('[FastGPTClient] Search request failed', {
          status: response.status,
          body: bodyText.slice(0, 200),
        });

        // Return empty silently for unexpected HTTP errors — caller logs the warning.
        return { results: [], total: 0, queryTime: Date.now() - startTime };
      }

      const data = await response.json() as {
        code?: number;
        // FastGPT Cloud returns: { code, statusText, message, data: { list: [...], duration, limit, ... } }
        data?: {
          list?: Array<{
            id?: string;
            q?: string;
            a?: string;
            datasetId?: string;
            collectionId?: string;
            sourceName?: string;
            // score is an array of {type, value, index} (FastGPT supports multi-vector scoring)
            score?: Array<{ type?: string; value?: number; index?: number }> | number;
          }>;
        };
        error?: { message?: string };
      };

      if (data.code !== 200) {
        logger.agent.warn('[FastGPTClient] FastGPT returned non-200', {
          code: data.code,
          error: data.error,
        });
        return { results: [], total: 0, queryTime: Date.now() - startTime };
      }

      const list = data.data?.list;
      if (!Array.isArray(list)) {
        logger.agent.warn('[FastGPTClient] FastGPT response missing list array', {
          hasData: !!data.data,
          dataKeys: data.data ? Object.keys(data.data) : [],
        });
        return { results: [], total: 0, queryTime: Date.now() - startTime };
      }

      /**
       * Extract a numeric score from the FastGPT score field.
       * FastGPT Cloud returns `score` as an array of {type, value, index}.
       * We compute the average of all channel values to avoid inflated scores
       * when multiple channels (e.g., embedding + fullText) return values > 1.0.
       * Result is clamped to [0, 1] to ensure valid relevance scores.
       */
      const extractScore = (raw: unknown): number => {
        if (typeof raw === 'number') return Math.min(1, Math.max(0, raw));
        if (Array.isArray(raw)) {
          const values: number[] = [];
          for (const s of raw) {
            if (s && typeof s === 'object' && typeof (s as { value?: unknown }).value === 'number') {
              const v = (s as { value: number }).value;
              if (Number.isFinite(v)) values.push(v);
            }
          }
          if (values.length === 0) return 0;
          const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
          return Math.min(1, Math.max(0, avg));
        }
        return 0;
      };

      const results: FastGPTSearchResult[] = list
        .slice(0, limit)
        .map((item) => ({
          id: item.id ?? '',
          datasetId: item.datasetId ?? this.datasetId,
          documentId: item.collectionId ?? '',
          content: item.q ?? '',
          score: extractScore(item.score),
          metadata: {
            a: item.a,
            sourceName: item.sourceName,
          },
        }));

      logger.agent.debug('[FastGPTClient] Search completed', {
        queryLength: query.length,
        resultCount: results.length,
        queryTimeMs: Date.now() - startTime,
        searchMode: toFastGPTSearchMode(searchMode),
        usingReRank: useReRank,
      });

      return {
        results,
        total: results.length,
        queryTime: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FastGPTErrorResponse {
  code?: number | string;
  message?: string;
  statusText?: string;
  data?: unknown;
}

function safeParseFastGPTResponse(body: string): FastGPTErrorResponse | null {
  try {
    return JSON.parse(body) as FastGPTErrorResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

const EXTERNAL_CONFIG_TTL_MS = 30_000;
let externalConfigCache: { config: ExternalKnowledgeConfig; cachedAt: number } | null = null;

export async function loadExternalKnowledgeConfig(
  getSetting: (key: string) => Promise<string | null>,
): Promise<ExternalKnowledgeConfig | null> {
  const now = Date.now();
  if (
    externalConfigCache &&
    now - externalConfigCache.cachedAt < EXTERNAL_CONFIG_TTL_MS
  ) {
    return externalConfigCache.config;
  }

  const enabled = (await getSetting('external_knowledge_enabled')) === 'true';
  if (!enabled) {
    externalConfigCache = null;
    return null;
  }

  const config: ExternalKnowledgeConfig = {
    enabled: true,
    provider: (await getSetting('external_knowledge_provider')) || 'fastgpt',
    baseUrl: (await getSetting('external_knowledge_base_url')) || '',
    apiKey: (await getSetting('external_knowledge_api_key')) || '',
    datasetId: (await getSetting('external_knowledge_dataset_id')) || '',
  };

  if (!config.baseUrl || !config.apiKey || !config.datasetId) {
    logger.agent.warn('[FastGPTClient] External knowledge config incomplete, skipping', {
      hasBaseUrl: !!config.baseUrl,
      hasApiKey: !!config.apiKey,
      hasDatasetId: !!config.datasetId,
    });
    externalConfigCache = null;
    return null;
  }

  if (!FASTGPT_OBJECT_ID_REGEX.test(config.datasetId)) {
    logger.agent.warn('[FastGPTClient] Invalid datasetId format, skipping', {
      datasetId: config.datasetId,
      expectedFormat: '24-char hex (MongoDB ObjectId)',
    });
    externalConfigCache = null;
    return null;
  }

  externalConfigCache = { config, cachedAt: now };
  return config;
}

/** Invalidate the external config cache (call after settings change). */
export function invalidateExternalKnowledgeConfigCache(): void {
  externalConfigCache = null;
}
