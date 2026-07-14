import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parseJsonBody, apiSuccess, apiError, HttpStatus, getAuthenticatedUserId, extractUserRole } from '@/lib/api-utils';
import { LLMStreamingService } from '@/server/services/llm-streaming-service';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import { logger } from '@/lib/logger';
import { SettingsService } from '@/server/services/settings-service';
import { type KnowledgeSearchResult } from '@/server/services/knowledge-search-service';
import { HTTP } from '@/lib/constants';
import { botConfigRepository } from '@/server/repositories/bot-config-repository';
import { detectHandoffIntent } from '@/lib/confidence-calculator';
import { parseSSEStream } from '@/lib/sse-parser';
import { RetrievalOrchestrator } from '@/server/services/retrieval-orchestrator';

/**
 * Check if user has permission to access a simulation conversation
 * - Admin can access all
 * - Creator (created_by) can access their own
 * - null created_by (legacy) only accessible by admin
 */
function canAccessConversation(
  simulation: { created_by?: string | null },
  userId: string | null,
  role: string | null
): boolean {
  // Admin can access all
  if (role === 'admin') return true;

  // Must be logged in to access
  if (!userId) return false;

  // If created_by is null (legacy data), only admin can access
  if (simulation.created_by === null || simulation.created_by === undefined) {
    return false;
  }

  // Creator can access their own
  return simulation.created_by === userId;
}

// GET /api/simulations/[id]/messages - Get messages
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);

  const simulation = await simulationRepository.getById(id);

  if (!simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (!canAccessConversation(simulation, userId, role)) {
    return apiError('无权限查看此会话', { status: HttpStatus.FORBIDDEN });
  }

  const messages = await simulationRepository.listMessages(id);
  return apiSuccess({ messages });
});

// POST /api/simulations/[id]/messages - Send a message and get streaming response
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: conversationId } = await params;

  // Permission check: require login and access permission
  const userId = getAuthenticatedUserId(request);
  const role = extractUserRole(request);
  if (!userId) {
    return apiError('请先登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const simulation = await simulationRepository.getById(conversationId);
  if (!simulation) {
    return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
  }

  if (!canAccessConversation(simulation, userId, role)) {
    return apiError('无权限向此会话发送消息', { status: HttpStatus.FORBIDDEN });
  }

  const { data: body, error: parseError } = await parseJsonBody<{ content: string; bot_id?: string }>(request);
  if (parseError) return parseError;

  const userMessage = body?.content;
  if (!userMessage || typeof userMessage !== 'string') {
    return apiError('消息内容不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  // P0: Get bot configuration - prioritize request bot_id, fallback to conversation's bot_id
  // P2: Validate bot exists and log warning if not found
  const requestedBotId = body?.bot_id || simulation.bot_id;
  let systemPrompt = '';
  if (requestedBotId) {
    const bot = await botConfigRepository.findById(requestedBotId);
    if (bot && bot.system_prompt) {
      systemPrompt = bot.system_prompt;
      logger.info('[Simulation] Using bot system prompt', { botId: requestedBotId, botName: bot.name, source: body?.bot_id ? 'request' : 'conversation' });

      // P0: Sync bot_name if changed
      if (bot.name && simulation.bot_name !== bot.name) {
        simulationRepository.updateBotName(conversationId, bot.name).catch((err) => {
          logger.warn('[Simulation] Failed to sync bot name', { conversationId, botId: requestedBotId, error: err });
        });
      }
    } else {
      // P2: Bot not found or has no system_prompt
      logger.warn('[Simulation] Bot not found or has no system prompt', { botId: requestedBotId, found: !!bot });
    }
  }

  // P1-2: Message length limit
  if (userMessage.length > HTTP.MAX_MESSAGE_LENGTH) {
    return apiError(`消息内容不能超过 ${HTTP.MAX_MESSAGE_LENGTH} 个字符`, {
      status: HttpStatus.BAD_REQUEST,
      code: 'MESSAGE_TOO_LONG',
    });
  }

  // Get existing messages
  const existingMessages = await simulationRepository.listMessages(conversationId);

  // Add user message (using crypto.randomUUID)
  const userMsg = await simulationRepository.createMessage({
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role: 'user',
    content: userMessage,
  });

  // Load settings for system_prompt fallback (通用模式 fallback 到系统设置)
  const settingsService = new SettingsService();
  const appSettings = await settingsService.getSettingsMap();

  // Fallback: if no bot system_prompt, use system settings system_prompt
  if (!systemPrompt && appSettings.system_prompt) {
    systemPrompt = appSettings.system_prompt;
    logger.info('[Simulation] Using system settings system prompt (generic mode)');
  }

  // P0: Validate system prompt exists - user must have either bot or system settings configured
  if (!systemPrompt) {
    return apiError('请先在 Bot 配置或系统设置中配置系统提示词', {
      status: HttpStatus.BAD_REQUEST,
      code: 'NO_SYSTEM_PROMPT',
    });
  }

  // P0: Use shared RetrievalOrchestrator — single gate + retrieval + evidence contract
  // This replaces the old parallel search + raw source merge pattern.
  // The orchestrator applies query gating (SKIP/RETRIEVE/CLARIFY) and returns graded evidence.
  const orchestrator = new RetrievalOrchestrator();
  const recentMessages = existingMessages
    .slice(-10)
    .map(m => ({ role: m.role as string, content: m.content as string }));

  const retrievalResult = await orchestrator.retrieve(userMessage, recentMessages, { useHybrid: true });
  const { evidence: evidenceBundle } = retrievalResult;

  // Normalize orchestrator output for downstream LLM context injection.
  // We keep the legacy { knowledgeContext, productContext, sizeChartContext } shape
  // so LLMStreamingService and confidence calculation are unchanged in behavior,
  // but we use orchestrator-graded context, not raw knowledge search results.
  const knowledgeContextForLLM: KnowledgeSearchResult = retrievalResult.knowledgeContext
    ? {
        context: retrievalResult.knowledgeContext.context,
        sources: retrievalResult.knowledgeContext.knowledgeSources,
        confidence: retrievalResult.knowledgeContext.confidence,
        images: retrievalResult.knowledgeContext.images,
      }
    : { context: '', sources: [], confidence: 0, images: [] };
  const productContextForLLM = retrievalResult.productContext?.productContext ?? '';
  const sizeChartContextForLLM = retrievalResult.sizeChartContext?.sizeChartContext ?? '';
  const orchestratorCitations = evidenceBundle.citations;

  // Check auto-reply first
  const autoReplyService = new AutoReplyService();
  const autoReply = await autoReplyService.matchReply(userMessage);

  // Prepare stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let responseText = '';

        // If auto-reply matched, return it directly
        if (autoReply) {
          responseText = autoReply.content;
          // P0: Auto-reply sources must NOT include knowledge sources.
          // Auto-reply is a deterministic content response — the KB did not contribute
          // to the answer. Previously the route merged knowledgeResult.sources into
          // auto-reply messages, which caused "1" to surface refund KB as citation.
          const assistantMsg = await simulationRepository.createMessage({
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            role: 'assistant',
            content: responseText,
            sources: [{ type: 'auto_reply', keyword: autoReply.rule.keyword }],
            confidence: 1.0,
            confidence_breakdown: { knowledge_score: 0, tool_score: 0, llm_self_score: 1.0, sub_agent_score: 0, handoff_intent: false, no_support: false, final: 1.0 },
          });

          // Get updated message count for frontend (graceful degradation: if count fails, omit the field)
          let autoReplyMessageCount: number | undefined;
          try {
            autoReplyMessageCount = await simulationRepository.safeCountMessages(conversationId);
          } catch (countErr) {
            logger.api.warn('[Simulation Messages] Auto-reply count failed', {
              countErr,
              simulationId: conversationId,
            });
          }

          // Stream the response
          for (const char of responseText) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: char })}\n`));
            await new Promise(resolve => setTimeout(resolve, 15));
          }
          const donePayload: Record<string, unknown> = {
            done: true,
            sources: assistantMsg.sources ?? null,
            confidence: assistantMsg.confidence ?? 1.0,
            source: 'auto_reply',
            reason: '匹配自动回复',
          };
          if (autoReplyMessageCount !== undefined) {
            donePayload.message_count = autoReplyMessageCount;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n`));
          controller.close();
          return;
        }

        // P0-1: Use bot's system prompt if provided
        const effectiveSystemPrompt = systemPrompt;

        // Build conversation history for context (include newly added user message)
        const allMessages = [...existingMessages, userMsg];
        const chatHistory = allMessages
          .filter(m => m.role !== 'system')
          .slice(-20) // Limit to last 20 messages
          .map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

        // Initialize LLM streaming service
        const llmStreamingService = new LLMStreamingService();

        // Load LLM provider configuration if set
        let llmProviderConfig: {
          providerId?: string;
          providerBaseUrl?: string;
          providerApiKey?: string;
          providerType?: 'coze' | 'openai_compatible' | 'anthropic' | 'custom';
          defaultModel?: string;
        } = {};

        const llmProviderId = appSettings.llm_provider_id;
        if (llmProviderId && llmProviderId !== 'coze') {
          try {
            const { LlmProviderService } = await import('@/server/services/llm-provider-service');
            const llmService = new LlmProviderService();

            // First try UUID lookup, then fall back to name lookup
            let provider = await llmService.getProvider(llmProviderId);
            if (!provider) {
              provider = await llmService.getProviderByName(llmProviderId);
            }
            if (!provider) {
              provider = await llmService.getProviderByNameWithDecryptedKey(llmProviderId);
            }

            if (provider && provider.is_enabled) {
              // Get decrypted API key for actual API calls
              const providerWithKey = await llmService.getProviderByNameWithDecryptedKey(provider.name);
              llmProviderConfig = {
                providerId: provider.id,
                providerBaseUrl: provider.base_url,
                providerApiKey: providerWithKey?.api_key || provider.api_key || '',
                providerType: provider.api_type as 'openai_compatible' | 'anthropic' | 'custom',
                defaultModel: provider.default_model || undefined,
              };
              logger.api.info('Using extended LLM provider', {
                providerId: provider.id,
                name: provider.name,
                baseUrl: provider.base_url,
                apiKeyLength: llmProviderConfig.providerApiKey?.length || 0,
              });
            } else {
              logger.api.warn('Provider not enabled or not found', { providerId: llmProviderId });
            }
          } catch (error) {
            logger.api.warn('Failed to load LLM provider config for simulation', {
              error,
              providerId: llmProviderId,
              conversationId,
            });
          }
        } else {
          logger.api.info('Using default Coze provider', { llmProviderId: llmProviderId || '(not set)' });
        }

        // Get the LLM stream
        const llmStream = llmStreamingService.createStream(
          conversationId,
          userMessage,
          chatHistory,
          {
            systemPrompt: effectiveSystemPrompt,
            // Knowledge context — orchestrator-graded (P0: no longer raw candidates).
            // P1: Knowledge context IS passed to the model (for generation), but
            // the public citation list comes from `evidenceCitations`, never from
            // raw `knowledgeSources`.
            knowledgeContext: knowledgeContextForLLM.context || undefined,
            knowledgeConfidence: knowledgeContextForLLM.confidence,
            // CANONICAL public citations. These become the SSE done.sources AND
            // the persisted Message.sources. NOT auto-derived from context regex.
            evidenceCitations: orchestratorCitations,
            knowledgeImages: knowledgeContextForLLM.images,
            // Product context
            productContext: productContextForLLM || undefined,
            // Size chart context
            sizeChartContext: sizeChartContextForLLM || undefined,
            knowledgeMinScore: retrievalResult.minScore,
            // Provenance trace for observability
            retrievalTrace: retrievalResult.evidence.trace
              ? {
                  action: retrievalResult.decision.action,
                  reasonCode: retrievalResult.decision.reasonCode,
                  provenanceVersion: retrievalResult.evidence.trace.provenanceVersion,
                  rerankDegraded: retrievalResult.evidence.trace.rerankDegraded,
                  candidateCount: retrievalResult.evidence.candidates.length,
                  citationCount: retrievalResult.evidence.citations.length,
                }
              : undefined,
            // Existing params
            aiModel: appSettings.ai_model_enabled === 'false'
              ? undefined
              : appSettings.ai_model,
            temperature: appSettings.ai_temperature ? parseFloat(appSettings.ai_temperature) : undefined,
            maxTokens: appSettings.ai_max_tokens ? parseInt(appSettings.ai_max_tokens, 10) : undefined,
            llmProviderId: llmProviderConfig.providerId,
            llmProviderBaseUrl: llmProviderConfig.providerBaseUrl,
            llmProviderApiKey: llmProviderConfig.providerApiKey,
            llmProviderType: llmProviderConfig.providerType,
            llmProviderDefaultModel: llmProviderConfig.defaultModel,
          }
        );

        let lastDoneChunk: import('@/lib/sse-parser').ParsedSSEChunk | null = null;
        let streamTimedOut = false;
        let fullContent = '';

        const reader = llmStream.getReader();

        try {
          // Use the shared parser — handles cross-chunk line buffering and AbortSignal.
          // request.signal propagates browser 60 s abort into the parser's AbortController.
          await parseSSEStream(reader, (chunk) => {
            if (chunk.content) {
              fullContent += chunk.content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk.content })}\n`));
            }
            if (chunk.done) lastDoneChunk = chunk as import('@/lib/sse-parser').ParsedSSEChunk;
          }, request.signal);
        } catch (parseErr) {
          const err = parseErr as Error;
          if (err.name === 'AbortError') {
            streamTimedOut = true;
            logger.api.warn('[Simulation Messages] Stream aborted', {
              simulationId: conversationId,
              userMessageLength: userMessage.length,
            });
          } else {
            logger.api.error('[Simulation Messages] Stream parse error', { error: err, simulationId: conversationId });
            throw err;
          }
        }

        // If stream timed out, send partial response (strip internal markers as safety net)
        const TOOL_CALL_SIM_PATTERN = /\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g;
        const CONF_SIM_PATTERN = /\[CONF:[0-9]*\.?[0-9]+\]/g;
        const DELEGATE_SIM_PATTERN = /\[DELEGATE_TO\][\s\S]*?\[\/DELEGATE_TO\]/g;
        const stripSimMarkers = (t: string) => t.replace(TOOL_CALL_SIM_PATTERN, '').replace(CONF_SIM_PATTERN, '').replace(DELEGATE_SIM_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
        const cleanContent = stripSimMarkers(fullContent);

        if (streamTimedOut && cleanContent) {
          // P2: On timeout, knowledge citations must be cleared.
          // The LLM did not finish the response — claim verification cannot run, and
          // we must not publish unverified KB sources for an incomplete answer.
          const timedOutSources: Array<{ type: string }> = [];

          const assistantMsg = await simulationRepository.createMessage({
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            role: 'assistant',
            content: cleanContent + '\n\n[响应超时，请刷新页面重试]',
            sources: timedOutSources.length > 0 ? timedOutSources : undefined,
            confidence: 0.5,
            confidence_breakdown: { knowledge_score: 0, tool_score: 0, llm_self_score: 0.5, sub_agent_score: 0, handoff_intent: false, no_support: false, final: 0.5 },
          });

          // Get message count — count failure is non-fatal so the reply is not lost
          let timedOutMessageCount: number | undefined;
          try {
            timedOutMessageCount = await simulationRepository.safeCountMessages(conversationId);
          } catch (countErr) {
            logger.api.warn('[Simulation Messages] Could not get message count after timeout', {
              countErr,
              simulationId: conversationId,
            });
          }

          const donePayload: Record<string, unknown> = {
            done: true,
            sources: assistantMsg.sources ?? null,
            confidence: assistantMsg.confidence ?? 0.5,
            timed_out: true,
            source: 'error',
            reason: '响应超时',
          };
          if (timedOutMessageCount !== undefined) {
            donePayload.message_count = timedOutMessageCount;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n`));
          controller.close();
          return;
        }

        // P2: Use the claim-verified confidence/sources from the stream's done event.
        // The LLMStreamingService already applied claim verification to hasKnowledge and
        // sources BEFORE sending the done event. Simulation must NOT recalculate these
        // from raw orchestratorCitations, as that bypasses the fail-closed verifier.
        // On timeout, the stream service did not run claim verification, so we fall back
        // to the stream's own confidence (typically 0 since nothing finished).
        const lc = lastDoneChunk as Record<string, unknown>;
        const verifiedConfidence = (lc?.confidence as number | undefined) ?? 0.5;
        const verifiedConfidenceBreakdown = lc?.confidence_breakdown as Record<string, unknown> | null ?? null;
        // On timeout (streamTimedOut=true), lastDoneChunk will exist but have 0 confidence.
        // On normal completion, lastDoneChunk.sources contains the verified citations.
        const verifiedSources: Array<{ type: string }> = (lc?.sources as Array<{ type: string }> | undefined) ?? [];
        const verifiedHasKnowledge = verifiedSources.some(c => c.type === 'knowledge');

        // Detect handoff intent via semantic pattern matching
        const handoffIntentDetected = detectHandoffIntent(fullContent);

        // Save assistant message
        const assistantMsg = await simulationRepository.createMessage({
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          sources: verifiedSources ?? undefined,
          confidence: verifiedConfidence,
          confidence_breakdown: verifiedConfidenceBreakdown ?? null,
        });

        // Get updated message count for frontend (graceful degradation: if count fails, omit the field)
        let messageCount: number | undefined;
        try {
          messageCount = await simulationRepository.safeCountMessages(conversationId);
        } catch (countErr) {
          logger.api.warn('[Simulation Messages] Could not get final message count', {
            countErr,
            simulationId: conversationId,
          });
        }

        const donePayload: Record<string, unknown> = {
          done: true,
          sources: assistantMsg.sources ?? null,
          confidence: assistantMsg.confidence ?? verifiedConfidence,
        };
        if (messageCount !== undefined) {
          donePayload.message_count = messageCount;
        }
        if (verifiedConfidenceBreakdown) {
          donePayload.confidence_breakdown = verifiedConfidenceBreakdown;
        }
        // Determine response source
        if (handoffIntentDetected) {
          donePayload.source = 'handoff';
          donePayload.reason = '检测到转人工意图';
        } else if (verifiedHasKnowledge) {
          donePayload.source = 'knowledge';
          donePayload.reason = '知识库检索匹配';
        } else {
          donePayload.source = 'llm';
          donePayload.reason = '纯LLM生成';
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(donePayload)}\n`));
        controller.close();
      } catch (error) {
        logger.api.error('[Simulation Messages] Stream error', {
          error,
          simulationId: conversationId,
          userMessage: userMessage.substring(0, 100),
        });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '处理消息时发生错误' })}\n`));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
