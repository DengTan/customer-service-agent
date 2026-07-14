import { NextRequest, NextResponse } from 'next/server';
import { apiError, parseJsonBody, HttpStatus, withErrorHandler, checkRateLimit } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { ConversationService } from '@/server/services/conversation-service';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import { LLMStreamingService } from '@/server/services/llm-streaming-service';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { SettingsService } from '@/server/services/settings-service';
import { HandoffService } from '@/server/services/handoff-service';
import { RoutingService } from '@/server/services/routing-service';
import { RetrievalOrchestrator } from '@/server/services/retrieval-orchestrator';
import { evaluateMaxTurns } from '@/server/services/max-turns';
import type { KnowledgeSearchResult } from '@/server/services/knowledge-search-service';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { BotConfigRepository } from '@/server/repositories/bot-config-repository';
import { ContentFilterService } from '@/server/services/content-filter-service';
import { HTTP } from '@/lib/constants';
import { z } from 'zod';

const FORWARD_HEADER_KEYS = new Set([
  'x-request-id',
  'x-correlation-id',
  'x-b3-traceid',
  'x-b3-spanid',
  'x-b3-parentspanid',
  'x-b3-sampled',
  'x-b3-flags',
  'x-ot-span-context',
  'x-real-ip',
  'x-forwarded-for',
]);

function extractForwardHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (FORWARD_HEADER_KEYS.has(lower) || lower.startsWith('cf-')) {
      result[key] = value;
    }
  }
  return result;
}

// Zod schema for message input validation
const MessageSchema = z.object({
  content: z.string()
    .min(1, '消息内容不能为空')
    .max(HTTP.MAX_MESSAGE_LENGTH, `消息内容超过最大长度限制 ${HTTP.MAX_MESSAGE_LENGTH} 字符`),
  role: z.string().optional(),
  image_url: z.string().url('图片URL格式不正确').optional().or(z.literal('')),
  enable_sub_agent: z.boolean().optional(),
});

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  // Rate limit: 20 messages per minute per IP
  const rateLimitError = checkRateLimit(request, { maxRequests: 20, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  const { id: conversationId } = await params;
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  // Validate input with Zod schema
  const validationResult = MessageSchema.safeParse(body);
  if (!validationResult.success) {
    return apiError(validationResult.error.issues[0]?.message || '输入格式不正确', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const { content: userMessage, role: messageRole, image_url: imageUrl, enable_sub_agent: enableSubAgent } = validationResult.data;

  // Content security filter check
  const contentFilterService = new ContentFilterService();
  const filterResult = await contentFilterService.filterContent(userMessage, {
    conversationId,
    logEnabled: true,
  });

  if (!filterResult.allowed) {
    return NextResponse.json({
      message: {
        role: 'system',
        content: filterResult.warnings[0] || '您的消息包含不合规内容，请修改后再试。',
      },
    }, { status: 400 });
  }

  // If content was filtered (replacements), use the filtered content
  const processedMessage = filterResult.filteredContent;
  if (processedMessage !== userMessage) {
    logger.api.info('Content filtered', {
      conversationId,
      originalLength: userMessage.length,
      filteredLength: processedMessage.length,
      matches: filterResult.sensitiveWordMatches.length,
    });
  }

  // Initialize services
  const conversationService = new ConversationService();
  const autoReplyService = new AutoReplyService();
  const llmStreamingService = new LLMStreamingService();
  const subAgentService = new SubAgentService();

  // 1. Validate conversation exists and status allows AI responses
  // Throws ServiceError if not found, caught by withErrorHandler
  const { status: convStatus } = await conversationService.ensureCanReceiveAiMessage(conversationId);

  // If conversation is in handoff status, handle agent messages separately
  if (convStatus === 'handoff') {
    // Agent sending a message during handoff: save directly without AI pipeline
    if (messageRole === 'agent') {
      await conversationService.insertMessage({
        conversation_id: conversationId,
        role: 'agent',
        content: userMessage,
      });
      // Update conversation timestamp
      await conversationService.updateMessageCountAfterUserMessage(conversationId, userMessage);
      return NextResponse.json({
        message: {
          role: 'agent',
          content: userMessage,
          source: 'agent',
        },
      });
    }
    // Non-agent messages during handoff: return system notice
    return NextResponse.json({
      message: {
        role: 'system',
        content: '当前对话已转交人工客服，请等待人工回复。',
      },
    });
  }

  // 1.5 Check AI max concurrent conversations
  const settingsService = new SettingsService();
  const appSettings = await settingsService.getSettingsMap();
  const maxConcurrent = parseInt(appSettings.ai_max_concurrent || '0', 10);
  if (maxConcurrent > 0) {
    const convRepo = new ConversationRepository();
    const activeCount = await convRepo.countActiveConversations();
    if (activeCount >= maxConcurrent) {
      return NextResponse.json({
        message: {
          role: 'system',
          content: `当前 AI 客服繁忙（同时服务 ${activeCount} 个对话，上限 ${maxConcurrent}），请稍后再试或转接人工客服。`,
        },
      });
    }
  }

  // 1.5.1 Load extended LLM provider settings (if configured)
  let llmProviderConfig: {
    providerId?: string;
    providerBaseUrl?: string;
    providerApiKey?: string;
    providerType?: 'coze' | 'openai_compatible' | 'anthropic' | 'custom';
    defaultModel?: string;
  } = {};
  
  // Try to load from LLM providers table
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
      }
    } catch (error) {
      logger.api.warn('Failed to load LLM provider config, falling back to default', { error, providerId: llmProviderId });
    }
  }

  // 1.6 Check session timeout from settings (max_turns check moved below — uses
  // role='user' exact count which we cannot read until the conversation exists)

  const sessionInfo = await conversationService.getSessionInfo(conversationId);
  if (sessionInfo) {
    // Check session timeout
    const timeoutMinutes = parseInt(appSettings.session_timeout || '0', 10);
    if (timeoutMinutes > 0) {
      const lastActiveAt = new Date(sessionInfo.updated_at).getTime();
      const elapsedMinutes = (Date.now() - lastActiveAt) / 60_000;
      if (elapsedMinutes > timeoutMinutes) {
        // Auto-end the conversation
        await conversationService.updateConversation(conversationId, { status: 'ended' });
        return NextResponse.json({
          message: {
            role: 'system',
            content: `会话已超时（超过 ${timeoutMinutes} 分钟未活跃），已自动结束。如需继续请创建新对话。`,
          },
        });
      }
    }
  }

  // 1.6.1 Check max_turns against exact role='user' count.
  // The route reads existing user turns BEFORE inserting this user message.
  // This keeps the semantic: max_turns=N allows the first N user messages and
  // rejects the (N+1)th, regardless of how many assistant/system/agent rows
  // exist. countUserMessages falls back to 0 on DB failure so the intake is
  // not blocked by a transient DB error (logged inside the service).
  const maxTurns = parseInt(appSettings.max_turns || '0', 10);
  if (maxTurns > 0) {
    const existingUserTurns = await conversationService.countUserMessages(conversationId);
    const verdict = evaluateMaxTurns({ existingUserTurns, maxTurns });
    if (verdict.blocked) {
      await conversationService.updateConversation(conversationId, { status: 'ended' });
      return NextResponse.json({
        message: {
          role: 'system',
          content: verdict.message,
        },
      });
    }
  }

  // 2. Save user message (with image URL if present)
  await conversationService.insertMessage({
    conversation_id: conversationId,
    role: 'user',
    content: userMessage,
    image_url: imageUrl || null,
  });

  // 3. Update conversation message count and title
  await conversationService.updateMessageCountAfterUserMessage(conversationId, userMessage);

  // 4. Check auto-reply rules (using filtered content for matching)
  const autoReply = await autoReplyService.matchReply(processedMessage);

  // 5. If auto-reply matched, return immediately
  if (autoReply) {
    await conversationService.insertMessage({
      conversation_id: conversationId,
      role: 'assistant',
      content: autoReply.content,
      confidence: 1.0,
      sources: [{ type: 'auto_reply', keyword: autoReply.rule.keyword }],
    });

    // Update message count for the assistant message (user count already incremented in step 3)
    await conversationService.incrementMessageCount(conversationId);

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: autoReply.content,
        sources: [{ type: 'auto_reply' }],
        confidence: 1.0,
      },
    });
  }

  // 6. Get message history for context
  const historyMessages = await conversationService.listMessageHistory(conversationId, 20);

  // P0/P1: Use shared RetrievalOrchestrator — same gating + evidence contract as
  // the simulation route. This replaces the old pattern of calling
  // KnowledgeSearchService + ProductDetailService + SizeChartService in parallel
  // and then letting the LLM streaming service auto-publish raw knowledgeSources
  // as final citations.
  const orchestrator = new RetrievalOrchestrator();
  const recentMessages = historyMessages.slice(-10).map(m => ({
    role: (m as unknown as { role: string }).role,
    content: (m as unknown as { content: string }).content,
  }));

  const retrievalResult = await orchestrator.retrieve(processedMessage, recentMessages, { useHybrid: true });
  const { evidence: evidenceBundle } = retrievalResult;
  const orchestratorCitations = evidenceBundle.citations;

  // Normalize orchestrator output to legacy LLM context shape. The LLM still
  // receives the accepted context (for generation), but public citations are
  // pinned to evidenceCitations — no more regex-driven or auto-promotion paths.
  const knowledgeResult: KnowledgeSearchResult = retrievalResult.knowledgeContext
    ? {
        context: retrievalResult.knowledgeContext.context,
        sources: retrievalResult.knowledgeContext.knowledgeSources,
        confidence: retrievalResult.knowledgeContext.confidence,
        images: retrievalResult.knowledgeContext.images,
      }
    : { context: '', sources: [], confidence: 0, images: [] };
  const productContext = retrievalResult.productContext?.productContext ?? '';
  const sizeChartContext = retrievalResult.sizeChartContext?.sizeChartContext ?? '';

  // 8. Extract custom headers for LLM
  const customHeaders = extractForwardHeaders(request.headers);

  // 9. Get conversation's shop (platform_connection_id) to determine which Bot to use
  const botConfigRepo = new BotConfigRepository();
  let shopBotSystemPrompt: string | undefined;
  let shopBotId: string | undefined;
  let shopBotName: string | undefined;

  try {
    // Get conversation's shop ID
    const conversation = await conversationService.getConversationBasic(conversationId);
    const shopId = conversation?.platform_connection_id;

    if (shopId) {
      // Find the Bot bound to this shop
      const shopBot = await botConfigRepo.findByShopId(shopId);
      if (shopBot && shopBot.status === 'active') {
        shopBotSystemPrompt = shopBot.system_prompt;
        shopBotId = shopBot.id;
        shopBotName = shopBot.name;
        logger.api.info('Using shop-bound bot', { shopId, botId: shopBotId, botName: shopBotName });
      } else {
        logger.api.info('No active bot bound to shop', { shopId });
      }
    } else {
      logger.api.debug('Conversation has no shop association, using default/system prompt');
    }
  } catch (botLookupError) {
    logger.api.error('Failed to lookup shop bot, falling back to default', { error: botLookupError, conversationId });
  }

  // 9.5 Evaluate routing rules — if a rule matches, use the target bot's system_prompt
  // Routing system_prompt takes priority over shop-bound bot (for global keyword routing)
  const routingService = new RoutingService();
  let routingSystemPrompt: string | undefined;
  try {
    const routingMatch = await routingService.matchRule(processedMessage);
    if (routingMatch) {
      if (routingMatch.bot.system_prompt) {
        routingSystemPrompt = routingMatch.bot.system_prompt;
        // Update parentBotId for sub-agent delegation
        if (enableSubAgent && !routingMatch.bot.is_sub_agent) {
          shopBotId = routingMatch.bot.id;
        }
        logger.api.info('Routing rule matched', { ruleId: routingMatch.rule.id, botId: routingMatch.bot.id });
      }
    }
  } catch {
    // Routing evaluation failure should not block message processing
  }

  // 9.7 Proactive sub-agent intent detection — if a sub-agent matches with high confidence,
  // delegate directly instead of going through the general LLM flow
  const parentBotId = shopBotId;
  let subAgentDelegationResult: { childBotName: string; responseContent: string; confidence: number; delegationId: string } | null = null;
  if (enableSubAgent && parentBotId) {
    try {
      const intentResult = await subAgentService.detectIntentAndRoute(parentBotId, processedMessage);
      if (intentResult.matchedSubAgent && intentResult.confidence >= 0.5) {
        // High confidence match — delegate directly to the sub-agent
        const result = await subAgentService.delegateTask({
          conversation_id: conversationId,
          parent_bot_id: parentBotId,
          child_bot_id: intentResult.matchedSubAgent.id,
          trigger_intent: intentResult.intent || undefined,
          input_message: userMessage,
        });
        subAgentDelegationResult = {
          childBotName: result.childBot.name,
          responseContent: result.responseContent,
          confidence: result.confidence,
          delegationId: result.delegation.id,
        };

        // Save the sub-agent's response as an assistant message
        await conversationService.insertMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: `**${result.childBot.name}** 处理结果：\n\n${result.responseContent}`,
          confidence: result.confidence,
          sources: [{ type: 'sub_agent_delegation', childBotName: result.childBot.name, triggerIntent: intentResult.intent, delegationId: result.delegation.id }],
        });

        // Update message count for the assistant message
        await conversationService.incrementMessageCount(conversationId);

        // Return as SSE stream for consistent frontend handling
        const delegationStream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              content: `**${result.childBot.name}** 处理结果：\n\n`,
              delegation: {
                childBotName: result.childBot.name,
                intent: intentResult.intent,
                confidence: result.confidence,
              },
            })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: result.responseContent })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, confidence: result.confidence, sources: [{ type: 'sub_agent_delegation', childBotName: result.childBot.name }] })}\n\n`));
            controller.close();
          },
        });

        return new Response(delegationStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }
    } catch (delegationError) {
      logger.api.error('Proactive sub-agent delegation failed, falling back to LLM', { error: delegationError, conversationId });
      // Fall through to normal LLM flow
    }
  }

  // 10. Read AI model settings (appSettings already loaded in step 1.5)

  // 11. Stream LLM response with error boundary (using filtered content)
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = llmStreamingService.createStream(conversationId, processedMessage, historyMessages, {
      // Knowledge context — orchestrator-graded (P0). Used for LLM generation only,
      // NOT auto-published as citations.
      knowledgeContext: knowledgeResult.context || undefined,
      knowledgeConfidence: knowledgeResult.confidence,
      // CANONICAL public citations. These become SSE done.sources AND the
      // persisted Message.sources (in handlePostStreamOperations).
      evidenceCitations: orchestratorCitations,
      knowledgeImages: knowledgeResult.images,
      productContext: productContext || undefined,
      sizeChartContext: sizeChartContext || undefined,
      imageUrl: imageUrl || null,
      customHeaders,
      knowledgeMinScore: retrievalResult.minScore,
      // Provenance trace for observability (consumed by handlePostStreamOperations → metadata)
      retrievalTrace: {
        action: retrievalResult.decision.action,
        reasonCode: retrievalResult.decision.reasonCode,
        provenanceVersion: retrievalResult.evidence.trace.provenanceVersion,
        rerankDegraded: retrievalResult.evidence.trace.rerankDegraded,
        candidateCount: retrievalResult.evidence.candidates.length,
        citationCount: retrievalResult.evidence.citations.length,
      },
      parentBotId,
      parentBotName: shopBotName,
      enableSubAgentDelegation: !!parentBotId,
      aiModel: appSettings.ai_model_enabled === 'false'
        ? undefined  // Will fall back to multimodal model
        : appSettings.ai_model,
      multimodalModel: appSettings.multimodal_model,
      multimodalEnabled: appSettings.multimodal_enabled !== 'false',
      multimodalDisabledAction: (appSettings.multimodal_disabled_action === 'handoff' ? 'handoff' : 'fixed_message') as 'fixed_message' | 'handoff',
      multimodalFixedMessage: appSettings.multimodal_fixed_message || undefined,
      systemPrompt: routingSystemPrompt || shopBotSystemPrompt || appSettings.system_prompt || undefined,
      temperature: appSettings.ai_temperature ? parseFloat(appSettings.ai_temperature) : undefined,
      maxTokens: appSettings.ai_max_tokens ? parseInt(appSettings.ai_max_tokens, 10) : undefined,
      // Extended LLM Provider configuration
      llmProviderId: llmProviderConfig.providerId,
      llmProviderBaseUrl: llmProviderConfig.providerBaseUrl,
      llmProviderApiKey: llmProviderConfig.providerApiKey,
      llmProviderType: llmProviderConfig.providerType,
      llmProviderDefaultModel: llmProviderConfig.defaultModel,
    });
  } catch (streamInitError) {
    logger.api.error('Failed to create LLM stream', { error: streamInitError, conversationId });
    // Return a minimal SSE stream with the error so the frontend can display it
    const errorEvent = `data: ${JSON.stringify({ error: 'AI 服务暂时不可用，请稍后重试', done: true })}\n\n`;
    return new Response(errorEvent, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // Return streaming response
  // Note: Post-stream operations (insert assistant message, generate summary, check alerts)
  // are handled internally by the LLMStreamingService
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
