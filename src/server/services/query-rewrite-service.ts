/**
 * QueryRewriteService — P2 Task 3
 *
 * Implements bounded LLM query rewriting for knowledge retrieval.
 *
 * Core contract:
 * - At most 1 rewrite per retrieval turn
 * - Only rewrites when accepted=0 AND real reranker is available
 * - Never rewrites skip/clarify decisions
 * - Validates rewritten query before re-retrieval
 */

import { logger } from '@/lib/logger';
import { AuxiliaryLLMService, AUX_LLM, type AuxiliaryLlmResult } from './auxiliary-llm-service';
import type { EvidenceBundle } from './retrieval-orchestrator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuxiliaryLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface RewriteDecision {
  action: 'skip' | 'rewrite' | 'no_rewrite' | 'empty_content' | 'timeout';
  rewrittenQuery?: string;
  reason: string;
  /** Whether a rewrite was attempted (even if it failed) */
  rewriteAttempted: boolean;
  /** Reason for rewrite failure */
  rewriteFailureReason?: string;
}

// ---------------------------------------------------------------------------
// Rewrite prompt template
// ---------------------------------------------------------------------------

const REWRITE_SYSTEM_PROMPT = `你是一个电商客服查询优化助手。你的任务是将用户的口语化问题改写为更精确的检索查询。

改写规则：
1. 保留用户提到的所有实体（商品名称、订单号、SKU、时间、否定词）
2. 保持用户的语言（中文/英文）
3. 不回答问题，只改写查询
4. 不添加用户未提供的信息
5. 使用关键词而非完整句子
6. 长度不超过200字符`;

const REWRITE_USER_PROMPT = `将以下用户问题改写为精确的检索查询：

{original_query}

历史对话（最近4条）：
{history}

要求：
- 输出一行JSON：{"rewritten_query": "改写后的查询"}
- 不回答问题，只改写
- 长度不超过200字符
- 保留所有关键实体和否定词`;

// ---------------------------------------------------------------------------
// QueryRewriteService
// ---------------------------------------------------------------------------

export class QueryRewriteService {
  private readonly auxLlm = new AuxiliaryLLMService();

  /**
   * Decide whether to attempt a query rewrite.
   *
   * Conditions:
   * - accepted.length === 0 (first search found no usable evidence)
   * - auxiliary LLM is configured
   * - reranker is NOT degraded (rewrite without real reranker cannot improve citation quality)
   */
  rewriteDecision(
    firstBundle: EvidenceBundle,
    auxLlmConfig: AuxiliaryLlmConfig | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _originalQuery: string,
  ): RewriteDecision {
    // Condition 1: Must have accepted candidates to skip rewrite
    if (firstBundle.accepted.length > 0) {
      return {
        action: 'skip',
        reason: 'has_accepted_candidates',
        rewriteAttempted: false,
      };
    }

    // Condition 2: Must have auxiliary LLM configured
    if (!auxLlmConfig) {
      return {
        action: 'no_rewrite',
        reason: 'no_auxiliary_llm_configured',
        rewriteAttempted: false,
      };
    }

    // Condition 3: Fail-closed — without real reranker, rewrite cannot improve citation quality
    if (firstBundle.trace.rerankDegraded) {
      return {
        action: 'no_rewrite',
        reason: 'reranker_degraded',
        rewriteAttempted: false,
      };
    }

    // All conditions met — caller should call rewriteQuery() to get the rewritten query
    return {
      action: 'rewrite',
      reason: 'no_accepted_candidates',
      rewriteAttempted: false, // not yet attempted
    };
  }

  /**
   * Perform the actual LLM-based query rewrite.
   * Returns the rewritten query string, or null if rewrite should not proceed.
   */
  async rewriteQuery(
    auxLlmConfig: AuxiliaryLlmConfig,
    originalQuery: string,
    recentMessages: Array<{ role: string; content: string }>,
  ): Promise<AuxiliaryLlmResult<{ rewritten_query: string }>> {
    const historyText = recentMessages
      .slice(-4)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const userPrompt = REWRITE_USER_PROMPT
      .replace('{original_query}', originalQuery)
      .replace('{history}', historyText || '(无历史对话)');

    const startTime = Date.now();

    const result = await this.auxLlm.completeJson<{ rewritten_query: string }>(
      auxLlmConfig.baseUrl,
      auxLlmConfig.apiKey,
      auxLlmConfig.model,
      [
        { role: 'system', content: REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        task: 'query_rewrite',
        timeoutMs: AUX_LLM.REWRITE_TIMEOUT_MS,
        validate: (data): data is { rewritten_query: string } => {
          if (typeof data !== 'object' || data === null) return false;
          const d = data as Record<string, unknown>;
          return typeof d.rewritten_query === 'string' && d.rewritten_query.length > 0;
        },
      },
    );

    const elapsed = Date.now() - startTime;

    if (!result.ok) {
      logger.agent.debug('[QueryRewrite] LLM rewrite failed', {
        task: 'query_rewrite',
        code: result.code,
        elapsedMs: elapsed,
      });
      return result as AuxiliaryLlmResult<{ rewritten_query: string }>;
    }

    // Validate and truncate the rewritten query
    let rewritten = result.data!.rewritten_query;
    rewritten = this.truncateQuery(rewritten);
    rewritten = this.stripInternalMarkers(rewritten);

    logger.agent.debug('[QueryRewrite] LLM rewrite succeeded', {
      task: 'query_rewrite',
      rewrittenLength: rewritten.length,
      elapsedMs: elapsed,
    });

    return {
      ok: true,
      data: { rewritten_query: rewritten },
      attempts: result.attempts,
      elapsedMs: result.elapsedMs,
    };
  }

  /**
   * Determine whether the rewritten query is meaningfully different from the original.
   * Returns false if the query is effectively the same (skip re-retrieval).
   */
  shouldReRetrieve(originalQuery: string, rewrittenQuery: string): boolean {
    const normalizedOriginal = this.normalizeForComparison(originalQuery);
    const normalizedRewritten = this.normalizeForComparison(rewrittenQuery);

    if (normalizedOriginal === normalizedRewritten) {
      return false;
    }

    // Also check if rewritten is a substring of original or vice versa (not useful)
    if (normalizedOriginal.length > 3 && normalizedRewritten.length > 3) {
      if (normalizedRewritten.includes(normalizedOriginal) || normalizedOriginal.includes(normalizedRewritten)) {
        // If one is a subset of the other, it's probably not a meaningful rewrite
        return false;
      }
    }

    return true;
  }

  /**
   * Normalize query strings for comparison:
   * - Trim whitespace
   * - Remove control characters
   * - Normalize unicode (use NFC form)
   * - Strip trailing punctuation
   */
  normalizeForComparison(query: string): string {
    return query
      .trim()
      // Remove control characters
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Normalize unicode
      .normalize('NFC')
      // Strip trailing punctuation (but keep Chinese full stop)
      .replace(/[.。,，!！?？;；:：]+$/g, '')
      .trim();
  }

  /**
   * Truncate query to maximum 200 characters.
   */
  truncateQuery(query: string): string {
    if (query.length <= 200) {
      return query;
    }
    // Truncate at word boundary if possible
    const truncated = query.slice(0, 200);
    const lastSpace = truncated.lastIndexOf(' ');
    const punctuationChars = ',，。.。!！?？;；:：';
    let lastPunctuation = -1;
    for (const ch of punctuationChars) {
      const idx = truncated.lastIndexOf(ch);
      if (idx > lastPunctuation) lastPunctuation = idx;
    }
    const cutoff = Math.max(lastSpace, lastPunctuation);
    return cutoff > 150 ? truncated.slice(0, cutoff) : truncated.slice(0, 200);
  }

  /**
   * Strip internal markers that may have been injected by previous processing.
   */
  stripInternalMarkers(query: string): string {
    // Remove tool call markers
    return query
      .replace(/\[TOOL_CALL\].*?\[\/TOOL_CALL\]/g, '')
      // Remove confidence tags
      .replace(/\[CONF:[0-9]*\.?[0-9]+\]/g, '')
      .trim();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: QueryRewriteService | null = null;

export function getQueryRewriteService(): QueryRewriteService {
  if (!_instance) {
    _instance = new QueryRewriteService();
  }
  return _instance;
}

export function resetQueryRewriteService(): void {
  _instance = null;
}
