/**
 * ClaimSupportVerifier — P2 Task 4
 *
 * Verifies that LLM-generated factual claims are supported by retrieved evidence chunks.
 *
 * Core contract (fail-closed):
 * - Verifier can ONLY narrow the citation list — never expand it
 * - Any invalid JSON, timeout, unknown IDs, or verification failure → all knowledge citations removed
 * - Only `factual=true` AND `verdict=entailed` AND `confidence >= 0.5` relationships are kept
 * - Source deduplication by chunk_id (same source supporting multiple claims → kept once)
 */

import { logger } from '@/lib/logger';
import { AuxiliaryLLMService, AUX_LLM } from './auxiliary-llm-service';
import type { AuxiliaryLlmResult } from './auxiliary-llm-service';
import type { CitationItem } from './retrieval-orchestrator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaimVerificationInput {
  response: string;
  citations: CitationItem[];
  auxLlmConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

export interface ClaimVerificationResult {
  ok: boolean;
  /** Final verified sources (subset of input citations) */
  sources: CitationItem[];
  /** Claims extracted from response */
  claims: Array<{
    claimId: string;
    text: string;
    factual: boolean;
  }>;
  /** Supported claim count */
  supportedClaimCount: number;
  /** Error code if failed */
  code?: 'timeout' | 'invalid_json' | 'invalid_response' | 'provider_error' | 'empty_content';
  /** Error message */
  message?: string;
  /** Verification elapsed time */
  elapsedMs?: number;
}

export interface ClaimVerificationSummary {
  result: ClaimVerificationResult;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Internal LLM schemas
// ---------------------------------------------------------------------------

interface LLMClaim {
  claimId: string;
  text: string;
  /** Whether this is a factual claim (vs. opinion/greeting/etc.) */
  factual: boolean;
}

interface LLMSupport {
  claimId: string;
  sourceId: string;
  verdict: 'entailed' | 'contradicted' | 'unknown';
  confidence: number; // 0-1
  reason: string;
}

interface LLMVerifyOutput {
  claims: LLMClaim[];
  support: LLMSupport[];
}

const VERIFY_SYSTEM_PROMPT = `你是一个客服回答质量校验助手。给定用户问题和AI回答，识别回答中的关键事实声明，并判断每个声明是否能被提供的参考资料支持。

定义：
- 事实声明：可验证的具体陈述（数字、时间、政策、条件等）
- 非事实：问候、感谢、要求用户提供信息、主观意见等

判断标准：
- entailed: 资料明确支持该声明
- contradicted: 资料明确否定该声明
- unknown: 资料未涉及该声明

注意：
- 只提取回答中的关键事实，不逐字匹配
- 对于模糊或概括性描述使用 unknown
- 对于明显错误陈述使用 contradicted`;

const VERIFY_USER_PROMPT = `用户问题：{user_question}

AI回答：{ai_response}

参考资料（每个来源用[S{index}]标记）：
{sources_context}

要求：
1. 从AI回答中提取关键事实声明（最多10条）
2. 判断每条声明是否被资料支持
3. 输出一行JSON：{"claims": [{"claimId": "C1", "text": "声明内容", "factual": true/false}], "support": [{"claimId": "C1", "sourceId": "S1", "verdict": "entailed/contradicted/unknown", "confidence": 0.0-1.0, "reason": "判断理由"}]}`;

// ---------------------------------------------------------------------------
// ClaimSupportVerifier
// ---------------------------------------------------------------------------

export class ClaimSupportVerifier {
  private readonly auxLlm = new AuxiliaryLLMService();

  /**
   * Verify that LLM-generated factual claims are supported by retrieved evidence.
   *
   * @param response - The LLM's final response text
   * @param citations - Canonical citations from the retrieval orchestrator
   * @param auxLlmConfig - Auxiliary LLM configuration
   * @returns Verification result with filtered citations
   */
  async verify(
    response: string,
    citations: CitationItem[],
    auxLlmConfig: { baseUrl: string; apiKey: string; model: string },
  ): Promise<ClaimVerificationResult> {
    const startTime = Date.now();

    // Guard: no citations → nothing to verify → empty result
    if (citations.length === 0) {
      return {
        ok: true,
        sources: [],
        claims: [],
        supportedClaimCount: 0,
        elapsedMs: Date.now() - startTime,
      };
    }

    // Guard: empty response → no claims can be extracted
    if (!response || response.trim().length === 0) {
      logger.agent.debug('[ClaimVerifier] Empty response, returning empty sources');
      return {
        ok: true,
        sources: [],
        claims: [],
        supportedClaimCount: 0,
        elapsedMs: Date.now() - startTime,
      };
    }

    // Build source context with stable internal IDs
    const sourceIdMap = new Map<string, CitationItem>();
    const sourcesContext = citations
      .map((c, idx) => {
        const sourceId = `S${idx + 1}`;
        sourceIdMap.set(sourceId, c);
        return `[${sourceId}] ${c.content}`;
      })
      .join('\n\n');

    const userPrompt = VERIFY_USER_PROMPT
      .replace('{user_question}', '(从对话历史中推断)')
      .replace('{ai_response}', response)
      .replace('{sources_context}', sourcesContext);

    const result = await this.auxLlm.completeJson<LLMVerifyOutput>(
      auxLlmConfig.baseUrl,
      auxLlmConfig.apiKey,
      auxLlmConfig.model,
      [
        { role: 'system', content: VERIFY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        task: 'claim_verification',
        timeoutMs: AUX_LLM.VERIFY_TIMEOUT_MS,
        validate: (data): data is LLMVerifyOutput => this.validateLlmOutput(data, response, sourceIdMap),
      },
    );

    const elapsedMs = Date.now() - startTime;

    if (!result.ok) {
      const code = this.classifyError(result);
      logger.agent.debug('[ClaimVerifier] Verification failed', { code, elapsedMs });
      return {
        ok: false,
        sources: [], // fail-closed: no citations on error
        claims: [],
        supportedClaimCount: 0,
        code,
        elapsedMs,
      };
    }

    // Validate output (this also runs inside completeJson's validator, but we check again for safety)
    const validationError = this.validateLlmOutput(result.data, response, sourceIdMap);
    if (!validationError) {
      return {
        ok: false,
        sources: [],
        claims: [],
        supportedClaimCount: 0,
        code: 'invalid_response',
        message: 'LLM output failed validation',
        elapsedMs,
      };
    }

    // Process verified support relations
    const supportedSourceIds = new Set<string>();
    let supportedClaimCount = 0;

    for (const s of result.data.support) {
      // Must be: entailed + confidence >= threshold + factual=true
      const claim = result.data.claims.find(c => c.claimId === s.claimId);
      if (!claim) continue; // already handled by validation

      if (s.verdict === 'entailed' && s.confidence >= AUX_LLM.VERIFY_MIN_CONFIDENCE && claim.factual) {
        supportedSourceIds.add(s.sourceId);
        supportedClaimCount++;
      }
    }

    // Build final citation list — ONLY keep sources that have at least one entailed claim
    const verifiedCitations = citations.filter((_, idx) => {
      const sourceId = `S${idx + 1}`;
      return supportedSourceIds.has(sourceId);
    });

    logger.agent.debug('[ClaimVerifier] Verification complete', {
      inputCitations: citations.length,
      outputCitations: verifiedCitations.length,
      supportedClaims: supportedClaimCount,
      elapsedMs,
    });

    return {
      ok: true,
      sources: verifiedCitations,
      claims: result.data.claims,
      supportedClaimCount,
      elapsedMs,
    };
  }

  /**
   * Validate the LLM output structure and content.
   * Returns null if validation fails (triggering fail-closed).
   */
  private validateLlmOutput(
    data: unknown,
    response: string,
    sourceIdMap: Map<string, CitationItem>,
  ): data is LLMVerifyOutput {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;

    if (!Array.isArray(d.claims)) return false;
    if (!Array.isArray(d.support)) return false;

    const claimIds = new Set<string>();
    const sourceIds = new Set<string>(sourceIdMap.keys());

    // Validate each claim
    for (const claim of d.claims) {
      if (typeof claim !== 'object' || claim === null) return false;
      const c = claim as Record<string, unknown>;
      if (typeof c.claimId !== 'string' || !c.claimId) return false;
      if (typeof c.text !== 'string' || !c.text) return false;
      if (typeof c.factual !== 'boolean') return false;

      // Claim text must be an exact substring of the response (verbatim extraction)
      if (!response.includes(c.text)) {
        logger.agent.warn('[ClaimVerifier] Fabricated claim text rejected', {
          claimId: c.claimId,
          text: c.text,
          responseSnippet: response.slice(0, 100),
        });
        return false; // fabricated claim → fail closed
      }

      claimIds.add(c.claimId as string);
    }

    // Validate each support relation
    for (const support of d.support) {
      if (typeof support !== 'object' || support === null) return false;
      const s = support as Record<string, unknown>;

      // Check claimId exists
      if (!claimIds.has(s.claimId as string)) {
        logger.agent.warn('[ClaimVerifier] Unknown claim ID in support', { claimId: s.claimId });
        return false;
      }

      // Check sourceId exists in our map
      if (!sourceIds.has(s.sourceId as string)) {
        logger.agent.warn('[ClaimVerifier] Unknown source ID in support', { sourceId: s.sourceId });
        return false;
      }

      // Check verdict is valid
      if (!['entailed', 'contradicted', 'unknown'].includes(s.verdict as string)) {
        return false;
      }

      // Check confidence is a number in [0, 1]
      if (typeof s.confidence !== 'number' || s.confidence < 0 || s.confidence > 1) {
        return false;
      }

      sourceIds.add(s.sourceId as string);
    }

    return true;
  }

  /**
   * Classify auxiliary LLM errors into verification error codes.
   */
  private classifyError(result: AuxiliaryLlmResult<LLMVerifyOutput>): ClaimVerificationResult['code'] {
    if (result.ok) {
      return 'invalid_response'; // shouldn't happen
    }
    const code = result.code;
    if (code === 'timeout') return 'timeout';
    if (code === 'empty_content') return 'empty_content';
    if (code === 'invalid_json') return 'invalid_json';
    if (code === 'validator_rejected') return 'invalid_response';
    if (code === 'network_error') return 'provider_error';
    return 'provider_error';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ClaimSupportVerifier | null = null;

export function getClaimSupportVerifier(): ClaimSupportVerifier {
  if (!_instance) {
    _instance = new ClaimSupportVerifier();
  }
  return _instance;
}

export function resetClaimSupportVerifier(): void {
  _instance = null;
}
